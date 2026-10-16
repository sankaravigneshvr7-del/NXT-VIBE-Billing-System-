import traceback
from datetime import datetime, timedelta, timezone

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required
from sqlalchemy import func, case, cast, true, Integer, Float

from extensions import db, dashboard_cache
from models import Order, Product

dashboard_bp = Blueprint('dashboard', __name__)

# How is Order.created_at saved?
#   True  -> UTC (models.py uses get_utc_now, so this is True)
#   False -> server local time
ORDERS_STORED_IN_UTC = True

# If Order.items is a plain JSON column (not JSONB), change this to func.json_array_elements
ITEMS_EXPLODE_FN = func.jsonb_array_elements

INVENTORY_CACHE_KEY = "dashboard:inventory"


def _f(value):
    """Safe float: handles None and Decimal."""
    return float(value or 0)


def _parse_utc_naive(value):
    """ISO string -> naive UTC datetime. Raises ValueError if invalid."""
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# ---------------------------------------------------------------------------
# Inventory block. Depends only on products, so it is cached separately and
# shared by every date range. Computed in SQL (2 small queries) instead of
# loading every product into Python.
# ---------------------------------------------------------------------------
def _compute_inventory():
    units = (Product.boxes_in_stock * Product.units_per_box) + Product.loose_units_in_stock

    totals = db.session.query(
        func.coalesce(func.sum(units), 0),
        func.coalesce(func.sum(units * Product.price_per_unit), 0),
        func.coalesce(func.sum(case((units <= Product.low_stock_unit_threshold, 1), else_=0)), 0),
    ).filter(Product.is_active.is_(True)).first()

    low_rows = (
        db.session.query(Product.name, units.label('units'), Product.low_stock_unit_threshold)
        .filter(Product.is_active.is_(True), units <= Product.low_stock_unit_threshold)
        .order_by(units.asc())
        .limit(20)
        .all()
    )

    return {
        "total_value": round(_f(totals[1]), 2),
        "total_items": int(totals[0] or 0),
        "low_stock": int(totals[2] or 0),
        "low_stock_details": [
            {"name": r[0], "stock": int(r[1] or 0), "threshold": int(r[2] or 0)}
            for r in low_rows
        ],
    }


# ---------------------------------------------------------------------------
# Sales block for one date range.
#   Query A: ONE grouped query (per local day) -> trend + all KPI totals
#   Query B: ONE pass over all order items    -> top products + units sold
#   Query C: the 10 most recent orders
# ---------------------------------------------------------------------------
def _compute_sales(start_utc, end_utc, tz_offset):
    warnings = []

    if ORDERS_STORED_IN_UTC:
        db_start = start_utc.replace(tzinfo=timezone.utc)
        db_end = end_utc.replace(tzinfo=timezone.utc)
        # Shift to the viewer's local day before grouping, so an 11pm IST sale
        # lands on the right calendar day. timezone('UTC', ...) makes this
        # independent of the database session time zone.
        utc_naive = func.timezone('UTC', Order.created_at, type_=db.DateTime)
        day_expr = cast(utc_naive + timedelta(minutes=-tz_offset), db.Date)
    else:
        db_start = start_utc + timedelta(minutes=-tz_offset)
        db_end = end_utc + timedelta(minutes=-tz_offset)
        day_expr = cast(Order.created_at, db.Date)

    base_filter = [
        Order.status == 'completed',
        Order.created_at >= db_start,
        Order.created_at <= db_end,
    ]

    # Each order is counted exactly once:
    #   cash order  -> total_amount to cash
    #   upi order   -> total_amount to upi
    #   split order -> only its cash_received / upi_received portions
    #   anything else (card, etc.) -> other
    method = func.lower(Order.payment_method)
    is_split = method == 'split'

    day_rows = db.session.query(
        day_expr.label('day'),
        func.count(Order.id).label('orders'),
        func.coalesce(func.sum(Order.total_amount), 0).label('revenue'),
        func.coalesce(func.sum(case(
            (method == 'cash', Order.total_amount),
            (is_split, Order.cash_received),
            else_=0
        )), 0).label('cash_total'),
        func.coalesce(func.sum(case(
            (method == 'upi', Order.total_amount),
            (is_split, Order.upi_received),
            else_=0
        )), 0).label('upi_total'),
        func.coalesce(func.sum(case(
            (method.notin_(['cash', 'upi', 'split']), Order.total_amount),
            else_=0
        )), 0).label('other_total'),
        func.coalesce(func.sum(case(
            (is_split, Order.total_amount),
            else_=0
        )), 0).label('split_total'),
    ).filter(*base_filter).group_by(day_expr).order_by('day').all()

    order_count = sum(int(r.orders or 0) for r in day_rows)
    total_revenue = sum(_f(r.revenue) for r in day_rows)
    cash_total = sum(_f(r.cash_total) for r in day_rows)
    upi_total = sum(_f(r.upi_total) for r in day_rows)
    other_total = sum(_f(r.other_total) for r in day_rows)
    split_orders_total = sum(_f(r.split_total) for r in day_rows)

    sales_trend = [
        {"_id": r.day.strftime("%Y-%m-%d"), "daily_revenue": _f(r.revenue)}
        for r in day_rows
    ]

    top_products = []
    total_products_sold = 0
    recent_orders = []

    if order_count > 0:
        payments_sum = cash_total + upi_total + other_total
        if abs(payments_sum - total_revenue) > 1:
            warnings.append(
                f"Payments ({payments_sum:.2f}) differ from revenue ({total_revenue:.2f}). "
                "Check cash_received / upi_received on split orders (change given back?)."
            )

        # Query B: one pass over ALL items so total units sold is real,
        # then only the top 5 are returned for the chart.
        try:
            item = ITEMS_EXPLODE_FN(Order.items).table_valued('value').lateral('item')
            name_col = item.c.value.op('->>')('name')
            qty_col = cast(item.c.value.op('->>')('quantity'), Integer)
            price_col = cast(item.c.value.op('->>')('price_at_sale'), Float)

            product_rows = (
                db.session.query(
                    name_col.label('product_name'),
                    func.sum(qty_col).label('quantity_sold'),
                    func.sum(qty_col * price_col).label('revenue_generated'),
                )
                .select_from(Order)
                .join(item, true())
                .filter(*base_filter)
                .group_by(name_col)
                .order_by(func.sum(qty_col).desc())
                .all()
            )

            total_products_sold = sum(int(r.quantity_sold or 0) for r in product_rows)
            top_products = [
                {
                    "_id": r.product_name or "Unknown",
                    "quantity_sold": int(r.quantity_sold or 0),
                    "revenue_generated": _f(r.revenue_generated),
                }
                for r in product_rows[:5]
            ]
        except Exception as product_error:
            # Roll back so the session stays usable, and SAY what went wrong.
            db.session.rollback()
            current_app.logger.error("DASHBOARD TOP-PRODUCTS ERROR: %s", product_error)
            traceback.print_exc()
            warnings.append(f"Top products failed: {product_error}")

        # Query C: recent orders, same date range as the KPIs (uses the
        # (status, created_at) index, so it reads only 10 rows)
        recent_rows = (
            Order.query.filter(*base_filter)
            .order_by(Order.created_at.desc())
            .limit(10)
            .all()
        )
        recent_orders = [o.to_dict() for o in recent_rows]

    return {
        "order_count": order_count,
        "total_revenue": total_revenue,
        "cash_total": cash_total,
        "upi_total": upi_total,
        "other_total": other_total,
        "split_orders_total": split_orders_total,
        "total_products_sold": total_products_sold,
        "sales_trend": sales_trend,
        "top_products": top_products,
        "recent_orders": recent_orders,
        "warnings": warnings,
    }


