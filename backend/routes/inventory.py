from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from extensions import db
from models import Product

inventory_bp = Blueprint('inventory', __name__)

def calculate_stock(boxes, loose, units_per_box):
    total_units = (int(boxes) * int(units_per_box)) + int(loose)
    if total_units < 0:
        total_units = 0
    return {
        "boxes_in_stock": total_units // int(units_per_box),
        "loose_units_in_stock": total_units % int(units_per_box),
        "total_absolute_units": total_units
    }

@inventory_bp.route('/products', methods=['GET'])
@jwt_required()
def get_products():
    # Only fetch active products
    products = Product.query.filter_by(is_active=True).order_by(Product.updated_at.desc()).all()

    total_value = 0
    low_stock_count = 0

    for p in products:
        total_units = (p.boxes_in_stock * p.units_per_box) + p.loose_units_in_stock
        total_value += (total_units * p.price_per_unit)
        if total_units <= p.low_stock_unit_threshold:
            low_stock_count += 1

    return jsonify({
        "products": [p.to_dict() for p in products],
        "metrics": {
            "total_value": round(total_value, 2),
            "total_items": len(products),
            "low_stock_count": low_stock_count
        }
    }), 200

@inventory_bp.route('/products', methods=['POST'])
@jwt_required()
def create_product():
    data = request.json or {}

    sku = data.get('sku', '').strip().upper()
    existing = Product.query.filter_by(sku=sku).first()
    
    if existing:
        if not existing.is_active:
            return jsonify({"error": f"SKU {sku} exists but is marked as deleted in the database. Please use a new SKU."}), 400
        return jsonify({"error": f"SKU {sku} already exists."}), 400

    stock_data = calculate_stock(
        data.get('boxes_in_stock', 0),
        data.get('loose_units_in_stock', 0),
        data.get('units_per_box', 1)
    )

    new_product = Product(
        sku=sku,
        name=data.get('name', '').strip(),
        category=data.get('category', 'General').strip(),
        price_per_unit=float(data.get('price_per_unit', 0)),
        boxes_in_stock=stock_data['boxes_in_stock'],
        units_per_box=int(data.get('units_per_box', 1)),
        loose_units_in_stock=stock_data['loose_units_in_stock'],
        low_stock_unit_threshold=int(data.get('low_stock_unit_threshold', 10))
    )

    db.session.add(new_product)
    db.session.commit()
    return jsonify({"message": "Product added successfully!", "product": new_product.to_dict()}), 201

@inventory_bp.route('/products/<int:product_id>', methods=['PUT'])
@jwt_required()
def update_product(product_id):
    data = request.json or {}

    product = Product.query.filter_by(id=product_id, is_active=True).first()
    if not product:
        return jsonify({"error": "Product not found."}), 404

    sku = data.get('sku', '').strip().upper()
    conflict = Product.query.filter(Product.sku == sku, Product.id != product_id).first()
    
    if conflict:
        return jsonify({"error": f"SKU {sku} is already used by another product."}), 400

    current_units_per_box = product.units_per_box
    current_total_units = (product.boxes_in_stock * current_units_per_box) + product.loose_units_in_stock

    new_units_per_box = int(data.get('units_per_box', 1))
    added_total_units = (int(data.get('add_boxes', 0)) * new_units_per_box) + int(data.get('add_loose', 0))
    final_total_units = current_total_units + added_total_units

    product.sku = sku
    product.name = data.get('name', '').strip()
    product.category = data.get('category', '').strip()
    product.price_per_unit = float(data.get('price_per_unit', 0))
    product.boxes_in_stock = final_total_units // new_units_per_box
    product.units_per_box = new_units_per_box
    product.loose_units_in_stock = final_total_units % new_units_per_box
    product.low_stock_unit_threshold = int(data.get('low_stock_unit_threshold', 10))

    db.session.commit()
    return jsonify({"message": "Product updated successfully!", "product": product.to_dict()}), 200

@inventory_bp.route('/products/<int:product_id>', methods=['DELETE'])
@jwt_required()
def delete_product(product_id):
    product = Product.query.filter_by(id=product_id, is_active=True).first()
    if not product:
        return jsonify({"error": "Product not found."}), 404

    # Soft delete preserves the product for historical order integrity
    product.is_active = False
    db.session.commit()
    
    return jsonify({"message": "Product deleted safely."}), 200