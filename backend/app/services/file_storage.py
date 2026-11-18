import os
import uuid
from fastapi import HTTPException, UploadFile, status

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.dirname(APP_DIR)
UPLOAD_DIR = os.path.join(BACKEND_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


async def validate_and_save_upload(file: UploadFile) -> tuple[str, str]:
    """Validate uploaded file and save to disk. Returns (disk_file_path, relative_file_path)."""
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided."
        )

    file_extension = os.path.splitext(file.filename)[1].lower()
    if file_extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type '{file_extension}'. Allowed formats: PDF, JPG, JPEG, PNG, DOC, DOCX."
        )

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file cannot be empty."
        )
    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds the 10 MB maximum limit."
        )

    unique_filename = f"{uuid.uuid4().hex}{file_extension}"
    disk_file_path = os.path.join(UPLOAD_DIR, unique_filename)
    relative_file_path = f"uploads/{unique_filename}"

    try:
        with open(disk_file_path, "wb") as f:
            f.write(contents)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not save uploaded file: {str(e)}"
        )

    return disk_file_path, relative_file_path


def remove_old_file(relative_file_path: str) -> None:
    """Safely remove an existing uploaded file when replaced."""
    if not relative_file_path:
        return
    old_disk_path = os.path.join(BACKEND_DIR, relative_file_path)
    if os.path.exists(old_disk_path):
        try:
            os.remove(old_disk_path)
        except OSError:
            pass
