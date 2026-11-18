import re
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import Base, engine, get_db
import models
import schemas
from services.auto_enroll import check_application_completeness

router = APIRouter(tags=["Registrar & Admissions Automation"])

STOP_WORDS = {"of", "in", "and", "the", "for", "with", "to", "on", "at"}


def _derive_course_prefix(course_name: str, fallback: str = "CRS") -> str:
    words = re.findall(r"[A-Za-z]+", course_name or "")
    significant = [w for w in words if w.lower() not in STOP_WORDS]
    if len(significant) >= 2:
        acronym = "".join(w[0].upper() for w in significant[:6])
        return acronym
    elif len(significant) == 1:
        return significant[0][:4].upper()
    return fallback


def _generate_unique_course_id(course_name: str, db: Session) -> str:
    prefix = _derive_course_prefix(course_name, "CRS")
    # Check if base prefix itself or numbered variant is free
    for idx in range(1, 1000):
        candidate = f"{prefix}-{str(idx).zfill(3)}"[:25]
        exists = db.query(models.Program).filter(
            models.Program.course_id == candidate
        ).first()
        if not exists:
            return candidate
    return f"{prefix}-{uuid.uuid4().hex[:4].upper()}"[:25]


def _generate_subject_code(course_id: str, semester: int, index: int) -> str:
    base = re.split(r"[-_]", course_id or "SUB")[0].upper()[:6] or "SUB"
    return f"{base}-{semester}{str(index).zfill(2)}"[:25]


DEFAULT_SEMESTER_TEMPLATES = {
    1: [
        ("Introduction to Computing & Systems", 3),
        ("Fundamentals of Programming 1", 3),
        ("Discrete Mathematics & Logic", 3),
        ("Purposive Communication", 3),
        ("Understanding the Self", 3),
        ("Mathematics in the Modern World", 3),
        ("Computer Laboratory Workshop 1", 3),
    ],
    2: [
        ("Intermediate Programming & OOP", 3),
        ("Data Structures & Algorithms", 3),
        ("Relational Database Management Systems", 3),
        ("Operating Systems & Shell Scripting", 3),
        ("Science, Technology, and Society", 3),
        ("Information Security Fundamentals", 3),
        ("Applied Software Engineering Lab", 3),
    ],
}


_schema_migrated = False


def ensure_programs_and_subjects_seeded(db: Session):
    """Ensure subjects & grades tables and new instructor/room columns exist in the database."""
    global _schema_migrated
    Base.metadata.create_all(bind=engine)
    if not _schema_migrated:
        if engine.dialect.name == "postgresql":
            for stmt in (
                "ALTER TABLE subjects ADD COLUMN IF NOT EXISTS instructor_name VARCHAR(150) DEFAULT 'N/A'",
                "ALTER TABLE subjects ADD COLUMN IF NOT EXISTS room VARCHAR(50) DEFAULT 'N/A'",
                "ALTER TABLE grades ALTER COLUMN prelim TYPE NUMERIC(5, 2)",
                "ALTER TABLE grades ALTER COLUMN midterm TYPE NUMERIC(5, 2)",
                "ALTER TABLE grades ALTER COLUMN final TYPE NUMERIC(5, 2)",
                "ALTER TABLE grades ALTER COLUMN gwa TYPE NUMERIC(5, 2)",
            ):
                try:
                    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                        conn.execute(text(stmt))
                except Exception:
                    pass
        elif engine.dialect.name == "sqlite":
            for col_def in (
                "ALTER TABLE subjects ADD COLUMN instructor_name VARCHAR(150) DEFAULT 'N/A'",
                "ALTER TABLE subjects ADD COLUMN room VARCHAR(50) DEFAULT 'N/A'",
            ):
                try:
                    with engine.connect() as conn:
                        conn.execute(text(col_def))
                        conn.commit()
                except Exception:
                    pass
        _schema_migrated = True


@router.get("/programs/all", response_model=List[schemas.ProgramResponse])
def list_all_programs(db: Session = Depends(get_db)):
    ensure_programs_and_subjects_seeded(db)
    return db.query(models.Program).all()


