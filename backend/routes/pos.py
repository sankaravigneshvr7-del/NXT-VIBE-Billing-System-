import os
from datetime import datetime, timedelta, timezone

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import defer

from extensions import db, invalidate_dashboard_cache
from models import Product, Order

pos_bp = Blueprint('pos', __name__)

# Order numbers look like DDMMYY0001. The date part uses the SHOP's local day
# (default IST = UTC+5:30 = 330 minutes) so the sequence restarts at local
# midnight, not at 5:30 AM. Change with ORDER_TZ_OFFSET_MINUTES if needed.
ORDER_TZ_OFFSET_MINUTES = int(os.environ.get('ORDER_TZ_OFFSET_MINUTES', '330'))
ORDER_NUMBER_LOCK_KEY = 710001  # arbitrary constant for pg_advisory_xact_lock

# GET /orders never returns more than this many rows per request.
MAX_ORDERS_LIMIT = 1000


# ---------------------------------------------------------------------------
# Stock helpers
# ---------------------------------------------------------------------------
def _total_units(product):
    return (product.boxes_in_stock * product.units_per_box) + product.loose_units_in_stock


def _set_units(product, total_units):
    product.boxes_in_stock = total_units // product.units_per_box
    product.loose_units_in_stock = total_units % product.units_per_box


def _lock_products(product_ids, active_only=True):
    """Fetch AND row-lock all needed products in ONE query (was one query per
    cart line). Ordered by id so concurrent requests lock in the same order
    and cannot deadlock."""
    if not product_ids:
        return {}
    query = Product.query.filter(Product.id.in_(list(product_ids)))
    if active_only:
        query = query.filter(Product.is_active.is_(True))
    rows = query.order_by(Product.id).with_for_update().all()
    return {p.id: p for p in rows}


def _parse_items(items):
    """Validate cart lines. Returns (parsed, error). parsed = [(pid, qty, price)]"""
    parsed = []
    for item in items:
        if not isinstance(item, dict):
            return None, "Invalid item in order"
        try:
            pid = int(item['product_id'])
            qty = int(item['quantity'])
            price = float(item['price_at_sale'])
        except (KeyError, TypeError, ValueError):
            return None, "Each item needs product_id, quantity and price_at_sale"
        if qty < 1:
            return None, "Quantity must be at least 1"
        if price < 0:
            return None, "Price cannot be negative"
        parsed.append((pid, qty, price))
    return parsed, None


def generate_order_number():
    # Serialise order-number generation (released automatically at commit or
    # rollback) so two simultaneous sales can never get the same number.
    db.session.execute(
        text("SELECT pg_advisory_xact_lock(:k)"), {"k": ORDER_NUMBER_LOCK_KEY}
    )

    local_now = datetime.now(timezone.utc) + timedelta(minutes=ORDER_TZ_OFFSET_MINUTES)
    date_prefix = local_now.strftime("%d%m%y")

    # Highest number used today. Uses the order_number prefix index and, unlike
    # count(), stays correct if an order row is ever removed.
    last = (
        db.session.query(func.max(Order.order_number))
        .filter(Order.order_number.like(f"{date_prefix}%"))
        .scalar()
    )

    try:
        new_seq = int(last[len(date_prefix):]) + 1 if last else 1
    except ValueError:
        new_seq = (
            Order.query.filter(Order.order_number.like(f"{date_prefix}%")).count() + 1
        )
    return f"{date_prefix}{new_seq:04d}"


