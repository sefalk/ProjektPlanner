"""Auth flow (doc 25, WP2): invite-gated registration, login/session, admin.

Uses the shared in-memory `client`/`session` fixtures (conftest). All auth DB
access flows through the overridden get_session, so everything stays in-memory.
"""

from datetime import timedelta

import pytest
from fastapi_users.password import PasswordHelper
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

import app.auth.bootstrap as bootstrap
from app.auth.manager import utcnow_naive
from app.models.invite_token import InviteToken
from app.models.user import User

_PW = PasswordHelper()

# A password that satisfies the policy (#53): >=12 chars, upper+lower, digit, special.
_GOOD_PW = "Pw123456789!"


def _make_invite(session, token="invite-abc", expires_in_days=14, used_by=None):
    inv = InviteToken(
        token=token,
        created_at=utcnow_naive(),
        used_by=used_by,
        expires_at=(utcnow_naive() + timedelta(days=expires_in_days)) if expires_in_days else None,
    )
    session.add(inv)
    session.commit()
    return inv


def _make_user(session, email, password, superuser=False):
    u = User(
        email=email,
        hashed_password=_PW.hash(password),
        is_active=True,
        is_superuser=superuser,
        is_verified=True,
    )
    session.add(u)
    session.commit()
    return u


def _login(client, email, password):
    return client.post("/auth/login", data={"username": email, "password": password})


# ── registration gate ────────────────────────────────────────────────────────

def test_register_without_invite_token_rejected(client):
    r = client.post("/auth/register", json={"email": "x@example.com", "password": "pw12345678"})
    assert r.status_code == 422  # invite_token is a required field


def test_register_with_invalid_invite_rejected(client):
    r = client.post(
        "/auth/register",
        json={"email": "x@example.com", "password": "pw12345678", "invite_token": "nope"},
    )
    assert r.status_code == 400


def test_register_with_valid_invite_succeeds_and_consumes_token(client, session):
    _make_invite(session, token="good-token")
    r = client.post(
        "/auth/register",
        json={"email": "new@example.com", "password": _GOOD_PW, "invite_token": "good-token"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["email"] == "new@example.com"
    assert r.json()["is_superuser"] is False  # self-register cannot elevate

    # Token is now used → second attempt fails.
    r2 = client.post(
        "/auth/register",
        json={"email": "other@example.com", "password": _GOOD_PW, "invite_token": "good-token"},
    )
    assert r2.status_code == 400


def test_register_with_expired_invite_rejected(client, session):
    _make_invite(session, token="old", expires_in_days=-1)
    r = client.post(
        "/auth/register",
        json={"email": "y@example.com", "password": "pw12345678", "invite_token": "old"},
    )
    assert r.status_code == 400


def test_self_register_cannot_set_superuser(client, session):
    _make_invite(session, token="t2")
    r = client.post(
        "/auth/register",
        json={
            "email": "sneaky@example.com", "password": _GOOD_PW,
            "invite_token": "t2", "is_superuser": True,
        },
    )
    assert r.status_code == 201
    assert r.json()["is_superuser"] is False


# ── password policy + domain allowlist + consume-last regression (#53) ─────────

def test_register_weak_password_rejected_and_keeps_token(client, session):
    """A weak password is rejected AND must not burn the invite token."""
    _make_invite(session, token="weak-token")
    r = client.post(
        "/auth/register",
        json={"email": "weak@example.com", "password": "short", "invite_token": "weak-token"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "REGISTER_INVALID_PASSWORD"
    # Token was NOT consumed → the same token now works with a strong password.
    r2 = client.post(
        "/auth/register",
        json={"email": "weak@example.com", "password": _GOOD_PW, "invite_token": "weak-token"},
    )
    assert r2.status_code == 201, r2.text


def test_register_disallowed_domain_rejected_and_keeps_token(client, session, monkeypatch):
    from app.config import settings as app_settings
    monkeypatch.setattr(app_settings, "auth_allowed_email_domains", "infoteam.de")
    _make_invite(session, token="dom-token")
    r = client.post(
        "/auth/register",
        json={"email": "x@example.com", "password": _GOOD_PW, "invite_token": "dom-token"},
    )
    assert r.status_code == 400
    # Token survives the rejection → an allowed domain can still use it.
    r2 = client.post(
        "/auth/register",
        json={"email": "y@infoteam.de", "password": _GOOD_PW, "invite_token": "dom-token"},
    )
    assert r2.status_code == 201, r2.text


# ── login / session ──────────────────────────────────────────────────────────

def test_login_sets_cookie_and_me_returns_user(client, session):
    _make_user(session, "u@example.com", "pw12345678")
    r = _login(client, "u@example.com", "pw12345678")
    assert r.status_code in (200, 204)
    assert "projektplannerauth" in r.cookies or any(
        "projektplannerauth" in c for c in r.headers.get_list("set-cookie")
    )
    me = client.get("/users/me")
    assert me.status_code == 200
    assert me.json()["email"] == "u@example.com"


def test_me_without_login_unauthorized(client):
    assert client.get("/users/me").status_code == 401


def test_login_wrong_password_rejected(client, session):
    _make_user(session, "w@example.com", "correct-pw")
    assert _login(client, "w@example.com", "wrong-pw").status_code == 400


# ── invite management (admin only) ────────────────────────────────────────────

def test_create_invite_requires_superuser(client, session):
    _make_user(session, "plain@example.com", "pw12345678", superuser=False)
    _login(client, "plain@example.com", "pw12345678")
    assert client.post("/auth/invites", json={"expires_in_days": 7}).status_code == 403


def test_create_invite_unauthenticated_rejected(client):
    assert client.post("/auth/invites", json={"expires_in_days": 7}).status_code == 401


def test_admin_can_create_and_list_invites(client, session):
    _make_user(session, "admin@example.com", "pw12345678", superuser=True)
    _login(client, "admin@example.com", "pw12345678")
    created = client.post("/auth/invites", json={"expires_in_days": 7})
    assert created.status_code == 201, created.text
    token = created.json()["token"]
    assert token

    listed = client.get("/auth/invites")
    assert listed.status_code == 200
    assert any(t["token"] == token for t in listed.json())


# ── admin bootstrap ───────────────────────────────────────────────────────────

@pytest.fixture(name="boot_engine")
def boot_engine_fixture(monkeypatch):
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(eng)
    monkeypatch.setattr(bootstrap, "engine", eng)
    yield eng


def test_seed_admin_noop_without_env(boot_engine, monkeypatch):
    monkeypatch.setattr(bootstrap.settings, "admin_email", "")
    monkeypatch.setattr(bootstrap.settings, "admin_password", "")
    bootstrap.seed_admin_user()
    with Session(boot_engine) as s:
        assert s.exec(select(User)).first() is None


def test_seed_admin_creates_superuser_once(boot_engine, monkeypatch):
    monkeypatch.setattr(bootstrap.settings, "admin_email", "root@example.com")
    monkeypatch.setattr(bootstrap.settings, "admin_password", "pw12345678")
    bootstrap.seed_admin_user()
    bootstrap.seed_admin_user()  # idempotent — must not create a second user
    with Session(boot_engine) as s:
        users = s.exec(select(User)).all()
        assert len(users) == 1
        assert users[0].is_superuser is True
        assert users[0].email == "root@example.com"