@router.patch("/programs/{course_id}/toggle-active", response_model=schemas.ProgramResponse)
def toggle_program_active_status(course_id: str, db: Session = Depends(get_db)):
    """Toggle a course's is_active status (open/closed for new enrollment) without affecting enrolled students."""
    ensure_programs_and_subjects_seeded(db)
    normalized_id = course_id.strip()

    db_program = db.query(models.Program).filter(
        models.Program.course_id == normalized_id
    ).first()
    if not db_program:
        db_program = db.query(models.Program).filter(
            models.Program.course_id == normalized_id.upper()
        ).first()

    if not db_program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course '{normalized_id}' not found."
        )

    db_program.is_active = not bool(db_program.is_active)
    db.commit()
    db.refresh(db_program)
    return db_program


@router.delete("/programs/{course_id}")
def delete_program_and_subjects(course_id: str, db: Session = Depends(get_db)):
    """Delete a course and its subjects only if no students are enrolled in it (respecting ON DELETE RESTRICT)."""
    ensure_programs_and_subjects_seeded(db)
    normalized_id = course_id.strip()

    db_program = db.query(models.Program).filter(
        models.Program.course_id == normalized_id
    ).first()
    if not db_program:
        db_program = db.query(models.Program).filter(
            models.Program.course_id == normalized_id.upper()
        ).first()

    if not db_program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course '{normalized_id}' not found."
        )

    target_course_id = db_program.course_id

    # Check applications linked to this course
    linked_apps = db.query(models.Application).filter(
        models.Application.course_id == target_course_id
    ).all()

    enrolled_or_active_apps = []
    empty_draft_apps = []
    for app in linked_apps:
        has_docs = len(app.documents or []) > 0
        has_payments = len(app.payments or []) > 0
        if app.status != models.ApplicationStatusEnum.draft or has_docs or has_payments:
            enrolled_or_active_apps.append(app)
        else:
            empty_draft_apps.append(app)

    if enrolled_or_active_apps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cannot delete course '{target_course_id}' because {len(enrolled_or_active_apps)} student(s) "
                f"are currently enrolled or have active applications in it (ON DELETE RESTRICT). "
                f"Please click 'Deactivate' to set is_active = FALSE instead."
            )
        )

    # Reassign any empty auto-backfilled draft placeholders if another program exists
    if empty_draft_apps:
        fallback_program = db.query(models.Program).filter(
            models.Program.course_id != target_course_id
        ).first()
        if not fallback_program:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Cannot delete course '{target_course_id}' because {len(empty_draft_apps)} draft applicant(s) "
                    f"reference it and no other course exists to reassign them."
                )
            )
        for app in empty_draft_apps:
            app.course_id = fallback_program.course_id
        db.flush()

    # Delete all associated subjects for this course from the subjects table
    deleted_subjects_count = db.query(models.Subject).filter(
        models.Subject.course_id == target_course_id
    ).delete(synchronize_session=False)

    # Delete the course itself from the programs table
    db.delete(db_program)
    db.commit()

    return {
        "message": f"Course '{target_course_id}' and {deleted_subjects_count} associated subject(s) were permanently deleted from the database.",
        "course_id": target_course_id,
        "deleted_subjects": deleted_subjects_count
    }


@router.get("/programs/{course_id}/subjects", response_model=List[schemas.SubjectResponse])
def get_program_subjects(
    course_id: str,
    semester: Optional[int] = Query(None, ge=1, le=2),
    db: Session = Depends(get_db)
):
    ensure_programs_and_subjects_seeded(db)
    normalized_id = course_id.strip()
    query = db.query(models.Subject).filter(models.Subject.course_id == normalized_id)
    if semester in (1, 2):
        query = query.filter(models.Subject.semester == semester)
    return query.order_by(models.Subject.semester, models.Subject.subject_code).all()