def _parse_utc_aware(value):
    """ISO string -> timezone-aware UTC datetime. Raises ValueError if invalid."""
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _order_summary(order):
    """Same as Order.to_dict() but WITHOUT the heavy `items` column."""
    return {
        "id": order.id,
        "order_number": order.order_number,
        "cashier_name": order.cashier_name,
        "total_amount": order.total_amount,
        "payment_method": order.payment_method,
        "cash_received": order.cash_received,
        "upi_received": order.upi_received,
        "change_returned": order.change_returned,
        "status": order.status,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@pos_bp.route('/orders', methods=['POST'])
@jwt_required()
def create_order():
    claims = get_jwt()
    cashier_name = claims.get('username', 'Unknown')

    data = request.get_json(silent=True) or {}
    items = data.get('items', [])
    payment_data = data.get('payment', {}) or {}

    if not items or not isinstance(items, list):
        return jsonify({"error": "No items provided in order"}), 400

    parsed, error = _parse_items(items)
    if error:
        return jsonify({"error": error}), 400

    try:
        # One locked query for every product in the cart.
        products = _lock_products({pid for pid, _, _ in parsed})

        total = 0.0
        for pid, qty, price in parsed:  # same order as the cart, so the first failing line is reported
            product = products.get(pid)
            if not product:
                db.session.rollback()
                return jsonify({"error": "Product not found or inactive"}), 400

            current_units = _total_units(product)
            if current_units < qty:
                db.session.rollback()
                return jsonify({"error": f"Insufficient stock for {product.name}"}), 400

            _set_units(product, current_units - qty)
            total += price * qty

        order_number = generate_order_number()

        order = Order(
            order_number=order_number,
            cashier_name=cashier_name,
            items=items,
            total_amount=round(total, 2),
            payment_method=payment_data.get('method', 'cash'),
            cash_received=float(payment_data.get('cash_amount', 0) or 0),
            upi_received=float(payment_data.get('upi_amount', 0) or 0),
            change_returned=float(payment_data.get('change_returned', 0) or 0),
            status="completed"
        )
        db.session.add(order)

        # flush assigns id/created_at, so we can build the response BEFORE
        # commit and skip the extra SELECT that reading a committed (expired)
        # object would trigger.
        db.session.flush()
        order_data = order.to_dict()
        db.session.commit()

        invalidate_dashboard_cache()

        return jsonify({
            "message": "Order completed",
            "order_number": order_number,
            "order_data": order_data
        }), 201

    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Order ID collision. Please retry the transaction."}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("create_order failed: %s", e)
        return jsonify({"error": "Failed to create order."}), 500


@pos_bp.route('/orders', methods=['GET'])
@jwt_required()
def get_orders():
    """
    Response is still a plain JSON list (same shape as before).

    Optional query params:
      start, end   ISO date range (as before)
      q            order number search (as before)
      limit        rows per request (max 1000; default 1000 when omitted)
      page         1-based page number (use together with limit)
      fields       "summary" -> leave out the heavy `items` list

    When `limit` or `page` is sent, the X-Total-Count header holds the total
    number of matching orders.
    """
    start_str = request.args.get('start')
    end_str = request.args.get('end')
    search_query = request.args.get('q', '').strip()
    fields = request.args.get('fields', '').strip().lower()
    limit_arg = request.args.get('limit', type=int)
    page_arg = request.args.get('page', type=int)

    query = Order.query.filter(Order.status == "completed")

    if start_str and end_str:
        try:
            start_date = _parse_utc_aware(start_str)
            end_date = _parse_utc_aware(end_str)
        except ValueError:
            return jsonify({"error": "Invalid date format."}), 400
        query = query.filter(Order.created_at >= start_date, Order.created_at <= end_date)

    if search_query:
        query = query.filter(Order.order_number.ilike(f"%{search_query}%"))  # trigram index

    summary_only = fields == 'summary'
    if summary_only:
        query = query.options(defer(Order.items))

    paginated = limit_arg is not None or page_arg is not None
    limit = min(max(limit_arg or MAX_ORDERS_LIMIT, 1), MAX_ORDERS_LIMIT)
    page = max(page_arg or 1, 1)

    total_count = query.order_by(None).count() if paginated else None

    orders = (
        query.order_by(Order.created_at.desc(), Order.id.desc())
        .limit(limit)
        .offset((page - 1) * limit)
        .all()
    )

    payload = [_order_summary(o) if summary_only else o.to_dict() for o in orders]
    response = jsonify(payload)
    if total_count is not None:
        response.headers['X-Total-Count'] = str(total_count)
    return response, 200


@pos_bp.route('/orders/<int:order_id>', methods=['DELETE'])
@jwt_required()
def delete_order(order_id):
    try:
        # Lock the order row so two simultaneous cancels cannot both revert stock.
        order = Order.query.filter_by(id=order_id).with_for_update().first()

        if not order:
            db.session.rollback()
            return jsonify({"error": "Order not found"}), 404

        # Prevent multi-cancellation from injecting free stock back into the system
        if order.status == 'cancelled':
            db.session.rollback()
            return jsonify({"error": "Order is already cancelled"}), 400

        # Total quantity to give back per product
        qty_by_product = {}
        for item in (order.items or []):
            try:
                pid = int(item['product_id'])
                qty = int(item['quantity'])
            except (KeyError, TypeError, ValueError):
                continue
            qty_by_product[pid] = qty_by_product.get(pid, 0) + qty

        # One locked query for all products (inactive products still get their stock back)
        products = _lock_products(qty_by_product.keys(), active_only=False)
        for pid, qty in qty_by_product.items():
            product = products.get(pid)
            if product:
                _set_units(product, _total_units(product) + qty)

        order.status = "cancelled"
        order_number = order.order_number
        db.session.commit()

        invalidate_dashboard_cache()

        return jsonify({"message": f"Order {order_number} cancelled. Stock reverted."}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("delete_order failed: %s", e)
        return jsonify({"error": "Failed to cancel order and revert stock."}), 500