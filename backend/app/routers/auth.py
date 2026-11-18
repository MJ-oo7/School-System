import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from database import SessionLocal, engine, get_db
import models
import schemas

router = APIRouter(tags=["Authentication & Users"])


def seed_default_admin():
    """Seed a default Admin account (ADMIN-001) and ensure PostgreSQL payment enum includes 'cash'."""
    if engine.dialect.name == "postgresql":
        for enum_name in ("paymentmethodenum", "payment_method"):
            try:
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                    conn.execute(text(f"ALTER TYPE {enum_name} ADD VALUE IF NOT EXISTS 'cash'"))
            except Exception:
                pass

    db = SessionLocal()
    try:
        admin_user = db.query(models.User).filter(
            or_(
                models.User.user_id == "ADMIN-001",
                models.User.email == "admin@school.edu"
            )
        ).first()
        if not admin_user:
            default_admin = models.User(
                user_id="ADMIN-001",
                email="admin@school.edu",
                user_password="admin123",
                full_name="System Administrator",
                phone_number="09123456789",
                user_type=models.UserAccessEnum.admin
            )
            db.add(default_admin)
            db.commit()
        elif admin_user.user_type != models.UserAccessEnum.admin:
            admin_user.user_type = models.UserAccessEnum.admin
            db.commit()
    finally:
        db.close()


@router.post("/users/applicant", status_code=status.HTTP_201_CREATED)
def create_applicant(applicant: schemas.ApplicantCreate, db: Session = Depends(get_db)):
    """Create a prospective student applicant record and initialize a draft application immediately."""
    db_user = db.query(models.User).filter(
        models.User.email == applicant.email
    ).first()

    if not db_user:
        generated_user_id = f"USER-{uuid.uuid4().hex[:8].upper()}"
        db_user = models.User(
            user_id=generated_user_id,
            email=applicant.email,
            user_password=models.UNPROVISIONED_PASSWORD,
            full_name=applicant.full_name,
            phone_number=applicant.phone_number,
            user_type=models.UserAccessEnum.student
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
    else:
        db_user.full_name = applicant.full_name
        if applicant.phone_number:
            db_user.phone_number = applicant.phone_number
        db.commit()
        db.refresh(db_user)

    # Resolve target program (either requested course_id or first active program)
    program = None
    if applicant.course_id:
        program = db.query(models.Program).filter(
            models.Program.course_id == applicant.course_id,
            models.Program.is_active == True
        ).first()
    if not program:
        program = db.query(models.Program).filter(
            models.Program.is_active == True
        ).first()

    draft_app = db.query(models.Application).filter(
        models.Application.user_id == db_user.user_id,
        models.Application.status == models.ApplicationStatusEnum.draft
    ).first()

    if not draft_app and program:
        existing_any_app = db.query(models.Application).filter(
            models.Application.user_id == db_user.user_id,
            models.Application.course_id == program.course_id,
            models.Application.status != models.ApplicationStatusEnum.rejected
        ).first()
        if existing_any_app:
            draft_app = existing_any_app
        else:
            generated_app_id = f"APP-{uuid.uuid4().hex[:8].upper()}"
            draft_app = models.Application(
                application_id=generated_app_id,
                user_id=db_user.user_id,
                course_id=program.course_id,
                status=models.ApplicationStatusEnum.draft
            )
            db.add(draft_app)
            db.commit()
            db.refresh(draft_app)
    elif draft_app and program and applicant.course_id and draft_app.course_id != program.course_id:
        draft_app.course_id = program.course_id
        db.commit()
        db.refresh(draft_app)

    return {
        "message": "Applicant profile and draft dossier initialized.",
        "user_id": db_user.user_id,
        "email": db_user.email,
        "full_name": db_user.full_name,
        "phone_number": db_user.phone_number,
        "application_id": draft_app.application_id if draft_app else None,
        "course_id": draft_app.course_id if draft_app else None,
        "has_portal_account": db_user.has_portal_account
    }


@router.post("/applications/{application_id}/create-student-account")
def create_student_account_by_application(
    application_id: str,
    account_data: schemas.StudentPortalAccountCreate,
    db: Session = Depends(get_db)
):
    """Create a Student Portal account by Application ID.
    Requires:
    1. The application must exist and have status == 'approved'.
    2. The student (checked by user_id) must NOT already have an existing Student Portal account.
    """
    normalized_app_id = application_id.strip().upper()
    application = db.query(models.Application).filter(
        models.Application.application_id == normalized_app_id
    ).first()

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application ID '{normalized_app_id}' was not found."
        )

    if application.status != models.ApplicationStatusEnum.approved:
        status_label = application.status.value.replace("_", " ").upper()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Applicant is NOT YET APPROVED (Current application status: {status_label}). The application must be APPROVED before a Student Portal account can be created."
        )

    # Check by user_id to ensure only ONE student account can exist per student
    user = db.query(models.User).filter(
        models.User.user_id == application.user_id
    ).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Associated student user record not found."
        )

    if user.has_portal_account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Student '{user.full_name}' (User ID: {user.user_id}) ALREADY has an existing Student Portal account ({user.email}). Only one Student Portal account is allowed per student."
        )

    if account_data.email and account_data.email != user.email:
        email_conflict = db.query(models.User).filter(
            models.User.email == account_data.email,
            models.User.user_id != user.user_id
        ).first()
        if email_conflict:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That email address is already registered to another user."
            )
        user.email = account_data.email

    user.user_password = account_data.user_password
    db.commit()
    db.refresh(user)

    return {
        "message": "Student Portal account created and activated successfully.",
        "user_id": user.user_id,
        "full_name": user.full_name,
        "email": user.email,
        "approved_application_id": application.application_id,
        "course_id": application.course_id,
        "has_portal_account": True
    }


