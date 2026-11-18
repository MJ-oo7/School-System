import os
import sys

APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import Base, engine
import models
from routers import auth, enrollment, registrar, student_portal
from services.file_storage import UPLOAD_DIR

app = FastAPI(
    title="Digital School Enrollment System & Student Portal API",
    version="1.0.0"
)

# Automatically create tables in PostgreSQL / SQLite if they don't exist yet
Base.metadata.create_all(bind=engine)

# Seed default admin account (ADMIN-001)
auth.seed_default_admin()

# Resolve project directories
BACKEND_DIR = os.path.dirname(APP_DIR)
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")

# Mount uploads and frontend static directories
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

if os.path.isdir(FRONTEND_DIR):
    app.mount(
        "/student-portal",
        StaticFiles(directory=os.path.join(FRONTEND_DIR, "student-portal"), html=True),
        name="student-portal"
    )
    app.mount(
        "/registrar-portal",
        StaticFiles(directory=os.path.join(FRONTEND_DIR, "registrar-portal"), html=True),
        name="registrar-portal"
    )
    app.mount(
        "/shared",
        StaticFiles(directory=os.path.join(FRONTEND_DIR, "shared")),
        name="shared"
    )

# Enable CORS for frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register modular routers
app.include_router(auth.router)
app.include_router(student_portal.router)
app.include_router(enrollment.router)
app.include_router(registrar.router)


@app.get("/")
def read_root():
    return {
        "message": "Welcome to the Digital School Enrollment System API!",
        "student_portal": "/student-portal/index.html",
        "registrar_portal": "/registrar-portal/admin.html",
        "docs": "/docs"
    }
