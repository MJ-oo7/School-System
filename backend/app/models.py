from sqlalchemy import Column, String, Boolean, Numeric, Integer, SmallInteger, TIMESTAMP, ForeignKey, Enum as SQLEnum
from sqlalchemy.sql import func
from database import Base
import enum
from sqlalchemy.orm import relationship

# Python Enums matching your PostgreSQL ENUM types


class UserAccessEnum(str, enum.Enum):
    student = "student"
    employee = "employee"
    admin = "admin"


class ApplicationStatusEnum(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    under_review = "under_review"
    approved = "approved"
    rejected = "rejected"


class PaymentMethodEnum(str, enum.Enum):
    cash = "cash"
    gcash = "gcash"
    debit_card = "debit_card"
    credit_card = "credit_card"


class PaymentStatusEnum(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"


UNPROVISIONED_PASSWORD = "__PENDING_APPROVAL__"


# 1. USERS MODEL
class User(Base):
    __tablename__ = "users"

    user_id = Column(String(25), primary_key=True, index=True)
    email = Column(String(100), unique=True, nullable=False, index=True)
    user_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    phone_number = Column(String(25), nullable=True)
    user_type = Column(SQLEnum(UserAccessEnum), server_default="student")
    created_at = Column(TIMESTAMP(timezone=True),
                        server_default=func.current_timestamp())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.current_timestamp(
    ), onupdate=func.current_timestamp())

    @property
    def has_portal_account(self) -> bool:
        return bool(self.user_password and self.user_password != UNPROVISIONED_PASSWORD)


# 2. PROGRAMS MODEL
class Program(Base):
    __tablename__ = "programs"

    course_id = Column(String(25), primary_key=True, index=True)
    course_name = Column(String(100), nullable=False)
    academic_year = Column(String(25), nullable=False)
    is_active = Column(Boolean, server_default="true")

    subjects = relationship(
        "Subject", backref="program", cascade="all, delete", order_by="Subject.semester, Subject.subject_code"
    )


# 2B. SUBJECTS MODEL
class Subject(Base):
    __tablename__ = "subjects"

    subject_id = Column(String(25), primary_key=True, index=True)
    course_id = Column(String(25), ForeignKey(
        "programs.course_id", ondelete="CASCADE"), nullable=False, index=True)
    subject_code = Column(String(25), nullable=False)
    subject_name = Column(String(150), nullable=False)
    units = Column(Integer, nullable=False, default=3)
    semester = Column(SmallInteger, nullable=False, default=1)
    instructor_name = Column(String(150), nullable=True, server_default="N/A")
    room = Column(String(50), nullable=True, server_default="N/A")
    created_at = Column(TIMESTAMP(timezone=True),
                        server_default=func.current_timestamp())


# 3. APPLICATIONS MODEL
class Application(Base):
    __tablename__ = "applications"

    application_id = Column(String(25), primary_key=True, index=True)
    user_id = Column(String(25), ForeignKey(
        "users.user_id", ondelete="CASCADE"), nullable=False)
    course_id = Column(String(25), ForeignKey(
        "programs.course_id", ondelete="RESTRICT"), nullable=False)
    status = Column(SQLEnum(ApplicationStatusEnum), server_default="draft")
    created_at = Column(TIMESTAMP(timezone=True),
                        server_default=func.current_timestamp())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.current_timestamp(
    ), onupdate=func.current_timestamp())

    # Add relationships for easy querying
    user = relationship("User")
    program = relationship("Program")
    documents = relationship(
        "Document", backref="application", cascade="all, delete")
    payments = relationship(
        "Payment", backref="application", cascade="all, delete")
    grades = relationship(
        "Grade", backref="application", cascade="all, delete")


# 3B. GRADES MODEL
class Grade(Base):
    __tablename__ = "grades"

    grade_id = Column(String(25), primary_key=True, index=True)
    application_id = Column(String(25), ForeignKey(
        "applications.application_id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id = Column(String(25), ForeignKey(
        "subjects.subject_id", ondelete="CASCADE"), nullable=False, index=True)
    prelim = Column(Numeric(5, 2), nullable=True)
    midterm = Column(Numeric(5, 2), nullable=True)
    final = Column(Numeric(5, 2), nullable=True)
    gwa = Column(Numeric(5, 2), nullable=True)
    remarks = Column(String(60), nullable=True, server_default="Pending")
    is_locked = Column(Boolean, server_default="false")
    encoded_by = Column(String(100), nullable=True, server_default="Admin Registrar")
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.current_timestamp(
    ), onupdate=func.current_timestamp())

    subject = relationship("Subject")


# 4. DOCUMENTS MODEL
class Document(Base):
    __tablename__ = "documents"

    document_id = Column(String(25), primary_key=True, index=True)
    application_id = Column(String(25), ForeignKey(
        "applications.application_id", ondelete="CASCADE"), nullable=False)
    document_type = Column(String(100), nullable=False)
    file_path = Column(String(255), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_type = Column(String(100), nullable=False)


# 5. PAYMENTS MODEL
class Payment(Base):
    __tablename__ = "payments"

    payment_id = Column(String(25), primary_key=True, index=True)
    application_id = Column(String(25), ForeignKey(
        "applications.application_id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False, default=500.00)
    payment_method = Column(SQLEnum(PaymentMethodEnum), nullable=False)
    reference_number = Column(String(100), nullable=False)
    status = Column(SQLEnum(PaymentStatusEnum), server_default="completed")
    paid_at = Column(TIMESTAMP(timezone=True),
                     server_default=func.current_timestamp())
