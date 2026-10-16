import threading
import time

from flask_compress import Compress
from flask_jwt_extended import JWTManager
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from sqlalchemy.engine import Engine

db = SQLAlchemy()
jwt = JWTManager()
migrate = Migrate()
compress = Compress()


# ---------------------------------------------------------------------------
# Cold-start retry
# Neon free suspends after 5 min idle; the first connection can fail or time
# out while the compute wakes up. Retry a few times with backoff instead of
# returning a 500 to the user.
# ---------------------------------------------------------------------------
_CONNECT_DELAYS = (0.5, 1.0, 2.0, 3.0)  # ~6.5s total before giving up


@event.listens_for(Engine, "do_connect")
def _connect_with_retry(dialect, conn_rec, cargs, cparams):
    last_error = None
    for attempt in range(len(_CONNECT_DELAYS) + 1):
        try:
            return dialect.dbapi.connect(*cargs, **cparams)
        except dialect.dbapi.OperationalError as exc:
            last_error = exc
            if attempt < len(_CONNECT_DELAYS):
                time.sleep(_CONNECT_DELAYS[attempt])
    raise last_error


# ---------------------------------------------------------------------------
# Tiny thread-safe TTL cache
# - get_or_set() takes a per-key lock, so two identical simultaneous requests
#   compute once; the second waits and reuses the result (no duplicate DB work).
# - clear() is called after any order / treat / stock change.
# ---------------------------------------------------------------------------
class TTLCache:
    def __init__(self, ttl=20, maxsize=64):
        self.ttl = ttl
        self.maxsize = maxsize
        self._data = {}
        self._locks = {}
        self._guard = threading.Lock()
        self._version = 0  # bumped on clear() so in-flight computes don't store stale data

    def _lock_for(self, key):
        with self._guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = self._locks[key] = threading.Lock()
            return lock

    def get(self, key):
        with self._guard:
            entry = self._data.get(key)
            if not entry:
                return None
            expires_at, value = entry
            if expires_at < time.monotonic():
                self._data.pop(key, None)
                return None
            return value

    def set(self, key, value, ttl=None):
        with self._guard:
            if len(self._data) >= self.maxsize:
                oldest = min(self._data, key=lambda k: self._data[k][0])
                self._data.pop(oldest, None)
            self._data[key] = (time.monotonic() + (ttl or self.ttl), value)

    def get_or_set(self, key, producer, ttl=None):
        cached = self.get(key)
        if cached is not None:
            return cached
        with self._lock_for(key):
            cached = self.get(key)  # another thread may have filled it while we waited
            if cached is not None:
                return cached
            version_before = self._version
            value = producer()
            if version_before == self._version:  # no write happened mid-compute
                self.set(key, value, ttl)
            return value

    def clear(self):
        with self._guard:
            self._data.clear()
            self._version += 1


dashboard_cache = TTLCache(ttl=20)


def invalidate_dashboard_cache():
    """Call after any order create/cancel, treat log/delete, or stock change."""
    dashboard_cache.clear()