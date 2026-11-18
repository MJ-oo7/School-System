// Prevent VS Code Live Server from force-reloading the page when database files change.
(function () {
    const OriginalWebSocket = window.WebSocket;
    if (!OriginalWebSocket) return;
    window.WebSocket = function (url, protocols) {
        const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
        if (typeof url === "string" && url.includes("/ws")) {
            ws.addEventListener("message", function (event) {
                if (event.data === "reload") {
                    event.stopImmediatePropagation();
                }
            }, true);
            let customOnMessage = null;
            Object.defineProperty(ws, "onmessage", {
                get: function () { return customOnMessage; },
                set: function (fn) {
                    customOnMessage = function (event) {
                        if (event.data === "reload") return;
                        return fn.apply(this, arguments);
                    };
                    ws.addEventListener("message", customOnMessage);
                }
            });
        }
        return ws;
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
})();

var API_BASE = window.API_BASE || "http://127.0.0.1:8000";

const REQUIRED_CHECKLIST_DOCS = [
    "Report Card",
    "Birth Certificate",
    "Good Moral Certificate",
    "2x2 ID Photos"
];

let sessionData = {
    userId: null,
    fullName: null,
    email: null,
    phone: null,
    courseId: null,
    applicationId: null,
    status: "draft",
    checkedDocs: new Set(),
    paymentRef: null
};

let currentWizardStep = "step-applicant";

function exitToAdminPortal() {
    sessionStorage.removeItem("admin_enroll_application_id");
    sessionStorage.removeItem("enrollment_wizard_step");
    sessionStorage.removeItem("enroll_target_user_id");
    sessionStorage.removeItem("enroll_target_name");
    window.location.href = "../registrar-portal/admin.html";
}

function updateHeaderBadge() {
    const badge = document.getElementById("display-user-badge");
    if (!badge) return;
    if (sessionData.applicationId) {
        badge.innerText = `Active Dossier: ${sessionData.applicationId} (${sessionData.fullName || sessionData.userId})`;
    } else {
        badge.innerText = "New Applicant Enrollment Flow";
    }
}

function updateStepperUI(stepId) {
    const stepsOrder = ["step-applicant", "step-documents", "step-payment", "step-decision"];
    const activeIdx = stepsOrder.indexOf(stepId);

    stepsOrder.forEach((sId, idx) => {
        const card = document.getElementById(`indicator-step-${idx + 1}`);
        const badge = document.getElementById(`badge-step-${idx + 1}`);
        if (!card || !badge) return;
        card.classList.remove("active-step", "completed-step");
        if (idx < activeIdx) {
            card.classList.add("completed-step");
            badge.innerHTML = "&#10003;";
        } else if (idx === activeIdx) {
            card.classList.add("active-step");
            badge.innerHTML = String(idx + 1);
        } else {
            badge.innerHTML = String(idx + 1);
        }
    });
}

function showStep(stepId) {
    document.querySelectorAll(".wizard-step").forEach(el => el.classList.remove("active"));
    const target = document.getElementById(stepId);
    if (target) target.classList.add("active");
    currentWizardStep = stepId;
    sessionStorage.setItem("enrollment_wizard_step", stepId);
    updateStepperUI(stepId);
    updateHeaderBadge();
    if (stepId === "step-decision") {
        renderDecisionSummary();
    }
}

function undoStep() {
    if (currentWizardStep === "step-decision") {
        showStep("step-payment");
    } else if (currentWizardStep === "step-payment") {
        showStep("step-documents");
    } else if (currentWizardStep === "step-documents") {
        showStep("step-applicant");
    } else {
        exitToAdminPortal();
    }
}

window.onload = async function () {
    await loadProgramsDropdown();

    const params = new URLSearchParams(window.location.search);
    const queryAppId = params.get("app_id") || sessionStorage.getItem("admin_enroll_application_id");

    if (queryAppId) {
        await resumeApplicationById(queryAppId);
    } else {
        showStep("step-applicant");
    }
};

async function loadProgramsDropdown() {
    const selectEl = document.getElementById("applicant-program");
    if (!selectEl) return;
    try {
        const response = await fetch(`${API_BASE}/programs/`);
        if (!response.ok) return;
        const programs = await response.json();
        if (programs.length > 0) {
            selectEl.innerHTML = programs.map(p =>
                `<option value="${p.course_id}">${p.course_id} — ${p.course_name} (${p.academic_year})</option>`
            ).join("");
        }
    } catch (e) {
        // Keep fallback options
    }
}

async function resumeFromLookupInput() {
    const inputEl = document.getElementById("resume-app-id-input");
    const errEl = document.getElementById("applicant-step-error");
    if (errEl) errEl.innerHTML = "";
    const appId = inputEl ? inputEl.value.trim().toUpperCase() : "";
    if (!appId) {
        if (errEl) errEl.innerHTML = "<p class='error-msg'>Please enter an Application ID (e.g., APP-XXXXXXXX) to resume.</p>";
        return;
    }
    await resumeApplicationById(appId);
}

async function resumeApplicationById(applicationId) {
    const errEl = document.getElementById("applicant-step-error");
    if (errEl) errEl.innerHTML = "";
    try {
        const response = await fetch(`${API_BASE}/applications/${encodeURIComponent(applicationId.trim().toUpperCase())}`);
        if (!response.ok) {
            throw new Error(`Application ID '${applicationId}' not found.`);
        }
        const app = await response.json();

        sessionData.applicationId = app.application_id;
        sessionData.userId = app.user_id;
        sessionData.courseId = app.course_id;
        sessionData.status = app.status;
        sessionData.fullName = (app.user && app.user.full_name) ? app.user.full_name : app.user_id;
        sessionData.email = (app.user && app.user.email) ? app.user.email : "";
        sessionData.phone = (app.user && app.user.phone_number) ? app.user.phone_number : "";

        sessionStorage.setItem("admin_enroll_application_id", app.application_id);
        sessionStorage.setItem("enroll_target_user_id", app.user_id);
        sessionStorage.setItem("enroll_target_name", sessionData.fullName);

        // Pre-fill Step 1 fields
        const nameEl = document.getElementById("applicant-fullname");
        const emailEl = document.getElementById("applicant-email");
        const phoneEl = document.getElementById("applicant-phone");
        const progEl = document.getElementById("applicant-program");
        if (nameEl) nameEl.value = sessionData.fullName;
        if (emailEl) emailEl.value = sessionData.email;
        if (phoneEl) phoneEl.value = sessionData.phone;
        if (progEl && app.course_id) progEl.value = app.course_id;

        const activeAppEl = document.getElementById("active-app-id");
        if (activeAppEl) activeAppEl.innerText = app.application_id;

        // Restore checked documents
        sessionData.checkedDocs = new Set();
        if (app.documents && app.documents.length > 0) {
            app.documents.forEach(doc => {
                sessionData.checkedDocs.add(doc.document_type);
            });
        }
        syncChecklistUI();

        // Check payment state
        const hasFeePaid = app.payments && app.payments.length > 0;
        if (hasFeePaid) {
            sessionData.paymentRef = app.payments[0].reference_number;
        }

        // Route to the appropriate step
        if (hasFeePaid) {
            showStep("step-decision");
        } else if (REQUIRED_CHECKLIST_DOCS.every(d => sessionData.checkedDocs.has(d))) {
            showStep("step-payment");
        } else {
            showStep("step-documents");
        }

    } catch (error) {
        if (errEl) errEl.innerHTML = `<p class='error-msg'>Error: ${error.message}</p>`;
        showStep("step-applicant");
    }
}

// STAGE 1: Save Applicant & Initialize Application
async function saveApplicantAndContinue() {
    const fullName = document.getElementById("applicant-fullname").value.trim();
    const email = document.getElementById("applicant-email").value.trim();
    const phone = document.getElementById("applicant-phone").value.trim();
    const courseId = document.getElementById("applicant-program").value;
    const tuitionPlan = document.getElementById("applicant-tuition-plan").value;
    const errEl = document.getElementById("applicant-step-error");
    const btnEl = document.getElementById("btn-step1-continue");
    errEl.innerHTML = "";

    if (!fullName || !email || !courseId) {
        errEl.innerHTML = "<p class='error-msg'>Please fill in the applicant's full name, email address, and academic program.</p>";
        return;
    }

    btnEl.disabled = true;
    btnEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Initializing Application Dossier...`;

    try {
        const response = await fetch(`${API_BASE}/users/applicant`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                full_name: fullName,
                email: email,
                phone_number: phone || null,
                course_id: courseId
            })
        });

        if (!response.ok) {
            const err = await response.json();
            let msg = "Failed to initialize applicant dossier.";
            if (typeof err.detail === "string") msg = err.detail;
            else if (Array.isArray(err.detail)) msg = err.detail.map(e => e.msg).join(", ");
            throw new Error(msg);
        }

        const data = await response.json();
        sessionData.userId = data.user_id;
        sessionData.fullName = data.full_name;
        sessionData.email = data.email;
        sessionData.phone = phone;
        sessionData.courseId = data.course_id || courseId;
        sessionData.applicationId = data.application_id;

        localStorage.setItem(`tuition_plan_user_${data.user_id}`, tuitionPlan);

        // If for any reason application_id wasn't returned, create it explicitly via POST /applications/
        if (!sessionData.applicationId) {
            const appRes = await fetch(`${API_BASE}/applications/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_id: sessionData.userId,
                    course_id: courseId
                })
            });
            if (appRes.ok) {
                const appJson = await appRes.json();
                sessionData.applicationId = appJson.application_id;
            }
        }

        sessionStorage.setItem("admin_enroll_application_id", sessionData.applicationId);
        sessionStorage.setItem("enroll_target_user_id", sessionData.userId);
        sessionStorage.setItem("enroll_target_name", sessionData.fullName);

        document.getElementById("active-app-id").innerText = sessionData.applicationId;
        await resumeApplicationById(sessionData.applicationId);

    } catch (error) {
        errEl.innerHTML = `<p class='error-msg'>Error: ${error.message}</p>`;
    } finally {
        btnEl.disabled = false;
        btnEl.innerHTML = `<span>Save Applicant &amp; Proceed to Document Checklist</span> <i class="fa-solid fa-arrow-right text-xs"></i>`;
    }
}

