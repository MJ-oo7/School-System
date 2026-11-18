"""Root convenience entry point so `uvicorn main:app --reload` works from the workspace root."""
import os
import sys

APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "app")
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

from backend.app.main import app  # noqa: E402, F401
