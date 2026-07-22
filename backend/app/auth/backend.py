"""Authentication backend: httpOnly session-cookie carrying a signed JWT.

Chosen over a Bearer/localStorage token (XSS-safe cookie) and over stateful DB
sessions (no extra table / no refresh-token ballast) — see doc 25 §4. Logout
clears the cookie; the short-lived JWT then simply expires.
"""

from __future__ import annotations

from fastapi_users import FastAPIUsers
from fastapi_users.authentication import AuthenticationBackend, CookieTransport, JWTStrategy

from app.auth.manager import get_user_manager
from app.config import settings
from app.models.user import User

cookie_transport = CookieTransport(
    cookie_name="projektplannerauth",
    cookie_max_age=settings.auth_session_lifetime,
    cookie_secure=settings.auth_cookie_secure,
    cookie_httponly=True,
    cookie_samesite=settings.auth_cookie_samesite,  # type: ignore[arg-type]
)


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(secret=settings.auth_secret, lifetime_seconds=settings.auth_session_lifetime)


auth_backend = AuthenticationBackend(
    name="cookie",
    transport=cookie_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, int](get_user_manager, [auth_backend])

# Dependencies for routes.
current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)
# Optional variant (returns None when unauthenticated) — used by the owner-filter
# in WP3 so unauthenticated/background contexts simply see nothing.
current_user_optional = fastapi_users.current_user(active=True, optional=True)
