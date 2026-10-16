import os
from datetime import timedelta


def _normalize_db_url(url):
    """SQLAlchemy 2.x needs 'postgresql://', not the legacy 'postgres://'."""
    if url and url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


# Render sets RENDER=true automatically on its services.
IS_PRODUCTION = bool(os.environ.get("RENDER")) or os.environ.get("FLASK_ENV") == "production"


def _secret(name, dev_default):
    value = os.environ.get(name)
    if value:
        return value
    if IS_PRODUCTION:
        raise RuntimeError(
            f"{name} environment variable is required in production. "
            "Set it in the Render dashboard (Environment tab)."
        )
    return dev_default


class Config:
    SECRET_KEY = _secret("SECRET_KEY", "dev-only-secret-key")
    # Use the Neon *pooled* host (contains '-pooler') for DATABASE_URL.
    SQLALCHEMY_DATABASE_URI = _normalize_db_url(os.environ.get("DATABASE_URL"))
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Small pool: Render free has 512 MB / 0.1 CPU and gunicorn runs 1 worker
    # with a few threads, so a handful of connections is plenty. Neon's
    # pgbouncer (-pooler host) does the real multiplexing.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_size": 3,
        "max_overflow": 2,
        "pool_timeout": 10,        # fail fast instead of hanging a request
        "pool_pre_ping": True,     # drop connections Neon closed while suspended
        "pool_recycle": 240,       # < Neon's 5 min idle suspend
        "connect_args": {
            "connect_timeout": 10,
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 3,
            "application_name": "billing-api",
        },
    }

    # JWT
    JWT_SECRET_KEY = _secret("JWT_SECRET_KEY", "dev-only-jwt-secret-key")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=12)

    # Response compression (Flask-Compress)
    COMPRESS_MIMETYPES = ["application/json", "text/html", "text/css", "application/javascript"]
    COMPRESS_LEVEL = 6
    COMPRESS_MIN_SIZE = 500

    # Dashboard cache lifetime in seconds (invalidated on any write anyway)
    DASHBOARD_CACHE_TTL = int(os.environ.get("DASHBOARD_CACHE_TTL", "20"))

    # CORS: comma separated list of allowed frontend origins, "*" for any.
    # Example: https://my-shop.vercel.app,http://localhost:5173
    CORS_ORIGINS = [
        o.strip()
        for o in os.environ.get("CORS_ORIGINS", "*").split(",")
        if o.strip()
    ]
    CORS_MAX_AGE = 86400  # browsers cache the preflight for 24h (Chrome caps at 2h)

    JSON_SORT_KEYS = False