from extensions import db
from datetime import datetime, timezone
from sqlalchemy import CheckConstraint, Index, text
from sqlalchemy.dialects.postgresql import JSONB


def get_utc_now():
    return datetime.now(timezone.utc)


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False, unique=True)  # unique => indexed
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='staff', server_default=text("'staff'"))
    created_at = db.Column(db.DateTime(timezone=True), default=get_utc_now)


class Product(db.Model):
    __tablename__ = 'products'

    id = db.Column(db.Integer, primary_key=True)
    sku = db.Column(db.String(80), nullable=False, unique=True)  # unique => indexed
    name = db.Column(db.String(150), nullable=False)
    category = db.Column(db.String(80), nullable=False, default='General', server_default=text("'General'"))
    price_per_unit = db.Column(db.Float, nullable=False, default=0.0, server_default=text('0'))
    boxes_in_stock = db.Column(db.Integer, nullable=False, default=0, server_default=text('0'))
    units_per_box = db.Column(db.Integer, nullable=False, default=1, server_default=text('1'))
    loose_units_in_stock = db.Column(db.Integer, nullable=False, default=0, server_default=text('0'))
    low_stock_unit_threshold = db.Column(db.Integer, nullable=False, default=10, server_default=text('10'))
    is_active = db.Column(db.Boolean, nullable=False, default=True, server_default=text('true'))  # soft delete
    updated_at = db.Column(db.DateTime(timezone=True), default=get_utc_now, onupdate=get_utc_now)

    __table_args__ = (
        # Product list: WHERE is_active ORDER BY updated_at DESC (tiny partial index)
        Index('ix_products_active_updated', 'updated_at', postgresql_where=text('is_active')),
        # Guards against divide-by-zero and negative stock
        CheckConstraint('units_per_box >= 1', name='ck_products_units_per_box_positive'),
        CheckConstraint('boxes_in_stock >= 0 AND loose_units_in_stock >= 0', name='ck_products_stock_non_negative'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "sku": self.sku,
            "name": self.name,
            "category": self.category,
            "price_per_unit": self.price_per_unit,
            "boxes_in_stock": self.boxes_in_stock,
            "units_per_box": self.units_per_box,
            "loose_units_in_stock": self.loose_units_in_stock,
            "low_stock_unit_threshold": self.low_stock_unit_threshold,
            "is_active": self.is_active,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }


class Order(db.Model):
    __tablename__ = 'orders'

    id = db.Column(db.Integer, primary_key=True)
    order_number = db.Column(db.String(30), nullable=False, unique=True)  # unique => indexed
    cashier_name = db.Column(db.String(80))
    total_amount = db.Column(db.Float, nullable=False, default=0.0, server_default=text('0'))
    payment_method = db.Column(db.String(20), nullable=False, default='cash', server_default=text("'cash'"))
    cash_received = db.Column(db.Float, nullable=False, default=0.0, server_default=text('0'))
    upi_received = db.Column(db.Float, nullable=False, default=0.0, server_default=text('0'))
    change_returned = db.Column(db.Float, nullable=False, default=0.0, server_default=text('0'))
    status = db.Column(db.String(20), nullable=False, default='completed', server_default=text("'completed'"))
    items = db.Column(JSONB, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=get_utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=get_utc_now, onupdate=get_utc_now)

    __table_args__ = (
        # Dashboard, order list, date filters: status = 'completed' AND created_at range/order
        Index('ix_orders_status_created_at', 'status', 'created_at'),
        # generate_order_number(): order_number LIKE '111026%'
        Index('ix_orders_order_number_pattern', 'order_number',
              postgresql_ops={'order_number': 'varchar_pattern_ops'}),
        # Order search box: order_number ILIKE '%abc%'
        Index('ix_orders_order_number_trgm', 'order_number',
              postgresql_using='gin', postgresql_ops={'order_number': 'gin_trgm_ops'}),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "order_number": self.order_number,
            "cashier_name": self.cashier_name,
            "total_amount": self.total_amount,
            "payment_method": self.payment_method,
            "cash_received": self.cash_received,
            "upi_received": self.upi_received,
            "change_returned": self.change_returned,
            "status": self.status,
            "items": self.items,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class StaffConsumption(db.Model):
    __tablename__ = 'staff_consumptions'

    id = db.Column(db.Integer, primary_key=True)
    staff_name = db.Column(db.String(100), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    product_name = db.Column(db.String(150))
    units_consumed = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(120), default='Staff Treat')
    status = db.Column(db.String(20), nullable=False, default='pending', server_default=text("'pending'"))
    unit_cost_val = db.Column(db.Float, nullable=False, default=0.0, server_default=text('0'))
    created_at = db.Column(db.DateTime(timezone=True), default=get_utc_now)
    settled_at = db.Column(db.DateTime(timezone=True), nullable=True)
    settled_by = db.Column(db.String(80), nullable=True)

    __table_args__ = (
        # History list: ORDER BY created_at DESC LIMIT n
        Index('ix_staff_consumptions_created_at', 'created_at'),
        # Dues summary / settle: WHERE status <> 'settled' (small partial index)
        Index('ix_staff_consumptions_pending_staff', 'staff_name', postgresql_where=text("status <> 'settled'")),
        # Staff-name dropdown: SELECT DISTINCT staff_name
        Index('ix_staff_consumptions_staff_name', 'staff_name'),
        # FK lookups
        Index('ix_staff_consumptions_product_id', 'product_id'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "staff_name": self.staff_name,
            "product_id": self.product_id,
            "product_name": self.product_name,
            "units_consumed": self.units_consumed,
            "reason": self.reason,
            "status": self.status,
            "unit_cost_val": self.unit_cost_val,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "settled_at": self.settled_at.isoformat() if self.settled_at else None,
            "settled_by": self.settled_by
        }