def _build_payload(start_utc, end_utc, tz_offset):
    sales = _compute_sales(start_utc, end_utc, tz_offset)
    inventory = dashboard_cache.get_or_set(INVENTORY_CACHE_KEY, _compute_inventory)

    return {
        "kpis": {
            "revenue": round(sales["total_revenue"], 2),
            "orders": sales["order_count"],
            "products_sold": sales["total_products_sold"],
            "payments": {
                "cash": round(sales["cash_total"], 2),
                "upi": round(sales["upi_total"], 2),
                "other": round(sales["other_total"], 2),
            },
            "split_orders_total": round(sales["split_orders_total"], 2),
            "inventory": inventory,
        },
        "charts": {
            "trend": sales["sales_trend"],
            "top_products": sales["top_products"],
        },
        "tables": {
            "recent_orders": sales["recent_orders"],
        },
        "meta": {
            "warnings": sales["warnings"],
            "tz_offset": tz_offset,
            "orders_stored_in_utc": ORDERS_STORED_IN_UTC,
        },
    }


@dashboard_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_dashboard_stats():
    try:
        start_str = request.args.get('start')
        end_str = request.args.get('end')
        # JS getTimezoneOffset(): minutes BEHIND UTC. IST = -330.
        tz_offset = request.args.get('tz_offset', default=0, type=int)

        if not start_str or not end_str:
            return jsonify({"error": "Start and End dates are required."}), 400

        try:
            start_utc = _parse_utc_naive(start_str)
            end_utc = _parse_utc_naive(end_str)
        except ValueError:
            return jsonify({"error": "Invalid date format."}), 400

        # The frontend usually sends "now" as the end of the range, which
        # changes every second. Round to the minute for the cache key so
        # repeated/duplicate requests share one result. Any order, treat or
        # stock change clears the cache, and the TTL caps staleness anyway.
        cache_key = (
            "dashboard:stats",
            start_utc.replace(second=0, microsecond=0),
            end_utc.replace(second=0, microsecond=0),
            tz_offset,
        )

        # get_or_set holds a per-key lock: two identical simultaneous requests
        # compute once; the second waits and reuses the result.
        payload = dashboard_cache.get_or_set(
            cache_key,
            lambda: _build_payload(start_utc, end_utc, tz_offset),
        )
        return jsonify(payload), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error("DASHBOARD ERROR: %s", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500