@router.post("/programs/publish", response_model=schemas.ProgramResponse, status_code=status.HTTP_201_CREATED)
def publish_course_curriculum(
    payload: schemas.CoursePublishRequest,
    db: Session = Depends(get_db)
):
    """Publish or update a course and its subjects for a specific semester, enforcing the 21-unit load rule."""
    Base.metadata.create_all(bind=engine)

    if not payload.course_name or not payload.course_name.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Course / Degree Program Title is required."
        )

    if not payload.subjects or len(payload.subjects) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please add at least one subject to the course curriculum."
        )

    total_units = sum(int(s.units) for s in payload.subjects)
    if total_units != 21:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mandatory Curriculum Load Rule Violation: Every published course curriculum must total EXACTLY 21 academic units (received {total_units} units)."
        )

    raw_course_id = (payload.course_id or "").strip().upper()
    if not raw_course_id:
        raw_course_id = _generate_unique_course_id(payload.course_name, db)
    else:
        raw_course_id = raw_course_id[:25]

    target_semester = int(payload.semester) if payload.semester in (1, 2) else 1

    # Prevent reusing the same course_id across different semesters
    conflicting_subject = (
        db.query(models.Subject)
        .filter(
            models.Subject.course_id == raw_course_id,
            models.Subject.semester != target_semester,
        )
        .first()
    )
    if conflicting_subject:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Course ID '{raw_course_id}' is already assigned to Semester "
                f"{conflicting_subject.semester}. Create a new self-generated Course ID "
                f"for Semester {target_semester}."
            ),
        )

    db_program = db.query(models.Program).filter(
        models.Program.course_id == raw_course_id
    ).first()

    if not db_program:
        db_program = models.Program(
            course_id=raw_course_id,
            course_name=payload.course_name.strip()[:100],
            academic_year=(payload.academic_year or "2026-2027").strip()[:25],
            is_active=payload.is_active
        )
        db.add(db_program)
        db.commit()
        db.refresh(db_program)
    else:
        db_program.course_name = payload.course_name.strip()[:100]
        db_program.academic_year = (payload.academic_year or "2026-2027").strip()[:25]
        db_program.is_active = payload.is_active
        db.commit()

    # Preserve existing subject IDs where possible so encoded grades stay intact
    existing_subjects = {
        s.subject_id: s
        for s in db.query(models.Subject).filter(
            models.Subject.course_id == db_program.course_id,
            models.Subject.semester == target_semester
        ).all()
    }
    kept_ids = set()

    for idx, subj in enumerate(payload.subjects, start=1):
        incoming_id = (subj.subject_id or "").strip().upper()
        custom_code = (subj.subject_code or "").strip().upper()
        final_code = custom_code[:25] if custom_code else _generate_subject_code(
            db_program.course_id, target_semester, idx
        )
        instructor_val = (subj.instructor_name or "N/A").strip()[:150] or "N/A"
        room_val = (subj.room or "N/A").strip()[:50] or "N/A"

        if incoming_id and incoming_id in existing_subjects:
            db_subject = existing_subjects[incoming_id]
            db_subject.subject_code = final_code
            db_subject.subject_name = subj.subject_name.strip()[:150]
            db_subject.units = int(subj.units)
            db_subject.instructor_name = instructor_val
            db_subject.room = room_val
            kept_ids.add(incoming_id)
        else:
            generated_subject_id = incoming_id[:25] if (incoming_id and incoming_id.startswith("SUB-")) else f"SUB-{uuid.uuid4().hex[:8].upper()}"
            # Ensure global subject_id uniqueness if recycled ID exists elsewhere
            id_clash = db.query(models.Subject).filter(models.Subject.subject_id == generated_subject_id).first()
            if id_clash:
                generated_subject_id = f"SUB-{uuid.uuid4().hex[:8].upper()}"
            db_subject = models.Subject(
                subject_id=generated_subject_id,
                course_id=db_program.course_id,
                subject_code=final_code,
                subject_name=subj.subject_name.strip()[:150],
                units=int(subj.units),
                semester=target_semester,
                instructor_name=instructor_val,
                room=room_val
            )
            db.add(db_subject)
            kept_ids.add(generated_subject_id)

    # Remove subjects that were explicitly deleted from this semester
    for old_id, old_obj in existing_subjects.items():
        if old_id not in kept_ids:
            db.delete(old_obj)

    db.commit()
    db.refresh(db_program)
    return db_program


@router.patch("/subjects/{subject_id}/instructor", response_model=schemas.SubjectResponse)
def update_subject_instructor(
    subject_id: str,
    payload: schemas.SubjectInstructorUpdate,
    db: Session = Depends(get_db)
):
    """Assign or update a faculty instructor and room for a specific subject."""
    ensure_programs_and_subjects_seeded(db)
    subj = db.query(models.Subject).filter(models.Subject.subject_id == subject_id.strip()).first()
    if not subj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subject ID '{subject_id}' not found."
        )
    subj.instructor_name = (payload.instructor_name or "N/A").strip()[:150] or "N/A"
    subj.room = (payload.room or "N/A").strip()[:50] or "N/A"
    db.commit()
    db.refresh(subj)
    return subj


