import os
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables BEFORE importing config
load_dotenv()

from sqlalchemy import text

from extensions import db, jwt, migrate, compress, dashboard_cache
from config import Config
import models  # noqa: F401  (needed so Flask-Migrate sees the tables)

# Import Blueprints
from routes.auth import auth_bp
from routes.pos import pos_bp
from routes.inventory import inventory_bp
from routes.dashboard import dashboard_bp
from routes.treats import treats_bp


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    app.json.sort_keys = False  # skip needless key sorting on every response

    # CORS: the preflight (OPTIONS) result is cached by the browser for max_age
    # seconds, so it stops preceding every single GET.
    CORS(
        app,
        resources={r"/api/*": {
            "origins": app.config["CORS_ORIGINS"],
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

    # ------------------------------------------------------------------
    # Health / warm-up
    #   /api/ping        -> no DB, no auth. Use for the Render keep-alive.
    #   /api/ping?db=1   -> also runs SELECT 1 to wake Neon from suspend.
    # ------------------------------------------------------------------
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
    # Caching headers (registered AFTER compress so it runs BEFORE it:
    # Flask runs after_request handlers in reverse registration order).
    #   - GET JSON 200 responses get an ETag; unchanged data answers 304.
    #   - "private, no-cache" = the browser may store it but must revalidate,
    #     so users never see stale stock or sales.
    #   - ping is never cached.
    # ------------------------------------------------------------------
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
            response.make_conditional(request)
        return response

    return app


# gunicorn entry point:  gunicorn "app:app" -c gunicorn.conf.py
app = create_app()

if __name__ == '__main__':
    # Local development only. Never run debug=True in production.
    app.run(debug=False, port=int(os.environ.get('PORT', 5000)))