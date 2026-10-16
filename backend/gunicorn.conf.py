import os

# Render gives the port in $PORT.
bind = f"0.0.0.0:{os.environ.get('PORT', '10000')}"

# 0.1 CPU / 512 MB: ONE process, several threads. Threads let slow requests
# (waiting on the database) overlap without the memory cost of extra workers.
# Keep this at 1: the dashboard cache lives in the worker's memory, and
# a single worker means every request shares (and clears) the same cache.
workers = 1
worker_class = "gthread"
threads = int(os.environ.get('GUNICORN_THREADS', '4'))

# Neon can take a few seconds to wake up; do not kill the request too early.
timeout = 60
graceful_timeout = 20
keepalive = 5

# Log to stdout so everything shows up in the Render logs.
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get('LOG_LEVEL', 'info')