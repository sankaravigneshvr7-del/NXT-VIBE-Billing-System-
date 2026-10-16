"""Indexes, defaults, NOT NULL and check constraints

Revision ID: a7c3e91f5b20
Revises: d061a8c377cd
Create Date: 2026-10-11 12:00:00.000000

Idempotent: safe to run even if 001_indexes_and_column_fixes.sql was already
applied by hand.

Put this file in migrations/versions/ and run:  flask db upgrade
Tip: run migrations against Neon's DIRECT host (without "-pooler").
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'a7c3e91f5b20'
down_revision = 'd061a8c377cd'
branch_labels = None
depends_on = None


UPGRADE_SQL = [
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",

    # --- backfill ---
    "UPDATE products SET category = 'General' WHERE category IS NULL",
    "UPDATE products SET price_per_unit = 0 WHERE price_per_unit IS NULL",
    "UPDATE products SET boxes_in_stock = 0 WHERE boxes_in_stock IS NULL OR boxes_in_stock < 0",
    "UPDATE products SET units_per_box = 1 WHERE units_per_box IS NULL OR units_per_box < 1",
    "UPDATE products SET loose_units_in_stock = 0 WHERE loose_units_in_stock IS NULL OR loose_units_in_stock < 0",
    "UPDATE products SET low_stock_unit_threshold = 10 WHERE low_stock_unit_threshold IS NULL",
    "UPDATE products SET is_active = TRUE WHERE is_active IS NULL",
    "UPDATE orders SET total_amount = 0 WHERE total_amount IS NULL",
    "UPDATE orders SET payment_method = 'cash' WHERE payment_method IS NULL",
    "UPDATE orders SET cash_received = 0 WHERE cash_received IS NULL",
    "UPDATE orders SET upi_received = 0 WHERE upi_received IS NULL",
    "UPDATE orders SET change_returned = 0 WHERE change_returned IS NULL",
    "UPDATE orders SET status = 'completed' WHERE status IS NULL",
    "UPDATE staff_consumptions SET status = 'pending' WHERE status IS NULL",
    "UPDATE staff_consumptions SET unit_cost_val = 0 WHERE unit_cost_val IS NULL",
    "UPDATE users SET role = 'staff' WHERE role IS NULL",

    # --- defaults + NOT NULL ---
    """ALTER TABLE products
        ALTER COLUMN category SET DEFAULT 'General', ALTER COLUMN category SET NOT NULL,
        ALTER COLUMN price_per_unit SET DEFAULT 0, ALTER COLUMN price_per_unit SET NOT NULL,
        ALTER COLUMN boxes_in_stock SET DEFAULT 0, ALTER COLUMN boxes_in_stock SET NOT NULL,
        ALTER COLUMN units_per_box SET DEFAULT 1, ALTER COLUMN units_per_box SET NOT NULL,
        ALTER COLUMN loose_units_in_stock SET DEFAULT 0, ALTER COLUMN loose_units_in_stock SET NOT NULL,
        ALTER COLUMN low_stock_unit_threshold SET DEFAULT 10, ALTER COLUMN low_stock_unit_threshold SET NOT NULL,
        ALTER COLUMN is_active SET DEFAULT TRUE, ALTER COLUMN is_active SET NOT NULL""",
    """ALTER TABLE orders
        ALTER COLUMN total_amount SET DEFAULT 0, ALTER COLUMN total_amount SET NOT NULL,
        ALTER COLUMN payment_method SET DEFAULT 'cash', ALTER COLUMN payment_method SET NOT NULL,
        ALTER COLUMN cash_received SET DEFAULT 0, ALTER COLUMN cash_received SET NOT NULL,
        ALTER COLUMN upi_received SET DEFAULT 0, ALTER COLUMN upi_received SET NOT NULL,
        ALTER COLUMN change_returned SET DEFAULT 0, ALTER COLUMN change_returned SET NOT NULL,
        ALTER COLUMN status SET DEFAULT 'completed', ALTER COLUMN status SET NOT NULL""",
    """ALTER TABLE staff_consumptions
        ALTER COLUMN status SET DEFAULT 'pending', ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN unit_cost_val SET DEFAULT 0, ALTER COLUMN unit_cost_val SET NOT NULL""",
    """ALTER TABLE users
        ALTER COLUMN role SET DEFAULT 'staff', ALTER COLUMN role SET NOT NULL""",

    # --- check constraints ---
    """DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_products_units_per_box_positive') THEN
            ALTER TABLE products ADD CONSTRAINT ck_products_units_per_box_positive CHECK (units_per_box >= 1);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_products_stock_non_negative') THEN
            ALTER TABLE products ADD CONSTRAINT ck_products_stock_non_negative
                CHECK (boxes_in_stock >= 0 AND loose_units_in_stock >= 0);
        END IF;
    END $$""",

    # --- indexes ---
    "CREATE INDEX IF NOT EXISTS ix_orders_status_created_at ON orders (status, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_orders_order_number_pattern ON orders (order_number varchar_pattern_ops)",
    "CREATE INDEX IF NOT EXISTS ix_orders_order_number_trgm ON orders USING gin (order_number gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS ix_products_active_updated ON products (updated_at) WHERE is_active",
    "CREATE INDEX IF NOT EXISTS ix_staff_consumptions_created_at ON staff_consumptions (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_staff_consumptions_pending_staff ON staff_consumptions (staff_name) WHERE status <> 'settled'",
    "CREATE INDEX IF NOT EXISTS ix_staff_consumptions_staff_name ON staff_consumptions (staff_name)",
    "CREATE INDEX IF NOT EXISTS ix_staff_consumptions_product_id ON staff_consumptions (product_id)",
]

DOWNGRADE_SQL = [
    "DROP INDEX IF EXISTS ix_staff_consumptions_product_id",
    "DROP INDEX IF EXISTS ix_staff_consumptions_staff_name",
    "DROP INDEX IF EXISTS ix_staff_consumptions_pending_staff",
    "DROP INDEX IF EXISTS ix_staff_consumptions_created_at",
    "DROP INDEX IF EXISTS ix_products_active_updated",
    "DROP INDEX IF EXISTS ix_orders_order_number_trgm",
    "DROP INDEX IF EXISTS ix_orders_order_number_pattern",
    "DROP INDEX IF EXISTS ix_orders_status_created_at",
    "ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_stock_non_negative",
    "ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_units_per_box_positive",
    # NOT NULL / defaults are intentionally left in place on downgrade (harmless and safer).
]


def upgrade():
    for statement in UPGRADE_SQL:
        op.execute(statement)


def downgrade():
    for statement in DOWNGRADE_SQL:
        op.execute(statement)