def _compute_grade_summary(prelim: Optional[float], midterm: Optional[float], final: Optional[float]):
    """Compute weighted percentage average (30% Prelim, 30% Midterm, 40% Final) and remarks."""
    if prelim is not None and midterm is not None and final is not None:
        pct = round(prelim * 0.30 + midterm * 0.30 + final * 0.40, 2)
        if pct >= 97.0:
            remark = "Excellent"
        elif pct >= 90.0:
            remark = "Superior"
        elif pct >= 82.0:
            remark = "Satisfactory"
        elif pct >= 75.0:
            remark = "Passing"
        else:
            remark = "Failed"
        return pct, remark

    available = [v for v in (prelim, midterm, final) if v is not None]
    if not available:
        return None, "Pending"
    partial_avg = round(sum(available) / len(available), 2)
    return partial_avg, "Incomplete (In Progress)"


@router.get("/subjects/{subject_id}/grades")
def get_subject_grade_roster(subject_id: str, db: Session = Depends(get_db)):
    """Fetch all approved/enrolled students for a subject's course along with their current grades."""
    ensure_programs_and_subjects_seeded(db)
    subj = db.query(models.Subject).filter(models.Subject.subject_id == subject_id.strip()).first()
    if not subj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subject '{subject_id}' not found."
        )

    program = db.query(models.Program).filter(models.Program.course_id == subj.course_id).first()

    # Enrolled students: approved applications for this course_id
    enrolled_apps = db.query(models.Application).filter(
        models.Application.course_id == subj.course_id,
        models.Application.status == models.ApplicationStatusEnum.approved
    ).order_by(models.Application.created_at.asc()).all()

    existing_grades = {
        g.application_id: g
        for g in db.query(models.Grade).filter(models.Grade.subject_id == subj.subject_id).all()
    }

    roster = []
    for app in enrolled_apps:
        g = existing_grades.get(app.application_id)
        roster.append({
            "application_id": app.application_id,
            "user_id": app.user_id,
            "full_name": app.user.full_name if app.user else app.user_id,
            "email": app.user.email if app.user else "",
            "course_id": app.course_id,
            "prelim": float(g.prelim) if (g and g.prelim is not None) else None,
            "midterm": float(g.midterm) if (g and g.midterm is not None) else None,
            "final": float(g.final) if (g and g.final is not None) else None,
            "gwa": float(g.gwa) if (g and g.gwa is not None) else None,
            "remarks": g.remarks if g else "Pending",
            "is_locked": bool(g.is_locked) if g else False,
            "encoded_by": g.encoded_by if g else "N/A",
            "updated_at": g.updated_at.isoformat() if (g and g.updated_at) else None
        })

    return {
        "subject": {
            "subject_id": subj.subject_id,
            "course_id": subj.course_id,
            "course_name": program.course_name if program else subj.course_id,
            "academic_year": program.academic_year if program else "2026-2027",
            "subject_code": subj.subject_code,
            "subject_name": subj.subject_name,
            "units": subj.units,
            "semester": subj.semester,
            "instructor_name": subj.instructor_name or "N/A",
            "room": subj.room or "N/A"
        },
        "roster": roster
    }


@router.post("/subjects/{subject_id}/grades")
def save_subject_grades(
    subject_id: str,
    payload: schemas.GradeBatchSaveRequest,
    db: Session = Depends(get_db)
):
    """Save or lock encoded Prelim/Midterm/Final grades for students enrolled in a subject."""
    ensure_programs_and_subjects_seeded(db)
    subj = db.query(models.Subject).filter(models.Subject.subject_id == subject_id.strip()).first()
    if not subj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subject '{subject_id}' not found."
        )

    saved_count = 0
    for entry in payload.entries:
        app_id = entry.application_id.strip().upper()
        app = db.query(models.Application).filter(
            models.Application.application_id == app_id
        ).first()
        if not app:
            continue

        gwa, remark = _compute_grade_summary(entry.prelim, entry.midterm, entry.final)

        grade_row = db.query(models.Grade).filter(
            models.Grade.application_id == app_id,
            models.Grade.subject_id == subj.subject_id
        ).first()

        should_lock = bool(payload.lock_all) if entry.is_locked is None else bool(entry.is_locked)

        if not grade_row:
            grade_row = models.Grade(
                grade_id=f"GRD-{uuid.uuid4().hex[:8].upper()}",
                application_id=app_id,
                subject_id=subj.subject_id,
                prelim=entry.prelim,
                midterm=entry.midterm,
                final=entry.final,
                gwa=gwa,
                remarks=remark,
                is_locked=should_lock,
                encoded_by=payload.encoded_by or "Admin Registrar"
            )
            db.add(grade_row)
        else:
            grade_row.prelim = entry.prelim
            grade_row.midterm = entry.midterm
            grade_row.final = entry.final
            grade_row.gwa = gwa
            grade_row.remarks = remark
            if payload.lock_all:
                grade_row.is_locked = True
            elif entry.is_locked is not None:
                grade_row.is_locked = entry.is_locked
            grade_row.encoded_by = payload.encoded_by or grade_row.encoded_by or "Admin Registrar"

        saved_count += 1

    db.commit()
    return {
        "message": f"Successfully {'locked' if payload.lock_all else 'saved'} grades for {saved_count} student(s) in {subj.subject_code}.",
        "subject_id": subj.subject_id,
        "saved_count": saved_count,
        "locked": payload.lock_all
    }


