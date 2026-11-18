"""Registrar Automated Enrollment Service.

Centralizes automated checks for student applications (required documents,
completed payment verification, and eligibility for automatic approval).
"""
import models

REQUIRED_DOCUMENT_TYPES = {"Report Card", "Birth Certificate"}


def check_application_completeness(application: models.Application) -> dict:
    """Evaluate whether an application has all required documents and verified payment."""
    uploaded_types = {doc.document_type for doc in (application.documents or [])}
    missing_docs = list(REQUIRED_DOCUMENT_TYPES - uploaded_types)

    has_completed_payment = any(
        pay.status == models.PaymentStatusEnum.completed
        for pay in (application.payments or [])
    )

    return {
        "application_id": application.application_id,
        "has_all_documents": len(missing_docs) == 0,
        "missing_documents": missing_docs,
        "has_completed_payment": has_completed_payment,
        "ready_for_auto_approval": len(missing_docs) == 0 and has_completed_payment,
    }
