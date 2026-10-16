from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt
from sqlalchemy import func

from extensions import db, dashboard_cache, invalidate_dashboard_cache
from models import Product, StaffConsumption, get_utc_now

treats_bp = Blueprint('treats', __name__)

STAFF_CACHE_KEY = "treats:staff"
SUMMARY_CACHE_KEY = "treats:summary"

DEFAULT_HISTORY_LIMIT = 50   # same as before
MAX_HISTORY_LIMIT = 200


# ---------------------------------------------------------------------------
# Stock helpers
# ---------------------------------------------------------------------------
def _total_units(product):
    return (product.boxes_in_stock * product.units_per_box) + product.loose_units_in_stock


def _set_units(product, total_units):
    product.boxes_in_stock = total_units // product.units_per_box
    product.loose_units_in_stock = total_units % product.units_per_box


def _lock_products(product_ids, active_only=True):
    """Fetch AND row-lock all needed products in ONE query (ordered by id so
    concurrent requests cannot deadlock)."""
    ids = [pid for pid in product_ids if pid is not None]
    if not ids:
        return {}
    query = Product.query.filter(Product.id.in_(ids))
    if active_only:
        query = query.filter(Product.is_active.is_(True))
    rows = query.order_by(Product.id).with_for_update().all()
    return {p.id: p for p in rows}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@treats_bp.route('/', methods=['GET'])
