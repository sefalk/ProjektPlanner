# Step 01 — Backend Scaffold

_Branch: `feature/backend-scaffold`_
_Status: 🔄 in progress_

---

## Goal

Establish the full development environment and project skeleton so that every
subsequent step can be implemented in a reproducible, containerised way.

Nothing domain-specific is implemented here — only infrastructure.

---

## Environment as Code

All tools run inside Docker containers. **Nothing is installed globally on the host**
except Docker itself. This guarantees reproducibility across machines.

### Containers

| Service | Image base | Key tools inside |
|---|---|---|
| `backend` | `python:3.12-slim` | uv, FastAPI, uvicorn, pytest, hypothesis, mutmut |
| (future) `frontend` | `node:22-slim` | pnpm, Vite, TypeScript |

Python 3.12 is chosen over the host's 3.14 because 3.12 has mature wheel support
for all planned dependencies. The host Python version is irrelevant inside Docker.

### docker-compose services

```
backend   → http://localhost:8000   (FastAPI + uvicorn --reload)
```

SQLite DB lives in a bind-mounted `backend/data/` directory (gitignored).
Tests use an in-memory SQLite DB injected via a pytest fixture — no test artefacts on disk.

---

## Directory Structure (after this step)

```
ProjektPlanner/
  docker-compose.yml          dev orchestration
  docker-compose.test.yml     test runner (override for CI)
  .dockerignore

  backend/
    Dockerfile                multi-stage: dev + prod targets
    pyproject.toml            uv-managed dependencies
    uv.lock                   locked dependency tree (committed)
    .env.example              template — actual .env not committed
    alembic.ini
    alembic/
      env.py
      script.py.mako
      versions/               (empty at this step)

    app/
      __init__.py
      main.py                 FastAPI app, lifespan, router registration
      db.py                   engine, session factory, get_session dependency
      config.py               Settings via pydantic-settings / .env

    models/                   (empty __init__.py — populated in step 02)
    routers/                  (empty __init__.py — populated in step 05)
    services/                 (empty __init__.py — populated in steps 03–09)

    seed/
      dev_data.py             pseudo data only — no real data

    tests/
      conftest.py             shared fixtures (in-memory DB, test client)
      unit/
        __init__.py
        test_app.py           health endpoint, startup smoke tests
      integration/
        __init__.py
```

---

## Dependencies

### Runtime (`pyproject.toml [project.dependencies]`)

| Package | Purpose |
|---|---|
| `fastapi[standard]` | Web framework + uvicorn bundled |
| `sqlmodel` | ORM (SQLAlchemy + Pydantic) |
| `alembic` | DB schema migrations |
| `pydantic-settings` | `.env`-based config with type validation |
| `httpx` | Async HTTP client (holiday API calls) |
| `python-multipart` | File upload support (Sage import) |
| `thefuzz[speedup]` | Fuzzy string matching (person name matching) |

### Dev / test (`pyproject.toml [dependency-groups.dev]`)

| Package | Purpose |
|---|---|
| `pytest` | Test runner |
| `pytest-cov` | Coverage reporting |
| `pytest-asyncio` | Async test support |
| `httpx` | FastAPI `TestClient` + async tests |
| `hypothesis` | Property-based testing |
| `mutmut` | Mutation testing |

---

## Tests in this step (TDD)

Written first, then implemented against:

### `tests/unit/test_app.py`

```
test_health_endpoint_returns_200
    GET /health → 200 {"status": "ok"}

test_health_endpoint_returns_json
    response Content-Type is application/json

test_openapi_schema_available
    GET /openapi.json → 200

test_app_version_in_health
    /health response contains "version" key
```

### `tests/unit/test_config.py`

```
test_database_url_has_default
    Settings() without .env still provides a DATABASE_URL

test_holiday_api_url_configurable
    HOLIDAY_API_URL env var overrides default

test_env_example_contains_all_required_keys
    All keys present in .env.example match Settings fields
```

---

## Acceptance Criteria

- [ ] `docker compose up --build` starts the backend without errors
- [ ] `GET http://localhost:8000/health` returns `{"status": "ok", "version": "0.1.0"}`
- [ ] `GET http://localhost:8000/docs` shows the Swagger UI
- [ ] `docker compose run --rm backend pytest --cov=app tests/` passes with 100% coverage on this step's code
- [ ] `docker compose run --rm backend mutmut run` reports 0 surviving mutants for `app/config.py`
- [ ] `uv.lock` is committed; `Dockerfile` and `docker-compose.yml` are committed
- [ ] No sensitive data anywhere in committed files

---

## Out of Scope

- Any domain models, routers, or services (steps 02–09)
- Frontend container (separate step)
- Database migrations (step 02)
