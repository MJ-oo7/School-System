from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
from routers.registrar import ensure_programs_and_subjects_seeded

router = APIRouter(tags=["Student Portal"])


@router.get("/users/{user_id}/applications", response_model=List[schemas.ApplicationDetailResponse])
def get_user_applications(user_id: str, db: Session = Depends(get_db)):
    ensure_programs_and_subjects_seeded(db)
    user = db.query(models.User).filter(models.User.user_id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    applications = db.query(models.Application).filter(
        models.Application.user_id == user_id
    ).all()

    return applications
