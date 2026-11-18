from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field
from models import UserAccessEnum, ApplicationStatusEnum, PaymentMethodEnum, PaymentStatusEnum


# ==========================================
# 1. USERS SCHEMAS
# ==========================================
class UserBase(BaseModel):
    user_id: str = Field(..., max_length=25)
    email: EmailStr
    full_name: str = Field(..., max_length=255)
    phone_number: Optional[str] = Field(None, max_length=25)
    user_type: UserAccessEnum = UserAccessEnum.student
    has_portal_account: bool = False

    class Config:
        from_attributes = True


class UserCreate(UserBase):
    user_password: str = Field(..., min_length=6, max_length=255)


class UserResponse(UserBase):
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True  # Allows SQLAlchemy model conversion


# ==========================================
# 2. PROGRAMS, SUBJECTS & GRADES SCHEMAS
# ==========================================
class SubjectInput(BaseModel):
    subject_id: Optional[str] = Field(None, max_length=25)
    subject_code: Optional[str] = Field(None, max_length=25)
    subject_name: str = Field(..., max_length=150)
    units: int = Field(3, ge=1, le=21)
    semester: int = Field(1, ge=1, le=2)
    instructor_name: Optional[str] = Field("N/A", max_length=150)
    room: Optional[str] = Field("N/A", max_length=50)


class SubjectInstructorUpdate(BaseModel):
    instructor_name: Optional[str] = Field("N/A", max_length=150)
    room: Optional[str] = Field("N/A", max_length=50)


class SubjectResponse(BaseModel):
    subject_id: str
    course_id: str
    subject_code: str
    subject_name: str
    units: int
    semester: int
    instructor_name: Optional[str] = "N/A"
    room: Optional[str] = "N/A"
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class GradeResponse(BaseModel):
    grade_id: str
    application_id: str
    subject_id: str
    prelim: Optional[float] = None
    midterm: Optional[float] = None
    final: Optional[float] = None
    gwa: Optional[float] = None
    remarks: Optional[str] = "Pending"
    is_locked: bool = False
    encoded_by: Optional[str] = "Admin Registrar"
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class GradeEntryInput(BaseModel):
    application_id: str = Field(..., max_length=25)
    prelim: Optional[float] = Field(None, ge=0.0, le=100.0)
    midterm: Optional[float] = Field(None, ge=0.0, le=100.0)
    final: Optional[float] = Field(None, ge=0.0, le=100.0)
    is_locked: Optional[bool] = None


class GradeBatchSaveRequest(BaseModel):
    encoded_by: Optional[str] = Field("Admin Registrar", max_length=100)
    lock_all: bool = False
    entries: List[GradeEntryInput] = []


class ProgramBase(BaseModel):
    course_id: str = Field(..., max_length=25)
    course_name: str = Field(..., max_length=100)
    academic_year: str = Field(..., max_length=25)
    is_active: bool = True


class ProgramCreate(ProgramBase):
    pass


class ProgramResponse(ProgramBase):
    subjects: List[SubjectResponse] = []

    class Config:
        from_attributes = True


class CoursePublishRequest(BaseModel):
    course_id: Optional[str] = Field(None, max_length=25)
    course_name: str = Field(..., max_length=100)
    academic_year: str = Field("2026-2027", max_length=25)
    semester: int = Field(1, ge=1, le=2)
    is_active: bool = True
    subjects: List[SubjectInput] = []


# ==========================================
# 3. DOCUMENTS SCHEMAS
# ==========================================
class DocumentCreate(BaseModel):
    document_id: str = Field(..., max_length=25)
    application_id: str = Field(..., max_length=25)
    document_type: str = Field(..., max_length=100)
    file_path: str = Field(..., max_length=255)
    file_name: str = Field(..., max_length=255)
    file_type: str = Field(..., max_length=100)


class DocumentResponse(BaseModel):
    document_id: str
    application_id: str
    document_type: str
    file_path: str
    file_name: str
    file_type: str

    class Config:
        from_attributes = True


# ==========================================
# 4. PAYMENTS SCHEMAS
# ==========================================
class PaymentCreate(BaseModel):
    application_id: str = Field(..., max_length=25)
    amount: float = Field(..., gt=0)
    payment_method: PaymentMethodEnum


class PaymentResponse(BaseModel):
    payment_id: str
    application_id: str
    amount: float
    payment_method: PaymentMethodEnum
    reference_number: str
    status: PaymentStatusEnum

    class Config:
        from_attributes = True


# ==========================================
# 5. APPLICATIONS SCHEMAS
# ==========================================
class ApplicationCreate(BaseModel):
    user_id: str = Field(..., max_length=25)
    course_id: str = Field(..., max_length=25)
    application_id: Optional[str] = Field(None, max_length=25)


class ApplicationUpdateStatus(BaseModel):
    status: ApplicationStatusEnum


class ApplicationResponse(BaseModel):
    application_id: str
    user_id: str
    course_id: str
    status: ApplicationStatusEnum
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Defined here *after* ProgramResponse, DocumentResponse, and PaymentResponse
class ApplicationDetailResponse(BaseModel):
    application_id: str
    user_id: str
    course_id: str
    status: ApplicationStatusEnum
    created_at: datetime
    updated_at: datetime

    # Nested relations for complete visibility
    user: Optional[UserBase] = None
    program: Optional[ProgramResponse] = None
    documents: List[DocumentResponse] = []
    payments: List[PaymentResponse] = []
    grades: List[GradeResponse] = []

    class Config:
        from_attributes = True


class UserRegister(BaseModel):
    email: EmailStr
    full_name: str = Field(..., max_length=255)
    phone_number: Optional[str] = Field(None, max_length=25)
    user_password: Optional[str] = Field(None, max_length=255)
    user_type: UserAccessEnum = UserAccessEnum.student


class ApplicantCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., max_length=255)
    phone_number: Optional[str] = Field(None, max_length=25)
    course_id: Optional[str] = Field(None, max_length=25)


class StudentPortalAccountCreate(BaseModel):
    email: Optional[EmailStr] = None
    user_password: str = Field(..., min_length=6, max_length=255)


class DocumentChecklistUpdate(BaseModel):
    application_id: str = Field(..., max_length=25)
    checked_documents: List[str] = []


class TuitionPaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    payment_method: PaymentMethodEnum = PaymentMethodEnum.gcash
    milestone_label: Optional[str] = Field(None, max_length=50)


class AdminLoginRequest(BaseModel):
    user_password: str


class StudentLoginRequest(BaseModel):
    email: str
    user_password: str


class StudentIdLoginRequest(BaseModel):
    user_password: str
