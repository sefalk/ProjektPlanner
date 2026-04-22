"""
FastAPI application entry point.

Registers routers, lifespan events, and global middleware.
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from app.config import settings
from app.db import create_db_and_tables
from app.routers import imports, invoices, milestones, persons, programs, projects, rebalancing


@asynccontextmanager
async def lifespan(application: FastAPI):
    create_db_and_tables()
    yield


app = FastAPI(
    title="ProjektPlanner API",
    version=settings.app_version,
    description="Project time planning and billing tracking.",
    lifespan=lifespan,
)

app.include_router(programs.router)
app.include_router(projects.router)
app.include_router(persons.router)
app.include_router(imports.router)
app.include_router(milestones.router)
app.include_router(rebalancing.router)
app.include_router(invoices.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, Any]:
    return {"status": "ok", "version": settings.app_version}