// STAGE 2: Hand-Delivered Physical Document Checklist
function toggleChecklistItem(docType) {
    if (sessionData.checkedDocs.has(docType)) {
        sessionData.checkedDocs.delete(docType);
    } else {
        sessionData.checkedDocs.add(docType);
    }
    syncChecklistUI();
}

function checkAllDocuments() {
    REQUIRED_CHECKLIST_DOCS.forEach(doc => sessionData.checkedDocs.add(doc));
    syncChecklistUI();
}

function syncChecklistUI() {
    document.querySelectorAll(".checklist-item").forEach(item => {
        const docType = item.getAttribute("data-doc");
        const isChecked = sessionData.checkedDocs.has(docType);
        item.classList.toggle("checked", isChecked);
        const statusSpan = item.querySelector(".checklist-status-label");
        if (statusSpan) {
            statusSpan.innerHTML = isChecked
                ? `<span class="text-emerald-400 font-mono text-[11px] font-bold">HANDED IN &#10003;</span>`
                : `<span class="text-slate-500 font-mono text-[11px]">Pending Hand-In</span>`;
        }
    });

    const count = REQUIRED_CHECKLIST_DOCS.filter(d => sessionData.checkedDocs.has(d)).length;
    const counterEl = document.getElementById("checklist-progress-label");
    if (counterEl) {
        counterEl.innerText = `${count} of ${REQUIRED_CHECKLIST_DOCS.length} Required Documents Checked`;
        counterEl.className = count === REQUIRED_CHECKLIST_DOCS.length
            ? "text-xs font-mono font-bold text-emerald-400"
            : "text-xs font-mono font-bold text-amber-400";
    }
}