@jwt_required()
def get_treats():
    """
    Same response as before: the latest 50 logs as a JSON list.
    Optional: ?limit=50&page=2  (limit max 200). When sent, the X-Total-Count
    header holds the total number of logs.
    """
    limit_arg = request.args.get('limit', type=int)
    page_arg = request.args.get('page', type=int)
    paginated = limit_arg is not None or page_arg is not None

    limit = min(max(limit_arg or DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT)
    page = max(page_arg or 1, 1)

    treats = (
        StaffConsumption.query
        .order_by(StaffConsumption.created_at.desc(), StaffConsumption.id.desc())
        .limit(limit)
        .offset((page - 1) * limit)
        .all()
    )

    response = jsonify([t.to_dict() for t in treats])
    if paginated:
        response.headers['X-Total-Count'] = str(db.session.query(func.count(StaffConsumption.id)).scalar())
    return response, 200


@treats_bp.route('/staff', methods=['GET'])
@jwt_required()
def get_staff_names():
    def build():
        rows = (
            db.session.query(StaffConsumption.staff_name)
            .distinct()
            .order_by(StaffConsumption.staff_name)
            .all()
        )
        return [r[0] for r in rows if r[0] and r[0].strip()]

    return jsonify(dashboard_cache.get_or_set(STAFF_CACHE_KEY, build)), 200


@treats_bp.route('/summary', methods=['GET'])
@jwt_required()
def get_treats_summary():
    def build():
        # Everything not yet settled, summed per staff member INSIDE the
        # database (uses the partial index on pending rows) instead of
        # loading every row into Python.
        owed = func.sum(StaffConsumption.units_consumed * StaffConsumption.unit_cost_val)
        rows = (
            db.session.query(
                StaffConsumption.staff_name,
                func.coalesce(owed, 0),
                func.coalesce(func.sum(StaffConsumption.units_consumed), 0),
            )
            .filter(StaffConsumption.status != "settled")
            .group_by(StaffConsumption.staff_name)
            .order_by(owed.desc(), StaffConsumption.staff_name)
            .all()
        )

        summary = [
            {
                "_id": name,
                "total_owed": round(float(total_owed or 0), 2),
                "total_items": int(total_items or 0),
            }
            for name, total_owed, total_items in rows
        ]
        overall_total = sum(item['total_owed'] for item in summary)
        return {"summary": summary, "overall_total": round(overall_total, 2)}

    return jsonify(dashboard_cache.get_or_set(SUMMARY_CACHE_KEY, build)), 200


@treats_bp.route('/settle', methods=['POST'])
@jwt_required()
def settle_dues():
    claims = get_jwt()
    if claims.get('role') != 'admin':
        return jsonify({"error": "Unauthorized. Only admins can settle dues."}), 403

    data = request.get_json(silent=True) or {}
    staff_name = (data.get('staff_name') or '').strip()
    if not staff_name:
        return jsonify({"error": "Staff name is required"}), 400

    try:
        # One bulk UPDATE instead of loading and saving every row.
        settled_count = (
            StaffConsumption.query
            .filter(
                StaffConsumption.staff_name == staff_name,
                StaffConsumption.status != "settled"
            )
            .update(
                {
                    "status": "settled",
                    "settled_by": claims.get('username'),
                    "settled_at": get_utc_now(),
                },
                synchronize_session=False
            )
        )
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("settle_dues failed: %s", e)
        return jsonify({"error": "Failed to settle dues."}), 500

    if not settled_count:
        return jsonify({"message": f"No pending dues found for {staff_name}."}), 200

    invalidate_dashboard_cache()
    return jsonify({"message": f"Successfully settled dues for {staff_name}."}), 200


@treats_bp.route('/<int:treat_id>', methods=['DELETE'])
@jwt_required()
def delete_treat(treat_id):
    claims = get_jwt()
    if claims.get('role') != 'admin':
        return jsonify({"error": "Unauthorized. Only admins can delete logs."}), 403

    try:
        # Lock the log row so a double-click cannot revert the stock twice.
        treat = (
            StaffConsumption.query.filter_by(id=treat_id)
            .with_for_update()
            .first()
        )
        if not treat:
            db.session.rollback()
            return jsonify({"error": "Log record not found."}), 404

        products = _lock_products([treat.product_id], active_only=False)
        product = products.get(treat.product_id)
        if product:
            _set_units(product, _total_units(product) + treat.units_consumed)

        db.session.delete(treat)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("delete_treat failed: %s", e)
        return jsonify({"error": "Failed to delete log."}), 500

    invalidate_dashboard_cache()
    return jsonify({"message": "Log deleted and stock successfully reverted."}), 200


@treats_bp.route('/', methods=['POST'])
@jwt_required()
def log_treat():
    data = request.get_json(silent=True) or {}

    items = data.get('items', [])
    reason = (str(data.get('reason') or 'Staff Treat')).strip()[:120] or 'Staff Treat'
    staff_name = str(data.get('staff_name') or '').strip().title()[:100]

    if not staff_name:
        return jsonify({"error": "Staff name is required"}), 400
    if not items or not isinstance(items, list):
        return jsonify({"error": "At least one product is required"}), 400

    # Validate every line first (no database work yet).
    parsed = []
    for item in items:
        if not isinstance(item, dict):
            return jsonify({"error": "Invalid item provided."}), 400

        try:
            units = int(item.get('units', 1))
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid quantity provided."}), 400
        if units < 1:
            return jsonify({"error": "Invalid quantity provided."}), 400

        try:
            product_id = int(item.get('product_id'))
        except (ValueError, TypeError):
            product_id = None

        parsed.append((item, product_id, units))

    try:
        # One locked query for every product (was one query per line).
        products = _lock_products({pid for _, pid, _ in parsed})

        new_logs = []
        for item, product_id, units in parsed:
            product = products.get(product_id)
            label = item.get('name', 'Unknown')

            if not product:
                db.session.rollback()
                return jsonify({"error": f"Failed on item '{label}': Product not found or inactive."}), 400

            current_units = _total_units(product)
            if current_units < units:
                db.session.rollback()
                return jsonify({
                    "error": f"Failed on item '{label}': Insufficient stock. You only have {current_units} units available."
                }), 400

            # Same product twice in one request: the second line sees the
            # already-reduced stock, exactly like before.
            _set_units(product, current_units - units)

            new_logs.append(StaffConsumption(
                staff_name=staff_name,
                product_id=product.id,
                product_name=product.name,
                units_consumed=units,
                reason=reason,
                status="pending",
                unit_cost_val=product.price_per_unit
            ))

        db.session.add_all(new_logs)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("log_treat failed: %s", e)
        return jsonify({"error": "An error occurred while logging the treat."}), 500

    invalidate_dashboard_cache()
    return jsonify({"message": "Items logged and stock deducted successfully!"}), 201