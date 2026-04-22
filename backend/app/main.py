"""
FastAPI application entry point.

Registers routers, lifespan events, and global middleware.
Domain routers are added in later implementation steps.
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from app.config import settings
from app.db import create_db_and_tables


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Run startup/shutdown logic around the application lifecycle."""
    create_db_and_tables()
    yield


app = FastAPI(
    title="ProjektPlanner API",
    version=settings.app_version,
    description="Project time planning and billing tracking.",
    lifespan=lifespan,
)


@app.get("/health", tags=["meta"])
def health() -> dict[str, Any]:
    """Liveness probe — confirms the service is running."""
    return {"status": "ok", "version": settings.app_version}