@router.post("/programs/", response_model=schemas.ProgramResponse, status_code=status.HTTP_201_CREATED)
def create_program(program: schemas.ProgramCreate, db: Session = Depends(get_db)):
    existing_program = db.query(models.Program).filter(
        models.Program.course_id == program.course_id
    ).first()
    if existing_program:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Program course ID already exists."
        )

    db_program = models.Program(
        course_id=program.course_id,
        course_name=program.course_name,
        academic_year=program.academic_year,
        is_active=program.is_active
    )

    db.add(db_program)
    db.commit()
    db.refresh(db_program)
    return db_program


@router.get("/admin/applications", response_model=List[schemas.ApplicationDetailResponse])
def admin_list_all_applications(db: Session = Depends(get_db)):
    ensure_programs_and_subjects_seeded(db)
    # Ensure any registered student applicant without an application row yet gets an initial draft dossier
    default_program = db.query(models.Program).filter(models.Program.is_active == True).first()
    if default_program:
        students = db.query(models.User).filter(
            models.User.user_type == models.UserAccessEnum.student
        ).all()
        created_any = False
        for student in students:
            has_app = db.query(models.Application).filter(
                models.Application.user_id == student.user_id
            ).first()
            if not has_app:
                draft_app = models.Application(
                    application_id=f"APP-{uuid.uuid4().hex[:8].upper()}",
                    user_id=student.user_id,
                    course_id=default_program.course_id,
                    status=models.ApplicationStatusEnum.draft
                )
                db.add(draft_app)
                created_any = True
        if created_any:
            db.commit()

    return db.query(models.Application).order_by(models.Application.created_at.desc()).all()


@router.patch("/applications/{application_id}/status", response_model=schemas.ApplicationDetailResponse)
def update_application_status(
    application_id: str,
    status_update: schemas.ApplicationUpdateStatus,
    db: Session = Depends(get_db)
):
    normalized_id = application_id.strip().upper()
    application = db.query(models.Application).filter(
        models.Application.application_id == normalized_id
    ).first()

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application ID not found."
        )

    application.status = status_update.status
    db.commit()
    db.refresh(application)
    return application


@router.post("/applications/{application_id}/tuition-payment", response_model=schemas.ApplicationDetailResponse)
def record_tuition_payment(
    application_id: str,
    tuition_payment: schemas.TuitionPaymentCreate,
    db: Session = Depends(get_db)
):
    normalized_id = application_id.strip().upper()
    application = db.query(models.Application).filter(
        models.Application.application_id == normalized_id
    ).first()

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application ID '{normalized_id}' not found."
        )

    tag = (tuition_payment.milestone_label or "TUITION").upper().replace(" ", "")[:10]
    ref_number = f"TUI-{tag}-{uuid.uuid4().hex[:6].upper()}"

    db_payment = models.Payment(
        payment_id=f"PAY-{uuid.uuid4().hex[:8].upper()}",
        application_id=normalized_id,
        amount=tuition_payment.amount,
        payment_method=tuition_payment.payment_method,
        reference_number=ref_number,
        status=models.PaymentStatusEnum.completed
    )
    db.add(db_payment)
    db.commit()
    db.refresh(application)
    return application


@router.get("/registrar/applications/{application_id}/check")
def check_application_automation_status(application_id: str, db: Session = Depends(get_db)):
    """Check if an application satisfies all requirements for automated enrollment approval."""
    application = db.query(models.Application).filter(
        models.Application.application_id == application_id
    ).first()
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application ID not found."
        )
    return check_application_completeness(application)