async function persistChecklistToBackend() {
    if (!sessionData.applicationId) {
        throw new Error("Application ID not initialized. Please complete Step 1 first.");
    }
    const response = await fetch(`${API_BASE}/documents/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            application_id: sessionData.applicationId,
            checked_documents: Array.from(sessionData.checkedDocs)
        })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to save document checklist.");
    }
    return await response.json();
}

async function saveChecklistAndPause() {
    const errDiv = document.getElementById("doc-validation-error");
    errDiv.innerHTML = "";
    try {
        await persistChecklistToBackend();
        errDiv.innerHTML = `<p class='success-msg'>&#10003; Partial document checklist saved for <strong>${sessionData.fullName}</strong> (${sessionData.applicationId}). Returning to Admissions Queue (you can click <strong>Resume</strong> anytime)...</p>`;
        setTimeout(() => {
            exitToAdminPortal();
        }, 1000);
    } catch (error) {
        errDiv.innerHTML = `<p class='error-msg'>Error: ${error.message}</p>`;
    }
}

async function validateAndProceedToPayment() {
    const errDiv = document.getElementById("doc-validation-error");
    errDiv.innerHTML = "";

    const missing = REQUIRED_CHECKLIST_DOCS.filter(d => !sessionData.checkedDocs.has(d));
    if (missing.length > 0) {
        errDiv.innerHTML = `<p class='error-msg'>Incomplete physical documents (${missing.join(", ")} not checked yet). All 4 documents must be handed in and checked to proceed to payment — or click <strong>"Save Incomplete Progress &amp; Delay Application"</strong> to resume later from the Admissions Queue.</p>`;
        return;
    }

    try {
        await persistChecklistToBackend();
        showStep("step-payment");
    } catch (error) {
        errDiv.innerHTML = `<p class='error-msg'>Error: ${error.message}</p>`;
    }
}

// STAGE 3: Enrollment Fee Payment
function selectPaymentCard(methodValue) {
    const selectEl = document.getElementById("pay-method");
    if (selectEl) selectEl.value = methodValue;
    document.querySelectorAll(".payment-card").forEach(card => card.classList.remove("selected"));
    const activeCard = document.getElementById(`card-${methodValue}`);
    if (activeCard) activeCard.classList.add("selected");
}