@router.post("/users/{user_id}/create-student-account")
def create_student_portal_account(
    user_id: str,
    account_data: schemas.StudentPortalAccountCreate,
    db: Session = Depends(get_db)
):
    """Provision a Student Portal login account ONLY after the student's application is APPROVED, enforcing 1 account per user_id."""
    normalized_id = user_id.strip().upper()
    user = db.query(models.User).filter(models.User.user_id == normalized_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate User ID not found."
        )

    approved_app = db.query(models.Application).filter(
        models.Application.user_id == user.user_id,
        models.Application.status == models.ApplicationStatusEnum.approved
    ).first()

    if not approved_app:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Applicant is NOT YET APPROVED. The candidate's application must be APPROVED by the Registrar/Admin first."
        )

    if user.has_portal_account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Student '{user.full_name}' (User ID: {user.user_id}) ALREADY has an existing Student Portal account ({user.email}). Only one account is allowed per student."
        )

    if account_data.email and account_data.email != user.email:
        email_conflict = db.query(models.User).filter(
            models.User.email == account_data.email,
            models.User.user_id != user.user_id
        ).first()
        if email_conflict:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That email address is already registered to another user."
            )
        user.email = account_data.email

    user.user_password = account_data.user_password
    db.commit()
    db.refresh(user)

    return {
        "message": "Student Portal account created and activated successfully.",
        "user_id": user.user_id,
        "full_name": user.full_name,
        "email": user.email,
        "approved_application_id": approved_app.application_id,
        "course_id": approved_app.course_id,
        "has_portal_account": True
    }


@router.post("/users/register", status_code=status.HTTP_201_CREATED)
def register_user(user: schemas.UserRegister, db: Session = Depends(get_db)):
    existing_user = db.query(models.User).filter(
        models.User.email == user.email
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already registered with another account."
        )

    generated_user_id = f"USER-{uuid.uuid4().hex[:8].upper()}"

    db_user = models.User(
        user_id=generated_user_id,
        email=user.email,
        user_password=models.UNPROVISIONED_PASSWORD,
        full_name=user.full_name,
        phone_number=user.phone_number,
        user_type=user.user_type
    )

    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return {
        "message": "Applicant registered successfully",
        "user_id": db_user.user_id,
        "email": db_user.email,
        "full_name": db_user.full_name,
        "has_portal_account": db_user.has_portal_account
    }


