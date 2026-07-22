"""fastapi-users request/response schemas (doc 25, WP2)."""

from fastapi_users import schemas


class UserRead(schemas.BaseUser[int]):
    """Public user representation (never includes the password hash)."""


class UserCreate(schemas.BaseUserCreate):
    """Registration payload. Requires a valid one-time invite token.

    is_superuser / is_verified inherited from BaseUserCreate are ignored on the
    public /register route (fastapi-users calls create with safe=True), so a
    self-registering user cannot elevate themselves to admin.
    """

    invite_token: str


class UserUpdate(schemas.BaseUserUpdate):
    """Self-service profile update (password/email)."""
