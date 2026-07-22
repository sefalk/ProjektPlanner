"""
FastAPI application entry point.

Registers routers, lifespan events, and global middleware.
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.bootstrap import seed_admin_user
from app.config import settings
from app.db import create_db_and_tables, seed_default_settings
from app.routers import auth, calendar, imports, invoices, milestones, persons, programs, projects, settings as settings_router


@asynccontextmanager
async def lifespan(application: FastAPI):
    create_db_and_tables()
    seed_default_settings()
    seed_admin_user()
    yield


app = FastAPI(
    title="ProjektPlanner API",
    version=settings.app_version,
    description="Project time planning and billing tracking.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(programs.router)
app.include_router(projects.router)
app.include_router(persons.router)
app.include_router(imports.router)
app.include_router(milestones.router)
app.include_router(invoices.router)
app.include_router(calendar.router)
app.include_router(settings_router.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, Any]:
    return {"status": "ok", "version": settings.app_version}
