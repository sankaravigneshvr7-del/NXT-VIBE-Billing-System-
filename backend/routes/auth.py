import os

from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import (
    create_access_token,
    jwt_required,
    get_jwt_identity,
    get_jwt,
    verify_jwt_in_request,
)
from sqlalchemy.exc import IntegrityError

from extensions import db
from models import User

auth_bp = Blueprint('auth', __name__)

# ---------------------------------------------------------------------------
# Password hashing
# Werkzeug 3's default is scrypt with N=32768 (~32 MB, very slow on Render's
# 0.1 CPU). This uses N=16384 by default, roughly half the cost.
# Tune with the PASSWORD_HASH_METHOD env var, for example:
#   scrypt:16384:8:1        (default, balanced)
#   scrypt:32768:8:1        (stronger, slower - the old default)
#   pbkdf2:sha256:150000    (low memory, CPU only)
# Existing users keep working: check_password_hash reads the method from the
# stored hash, and on each successful login an old-style hash is silently
# upgraded to the current method.
# ---------------------------------------------------------------------------
HASH_METHOD = os.environ.get('PASSWORD_HASH_METHOD', 'scrypt:16384:8:1')

# Keep today's behaviour (open signup) unless you turn it off.
# ALLOW_PUBLIC_SIGNUP=false  -> signup works only for the very first user
#                               (bootstrap) or when an admin is logged in.
ALLOW_PUBLIC_SIGNUP = os.environ.get('ALLOW_PUBLIC_SIGNUP', 'true').strip().lower() in ('1', 'true', 'yes')

_dummy_hash = None


def _needs_rehash(stored_hash):
    return not (stored_hash or '').startswith(HASH_METHOD + '$')


def _burn_dummy_check(password):
    """Spend the same hashing time for unknown usernames, so response time
    does not reveal which usernames exist."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = generate_password_hash('dummy-password', method=HASH_METHOD)
    check_password_hash(_dummy_hash, password)


def _issue_token(user):
    # Store user_id as identity string, pass metadata as claims
    return create_access_token(
        identity=str(user.id),
        additional_claims={
            "username": user.username,
            "role": user.role
        }
    )


def _signup_allowed():
    if ALLOW_PUBLIC_SIGNUP:
        return True
    if db.session.query(User.id).first() is None:
        return True  # first account (bootstrap)
    verify_jwt_in_request(optional=True)
    return get_jwt().get('role') == 'admin'


@auth_bp.route('/signup', methods=['POST'])
def signup():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password')
    role = (data.get('role') or 'admin').strip()

    if not username or not password or not isinstance(password, str):
        return jsonify({"error": "Username and password are required"}), 400
    if len(username) > 80 or len(role) > 20:
        return jsonify({"error": "Username or role is too long"}), 400

    if not _signup_allowed():
        return jsonify({"error": "Signup is disabled. Ask an admin to create your account."}), 403

    if db.session.query(User.id).filter_by(username=username).first():
        return jsonify({"error": "Username already taken"}), 400

    user = User(
        username=username,
        password_hash=generate_password_hash(password, method=HASH_METHOD),
        role=role
    )

    try:
        db.session.add(user)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Username already taken"}), 400

    return jsonify({
        "message": "Account created successfully",
        "token": _issue_token(user),
        "user": {"username": user.username, "role": user.role}
    }), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password')

    if not username or not isinstance(password, str) or not password:
        return jsonify({"error": "Invalid credentials"}), 401

    user = User.query.filter_by(username=username).first()  # uses the unique index on username
    if not user:
        _burn_dummy_check(password)
        return jsonify({"error": "Invalid credentials"}), 401

    if not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid credentials"}), 401

    # Upgrade old (slower) hashes to the current method, once per user.
    # Never let this block a successful login.
    if _needs_rehash(user.password_hash):
        try:
            user.password_hash = generate_password_hash(password, method=HASH_METHOD)
            db.session.commit()
        except Exception:
            db.session.rollback()

    return jsonify({
        "message": "Login successful",
        "token": _issue_token(user),
        "user": {
            "username": user.username,
            "role": user.role
        }
    }), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    # Reads the token only - no database query, so it is instant.
    claims = get_jwt()
    return jsonify({
        "user_id": get_jwt_identity(),
        "username": claims.get("username"),
        "role": claims.get("role")
    }), 200