import uuid
from typing import List
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
from routers.registrar import ensure_programs_and_subjects_seeded
from services.file_storage import remove_old_file, validate_and_save_upload

router = APIRouter(tags=["Enrollment Workflow"])


@router.get("/programs/", response_model=List[schemas.ProgramResponse])
def list_programs(db: Session = Depends(get_db)):
    ensure_programs_and_subjects_seeded(db)
    return db.query(models.Program).filter(models.Program.is_active == True).all()


@router.post("/applications/", response_model=schemas.ApplicationResponse, status_code=status.HTTP_201_CREATED)
def create_application(application: schemas.ApplicationCreate, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(
        models.User.user_id == application.user_id
    ).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found. Please register or check user ID."
        )

    program = db.query(models.Program).filter(
        models.Program.course_id == application.course_id,
        models.Program.is_active == True
    ).first()
    if not program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active academic program not found."
        )

    existing_course_app = db.query(models.Application).filter(
        models.Application.user_id == application.user_id,
        models.Application.course_id == application.course_id,
        models.Application.status != models.ApplicationStatusEnum.rejected
    ).first()

    if existing_course_app:
        if existing_course_app.status == models.ApplicationStatusEnum.draft:
            return existing_course_app
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"You already have an active application ({existing_course_app.application_id}) for this program."
        )

    if application.application_id:
        active_draft = db.query(models.Application).filter(
            models.Application.application_id == application.application_id,
            models.Application.user_id == application.user_id,
            models.Application.status == models.ApplicationStatusEnum.draft
        ).first()
        if active_draft:
            active_draft.course_id = application.course_id
            db.commit()
            db.refresh(active_draft)
            return active_draft

    generated_app_id = f"APP-{uuid.uuid4().hex[:8].upper()}"

    db_application = models.Application(
        application_id=generated_app_id,
        user_id=application.user_id,
        course_id=application.course_id,
        status=models.ApplicationStatusEnum.draft
    )

    db.add(db_application)
    db.commit()
    db.refresh(db_application)
    return db_application


@router.get("/applications/{application_id}", response_model=schemas.ApplicationDetailResponse)
def get_application_details(application_id: str, db: Session = Depends(get_db)):
    normalized_id = application_id.strip().upper()
    application = db.query(models.Application).filter(
        models.Application.application_id == normalized_id
    ).first()

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application ID '{normalized_id}' not found."
        )
    return application


@router.post("/documents/checklist", response_model=schemas.ApplicationDetailResponse)
def update_document_checklist(
    checklist: schemas.DocumentChecklistUpdate,
    db: Session = Depends(get_db)
):
    normalized_id = checklist.application_id.strip().upper()
    application = db.query(models.Application).filter(
        models.Application.application_id == normalized_id
    ).first()
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application ID not found."
        )

    # Clear existing checklist documents and store the currently checked physical documents
    existing_docs = db.query(models.Document).filter(
        models.Document.application_id == normalized_id
    ).all()
    for doc in existing_docs:
        db.delete(doc)
    db.flush()

    for doc_type in checklist.checked_documents:
        clean_type = doc_type.strip()
        if not clean_type:
            continue
        db_doc = models.Document(
            document_id=f"DOC-{uuid.uuid4().hex[:10].upper()}",
            application_id=normalized_id,
            document_type=clean_type,
            file_path="physical_hand_in/verified",
            file_name="Physical Copy Verified (Hand-Delivered)",
            file_type="physical/checklist"
        )
        db.add(db_doc)

    db.commit()
    db.refresh(application)
    return application


@router.post("/documents/upload", response_model=schemas.DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    application_id: str = Form(...),
    document_type: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    application = db.query(models.Application).filter(
        models.Application.application_id == application_id
    ).first()
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application ID not found. Please create an application first."
        )

    _, relative_file_path = await validate_and_save_upload(file)

    existing_document = db.query(models.Document).filter(
        models.Document.application_id == application_id,
        models.Document.document_type == document_type
    ).first()

    if existing_document:
        remove_old_file(existing_document.file_path)
        existing_document.file_path = relative_file_path
        existing_document.file_name = file.filename
        existing_document.file_type = file.content_type or "application/octet-stream"
        db.commit()
        db.refresh(existing_document)
        return existing_document

    document_id = f"DOC-{uuid.uuid4().hex[:10].upper()}"

    db_document = models.Document(
        document_id=document_id,
        application_id=application_id,
        document_type=document_type,
        file_path=relative_file_path,
        file_name=file.filename,
        file_type=file.content_type or "application/octet-stream"
    )

    db.add(db_document)
    db.commit()
    db.refresh(db_document)

    return db_document


@router.post("/payments/", response_model=schemas.PaymentResponse, status_code=status.HTTP_201_CREATED)
def process_mock_payment(payment: schemas.PaymentCreate, db: Session = Depends(get_db)):
    application = db.query(models.Application).filter(
        models.Application.application_id == payment.application_id
    ).first()

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application ID not found."
        )

    existing_payment = db.query(models.Payment).filter(
        models.Payment.application_id == payment.application_id,
        models.Payment.status == models.PaymentStatusEnum.completed
    ).first()
    if existing_payment or application.status != models.ApplicationStatusEnum.draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment has already been processed for this application."
        )

    if len(application.documents) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please upload both required documents (Report Card and Birth Certificate) before making a payment."
        )

    generated_pay_id = f"PAY-{uuid.uuid4().hex[:8].upper()}"
    generated_ref_number = f"REF-{uuid.uuid4().hex[:10].upper()}"

    db_payment = models.Payment(
        payment_id=generated_pay_id,
        application_id=payment.application_id,
        amount=payment.amount,
        payment_method=payment.payment_method,
        reference_number=generated_ref_number,
        status=models.PaymentStatusEnum.completed
    )

    db.add(db_payment)
    application.status = models.ApplicationStatusEnum.under_review

    db.commit()
    db.refresh(db_payment)

    return db_payment


@router.delete("/payments/enrollment-fee/{application_id}")
def void_enrollment_fee_payment(application_id: str, db: Session = Depends(get_db)):
    """Void and delete the ₱500.00 enrollment fee payment for an application if toggled off before approval."""
    normalized_id = application_id.strip().upper()
    application = db.query(models.Application).filter(
        models.Application.application_id == normalized_id
    ).first()

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application ID not found."
        )

    if application.status in (models.ApplicationStatusEnum.approved, models.ApplicationStatusEnum.rejected):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot void enrollment fee because application '{normalized_id}' is already {application.status.value}."
        )

    # Delete enrollment fee payments (non-tuition payments) for this application
    payments = db.query(models.Payment).filter(
        models.Payment.application_id == normalized_id
    ).all()

    deleted_count = 0
    for pay in payments:
        if not str(pay.reference_number or "").startswith("TUI-"):
            db.delete(pay)
            deleted_count += 1

    application.status = models.ApplicationStatusEnum.draft
    db.commit()

    return {
        "message": "Enrollment fee payment voided and removed from database.",
        "application_id": normalized_id,
        "deleted_payments": deleted_count
    }
