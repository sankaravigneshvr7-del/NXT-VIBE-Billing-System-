import os
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables BEFORE importing config
load_dotenv()

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from werkzeug.exceptions import HTTPException

from extensions import db, jwt, migrate, compress, dashboard_cache
from config import Config
import models  # noqa: F401  (needed so Flask-Migrate sees the tables)

# Import Blueprints
from routes.auth import auth_bp
from routes.pos import pos_bp
from routes.inventory import inventory_bp
from routes.dashboard import dashboard_bp
from routes.treats import treats_bp


def _clean_origins(value):
    """
    Accepts a list, or a comma-separated string, of allowed frontend origins and
    returns a clean list. Trailing slashes are removed because browsers send the
    Origin header WITHOUT one, so "https://site.netlify.app/" would never match.
    """
    if value == "*":
        return "*"
    if isinstance(value, str):
        value = value.split(",")
    cleaned = []
    for origin in value or []:
        origin = str(origin).strip().rstrip("/")
        if origin:
            cleaned.append(origin)
    # Safe local-dev fallback if nothing is configured
    return cleaned or ["http://localhost:5173", "http://127.0.0.1:5173"]


def init_database(app):
    """
    Creates the pg_trgm extension and any missing tables when the server starts.
    - Safe to run on every boot (it only creates what is missing).
    - A Postgres advisory lock makes several gunicorn workers take turns instead
      of racing each other.
    - Never crashes the server: if the database is unreachable the error is
      logged and the app still starts.
    Set INIT_DB_ON_START=0 in Render to switch this off (e.g. once you use
    Flask-Migrate for schema changes).
    """
    if os.environ.get("INIT_DB_ON_START", "1") != "1":
        return
    try:
        with app.app_context():
            with db.engine.begin() as conn:
                conn.execute(text("SELECT pg_advisory_xact_lock(727274)"))
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
                db.metadata.create_all(bind=conn)
        app.logger.info("Database ready.")
    except Exception as exc:  # noqa: BLE001
        app.logger.error("Database init skipped: %s", exc)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    app.json.sort_keys = False  # skip needless key sorting on every response

    # CORS: the preflight (OPTIONS) result is cached by the browser for max_age
    # seconds, so it stops preceding every single GET.
    CORS(
        app,
        resources={r"/api/*": {
            "origins": _clean_origins(app.config["CORS_ORIGINS"]),
            "allow_headers": ["Authorization", "Content-Type", "If-None-Match"],
            "expose_headers": ["ETag"],
            "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            "max_age": app.config["CORS_MAX_AGE"],
        }},
    )

    # Initialize extensions
    db.init_app(app)
    jwt.init_app(app)
    migrate.init_app(app, db)  # Enables database migrations
    compress.init_app(app)
    dashboard_cache.ttl = app.config["DASHBOARD_CACHE_TTL"]

    # Register Blueprints
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(pos_bp, url_prefix='/api/pos')
    app.register_blueprint(inventory_bp, url_prefix='/api/inventory')
    app.register_blueprint(dashboard_bp, url_prefix='/api/dashboard')
    app.register_blueprint(treats_bp, url_prefix='/api/treats')

    # Create the extension + tables if they don't exist yet
    init_database(app)

    # ------------------------------------------------------------------
    # Root + health / warm-up
    #   /                -> friendly status page instead of a 404
    #   /api/ping        -> no DB, no auth. Use for keep-alive monitors.
    #   /api/ping?db=1   -> also runs SELECT 1 to wake Neon from suspend.
    # ------------------------------------------------------------------
    @app.route('/')
    def index():
        return jsonify({"service": "NXT VIBE Billing API", "status": "running"}), 200

    @app.route('/api/ping')
    def ping():
        if request.args.get('db') == '1':
            try:
                db.session.execute(text("SELECT 1"))
                return jsonify({"message": "OK", "db": "ok"}), 200
            except Exception as exc:
                db.session.rollback()
                app.logger.warning("Ping DB check failed: %s", exc)
                return jsonify({"message": "OK", "db": "error"}), 503
        return jsonify({"message": "OK"}), 200

    # ------------------------------------------------------------------
    # Error handling: always answer with JSON that has an "error" field, so the
    # frontend can show a real message instead of "status code 500".
    # ------------------------------------------------------------------
    @app.errorhandler(OperationalError)
    def handle_db_unavailable(exc):
        db.session.rollback()
        app.logger.warning("Database unavailable: %s", exc)
        return jsonify({
            "error": "The database is waking up. Please try again in a few seconds."
        }), 503

    @app.errorhandler(Exception)
    def handle_unexpected(exc):
        if isinstance(exc, HTTPException):  # 404, 405, 401 ... keep their status
            return jsonify({"error": exc.description}), exc.code
        if app.debug:
            raise exc
        db.session.rollback()
        app.logger.exception("Unhandled error on %s %s", request.method, request.path)
        return jsonify({"error": "Something went wrong on the server. Please try again."}), 500

    # ------------------------------------------------------------------
    # Headers
    # ------------------------------------------------------------------
    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        return response

    # Caching headers (registered AFTER compress so it runs BEFORE it:
    # Flask runs after_request handlers in reverse registration order).
    #   - GET JSON 200 responses get an ETag; unchanged data answers 304.
    #   - "private, no-cache" = the browser may store it but must revalidate,
    #     so users never see stale stock or sales.
    #   - Vary: Authorization keeps one user's cached copy separate from another's.
    #   - ping is never cached.
    @app.after_request
    def add_cache_headers(response):
        if request.method != 'GET' or not request.path.startswith('/api/'):
            return response

        if request.path == '/api/ping':
            response.headers['Cache-Control'] = 'no-store'
            return response

        if (
            response.status_code == 200
            and response.mimetype == 'application/json'
            and not response.direct_passthrough
        ):
            response.add_etag()
            response.headers.setdefault('Cache-Control', 'private, no-cache')
            response.vary.add('Authorization')
            response.make_conditional(request)
        return response

    return app


# gunicorn entry point:  gunicorn "app:app" -c gunicorn.conf.py
app = create_app()

if __name__ == '__main__':
    # Local development only. Never run debug=True in production.
    app.run(debug=False, port=int(os.environ.get('PORT', 5000)))