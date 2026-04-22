# --- base: shared Python + uv setup ---
FROM python:3.12-slim AS base

WORKDIR /app

# uv is installed as a standalone binary — no pip pollution
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install dependencies into the project venv (not system Python)
ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_COMPILE_BYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml .
RUN uv sync --frozen --no-dev

# --- dev: adds dev dependencies + live reload ---
FROM base AS dev

RUN uv sync --frozen
COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# --- prod: lean image, no dev tools ---
FROM base AS prod

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