async function submitPayment() {
    const method = document.getElementById("pay-method").value;
    const resultDiv = document.getElementById("payment-result");
    resultDiv.innerHTML = "";

    try {
        const response = await fetch(`${API_BASE}/payments/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                application_id: sessionData.applicationId,
                amount: 500.00,
                payment_method: method
            })
        });

        if (!response.ok) {
            const err = await response.json();
            let errorMsg = "Payment processing failed.";
            if (typeof err.detail === "string") errorMsg = err.detail;
            else if (Array.isArray(err.detail)) errorMsg = err.detail.map(e => e.msg || JSON.stringify(e)).join(", ");
            throw new Error(errorMsg);
        }

        const data = await response.json();
        sessionData.paymentRef = data.reference_number;
        sessionData.status = "under_review";

        resultDiv.innerHTML = `<p class='success-msg'>&#10003; Enrollment Fee (₱500.00) confirmed! Receipt Reference: <strong>${data.reference_number}</strong>. Proceeding to Final Admission Decision...</p>`;

        setTimeout(() => {
            showStep("step-decision");
        }, 700);

    } catch (error) {
        resultDiv.innerHTML = `<p class='error-msg'>Error: ${error.message}</p>`;
    }
}

// STAGE 4: Final Admission Decision (Approve or Reject Applicant)
function renderDecisionSummary() {
    document.getElementById("summary-applicant-name").innerText = sessionData.fullName || "-";
    document.getElementById("summary-user-id").innerText = sessionData.userId || "-";
    document.getElementById("summary-app-id").innerText = sessionData.applicationId || "-";
    document.getElementById("summary-course-id").innerText = sessionData.courseId || "-";
    document.getElementById("summary-payment-ref").innerText = sessionData.paymentRef
        ? `₱500.00 PAID (${sessionData.paymentRef})`
        : "₱500.00 PAID ✓";
}

async function finalizeApplicationDecision(newStatus) {
    const resultDiv = document.getElementById("decision-result");
    const btnApprove = document.getElementById("btn-final-approve");
    const btnReject = document.getElementById("btn-final-reject");
    resultDiv.innerHTML = "";

    if (btnApprove) btnApprove.disabled = true;
    if (btnReject) btnReject.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/applications/${encodeURIComponent(sessionData.applicationId)}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Failed to update application decision.");
        }

        sessionData.status = newStatus;

        if (newStatus === "approved") {
            resultDiv.innerHTML = `
                <div class="mt-5 p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/40 space-y-3">
                    <div class="text-sm font-bold text-emerald-400 flex items-center gap-2">
                        <i class="fa-solid fa-circle-check text-base"></i>
                        <span>Applicant ${sessionData.fullName} (${sessionData.applicationId}) is officially APPROVED!</span>
                    </div>
                    <p class="text-xs text-slate-300">
                        The enrollment application is complete and the Resume button has been removed from the Admissions Queue. You can now create a Student Portal account for this applicant using Application ID <strong class="text-brand-cyan font-mono">${sessionData.applicationId}</strong>.
                    </p>
                    <div class="flex flex-wrap items-center gap-3 pt-1">
                        <a href="../registrar-portal/create-account.html?app_id=${encodeURIComponent(sessionData.applicationId)}" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-cyan text-brand-black hover:bg-brand-cyan-hover font-bold text-xs shadow-cyan-sm transition">
                            <i class="fa-solid fa-user-plus"></i>
                            <span>Create Student Portal Account (${sessionData.applicationId}) &rarr;</span>
                        </a>
                        <button type="button" onclick="exitToAdminPortal()" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition">
                            <span>Return to Admissions Portal</span>
                        </button>
                    </div>
                </div>
            `;
        } else {
            resultDiv.innerHTML = `
                <div class="mt-5 p-5 rounded-xl bg-rose-500/10 border border-rose-500/40 space-y-3">
                    <div class="text-sm font-bold text-rose-400 flex items-center gap-2">
                        <i class="fa-solid fa-circle-xmark text-base"></i>
                        <span>Application ${sessionData.applicationId} has been marked as REJECTED.</span>
                    </div>
                    <p class="text-xs text-slate-300">
                        The application has been closed and the Resume button has been removed from the Admissions Queue.
                    </p>
                    <div class="pt-1">
                        <button type="button" onclick="exitToAdminPortal()" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition">
                            <span>Return to Admissions Portal</span>
                        </button>
                    </div>
                </div>
            `;
        }

    } catch (error) {
        resultDiv.innerHTML = `<p class='error-msg'>Error: ${error.message}</p>`;
        if (btnApprove) btnApprove.disabled = false;
        if (btnReject) btnReject.disabled = false;
    }
}