@router.get("/users/{user_id}/role")
def check_user_role(user_id: str, db: Session = Depends(get_db)):
    normalized_id = user_id.strip().upper()
    user = db.query(models.User).filter(models.User.user_id == normalized_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student User ID '{normalized_id}' not found."
        )
    all_apps = db.query(models.Application).filter(
        models.Application.user_id == user.user_id
    ).order_by(models.Application.created_at.desc()).all()

    approved_apps = [a for a in all_apps if a.status == models.ApplicationStatusEnum.approved]
    primary_app = approved_apps[0] if approved_apps else (all_apps[0] if all_apps else None)

    return {
        "user_id": user.user_id,
        "full_name": user.full_name,
        "email": user.email,
        "phone_number": user.phone_number,
        "user_type": user.user_type,
        "has_portal_account": user.has_portal_account,
        "is_approved": len(approved_apps) > 0,
        "total_applications": len(all_apps),
        "approved_count": len(approved_apps),
        "primary_application": {
            "application_id": primary_app.application_id,
            "course_id": primary_app.course_id,
            "course_name": primary_app.program.course_name if primary_app.program else primary_app.course_id,
            "status": primary_app.status.value
        } if primary_app else None,
        "applications": [
            {
                "application_id": a.application_id,
                "course_id": a.course_id,
                "course_name": a.program.course_name if a.program else a.course_id,
                "status": a.status.value
            }
            for a in all_apps
        ]
    }


@router.post("/users/{user_id}/verify-admin")
def verify_admin_login(
    user_id: str,
    credentials: schemas.AdminLoginRequest,
    db: Session = Depends(get_db)
):
    seed_default_admin()

    normalized_id = user_id.strip()
    user = db.query(models.User).filter(
        models.User.user_id == normalized_id
    ).first()
    if not user or user.user_id != normalized_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admin ID not found. Note: Admin ID is case-sensitive."
        )

    if user.user_password != credentials.user_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password."
        )

    if user.user_type != models.UserAccessEnum.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access Denied: User '{user.full_name}' is not an administrator."
        )

    return {
        "user_id": user.user_id,
        "full_name": user.full_name,
        "user_type": user.user_type
    }


@router.post("/users/login")
def login_student(credentials: schemas.StudentLoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(
        models.User.email == credentials.email
    ).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account with this email does not exist."
        )

    if user.user_type == models.UserAccessEnum.student:
        approved_app = db.query(models.Application).filter(
            models.Application.user_id == user.user_id,
            models.Application.status == models.ApplicationStatusEnum.approved
        ).first()
        if not approved_app:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access Denied: Your application must be APPROVED by the Registrar/Admin before you can access the Student Portal."
            )
        if not user.has_portal_account:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your application is approved, but your Student Portal account has not been created by the Registrar/Admin yet."
            )

    if user.user_password != credentials.user_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password."
        )

    return {
        "user_id": user.user_id,
        "full_name": user.full_name,
        "email": user.email,
        "user_type": user.user_type
    }


@router.post("/users/{user_id}/verify-student")
def verify_student_login(
    user_id: str,
    credentials: schemas.StudentIdLoginRequest,
    db: Session = Depends(get_db)
):
    user = db.query(models.User).filter(models.User.user_id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User ID not found."
        )
    if user.user_type == models.UserAccessEnum.student:
        approved_app = db.query(models.Application).filter(
            models.Application.user_id == user.user_id,
            models.Application.status == models.ApplicationStatusEnum.approved
        ).first()
        if not approved_app:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access Denied: Your application must be APPROVED by the Registrar/Admin before you can access the Student Portal."
            )
        if not user.has_portal_account:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your application is approved, but your Student Portal account has not been created by the Registrar/Admin yet."
            )
    if user.user_password != credentials.user_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password."
        )
    return {
        "user_id": user.user_id,
        "full_name": user.full_name,
        "user_type": user.user_type
    }
