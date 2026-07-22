"""Authentication layer (doc 25, WP2).

In-app auth built on fastapi-users: session-cookie carrying a signed JWT,
one-time invite-token registration gate, and an admin (is_superuser) flag.

The app stack is fully synchronous (sync SQLAlchemy Session), whereas the
official fastapi-users SQLAlchemy adapter is async-only. Rather than add a
second async engine over the same SQLite file (locking risk), we provide a
thin synchronous BaseUserDatabase (user_db.py) whose async-declared methods
run sync Session queries — correct for this low-traffic internal app.
"""
