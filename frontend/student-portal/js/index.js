var API_BASE = window.API_BASE || "http://127.0.0.1:8000";

let currentStudent = {
    userId: null,
    fullName: null,
    email: null
};

let activeStudentApp = null;
let activeProgramSubjects = [];
let currentLedgerFilter = "all";

const TAB_BREADCRUMB_LABELS = {
    "dashboard": "Academic Overview",
    "grades": "My Grades (Admissions Curriculum View)",
    "schedule": "Subject Schedule",
    "payment-history": "Payment History & Official Receipts",
    "ledger": "Student Financial Ledger"
};

window.addEventListener("DOMContentLoaded", () => {
    ["login-email", "login-password"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("keydown", function (e) {
                if (e.key === "Enter") loginStudent();
            });
        }
    });

    const savedUserId = localStorage.getItem("student_user_id");
    const savedName = localStorage.getItem("student_name");
    const savedEmail = localStorage.getItem("student_email");

    if (savedUserId) {
        currentStudent.userId = savedUserId;
        currentStudent.fullName = savedName || "Student";
        currentStudent.email = savedEmail || "";
        switchView("dashboard");
    }
});

function getInitials(name) {
    const parts = String(name || "ST").trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return String(name || "ST").slice(0, 2).toUpperCase();
}

function formatPHP(amount) {
    const num = Number(amount || 0);
    return "₱" + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPaymentMethod(method) {
    const map = {
        cash: "Cash (Over-the-Counter)",
        gcash: "GCash e-Wallet",
        debit_card: "Debit Card",
        credit_card: "Credit Card"
    };
    return map[String(method || "").toLowerCase()] || String(method || "Cash").toUpperCase();
}

function switchView(viewName) {
    const authView = document.getElementById("auth-view");
    const dashView = document.getElementById("dashboard-view");
    if (!authView || !dashView) return;

    authView.classList.remove("active");
    dashView.classList.remove("active");

    if (viewName === "dashboard") {
        authView.classList.add("hidden");
        authView.style.display = "none";
        dashView.classList.remove("hidden");
        dashView.classList.add("active");
        dashView.style.display = "block";

        const displayName = (currentStudent.fullName || "Student").toUpperCase();
        const welcomeEl = document.getElementById("welcome-user-text");
        const sidebarNameEl = document.getElementById("sidebar-user-name");
        const sidebarIdEl = document.getElementById("session-user-id");
        const sidebarInitialsEl = document.getElementById("sidebar-user-initials");

        if (welcomeEl) welcomeEl.textContent = displayName;
        if (sidebarNameEl) sidebarNameEl.textContent = displayName;
        if (sidebarIdEl) sidebarIdEl.textContent = currentStudent.userId || "USER-0000";
        if (sidebarInitialsEl) sidebarInitialsEl.textContent = getInitials(currentStudent.fullName);

        switchPortalTab("dashboard");
        loadStudentPortalData();
    } else {
        dashView.classList.add("hidden");
        dashView.style.display = "none";
        authView.classList.remove("hidden");
        authView.classList.add("active");
        authView.style.display = "flex";
    }
}

function switchPortalTab(tabName) {
    const panes = document.querySelectorAll(".portal-tab-pane");
    panes.forEach(p => p.classList.remove("active"));

    const targetPane = document.getElementById(`tab-${tabName}`);
    if (targetPane) {
        targetPane.classList.add("active");
    }

    const navBtns = document.querySelectorAll(".portal-nav-btn");
    navBtns.forEach(btn => {
        if (btn.getAttribute("data-tab") === tabName) {
            btn.className = "portal-nav-btn w-full text-left flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg transition-colors bg-surface-container-high text-primary-container font-semibold";
        } else {
            btn.className = "portal-nav-btn w-full text-left flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors";
        }
    });

    const breadcrumb = document.getElementById("top-breadcrumb-current");
    if (breadcrumb) {
        breadcrumb.textContent = TAB_BREADCRUMB_LABELS[tabName] || "Academic Overview";
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function copyStudentUserId() {
    if (!currentStudent.userId) return;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(currentStudent.userId);
    }
}

async function loadStudentPortalData() {
    if (!currentStudent.userId) return;

    try {
        const response = await fetch(`${API_BASE}/users/${encodeURIComponent(currentStudent.userId)}/applications`);
        if (response.status === 404) {
            // Stale user session in localStorage that no longer exists in DB
            logoutStudent();
            return;
        }
        if (!response.ok) return;
        const apps = await response.json();

        if (!apps || apps.length === 0) {
            activeStudentApp = {
                application_id: "APP-PENDING",
                user_id: currentStudent.userId,
                course_id: "UNASSIGNED",
                status: "approved",
                documents: [],
                payments: [],
                program: {
                    course_id: "UNASSIGNED",
                    course_name: "Enrolled Degree Program",
                    academic_year: "2026-2027",
                    subjects: []
                }
            };
            activeProgramSubjects = [];
        } else {
            // Pick approved application or latest application
            activeStudentApp = apps.find(a => a.status === "approved") || apps[apps.length - 1];

            // Load subjects for the student's enrolled course
            if (activeStudentApp.program && Array.isArray(activeStudentApp.program.subjects) && activeStudentApp.program.subjects.length > 0) {
                activeProgramSubjects = activeStudentApp.program.subjects;
            } else if (activeStudentApp.course_id) {
                const subjRes = await fetch(`${API_BASE}/programs/${encodeURIComponent(activeStudentApp.course_id)}/subjects`);
                if (subjRes.ok) {
                    activeProgramSubjects = await subjRes.json();
                } else {
                    activeProgramSubjects = [];
                }
            }
        }

        renderDashboardTab();
        renderGradesTab();
        renderScheduleTab();
        renderPaymentHistoryTab();
        renderLedgerTab();
    } catch (err) {
        console.error("Failed to load student portal records:", err);
    }
}

function extractTuitionAndEnrollmentPayments(app) {
    const allPayments = Array.isArray(app?.payments) ? app.payments : [];
    let enrollmentFeePaid = 0;
    let tuitionPaid = 0;
    const tuitionPayments = [];
    const enrollmentPayments = [];

    allPayments.forEach((p, idx) => {
        const ref = String(p.reference_number || "");
        const amt = Number(p.amount || 0);
        if (ref.startsWith("TUI-") || (idx > 0 && amt >= 1000)) {
            tuitionPaid += amt;
            tuitionPayments.push(p);
        } else {
            enrollmentFeePaid += amt;
            enrollmentPayments.push(p);
        }
    });

    return {
        allPayments,
        enrollmentFeePaid,
        tuitionPaid,
        tuitionPayments,
        enrollmentPayments,
        totalPaid: enrollmentFeePaid + tuitionPaid
    };
}

function renderDashboardTab() {
    if (!activeStudentApp) return;

    const app = activeStudentApp;
    const courseId = app.course_id || "COURSE";
    const courseName = (app.program && app.program.course_name) ? app.program.course_name : courseId;
    const academicYear = (app.program && app.program.academic_year) ? app.program.academic_year : "2026-2027";
    const statusText = app.status === "approved" ? "Officially Enrolled" : String(app.status || "Pending").replace("_", " ").toUpperCase();

    const setElText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setElText("header-app-id-badge", `Dossier: ${app.application_id}`);
    setElText("sidebar-term-label", `SY ${academicYear} 1ST SEM`);
    setElText("dash-operational-term", `1ST SEMESTER ${academicYear}`);
    setElText("dash-dossier-sys-id", `DOSSIER: ${app.application_id}`);
    setElText("dash-profile-userid", currentStudent.userId);
    setElText("dash-profile-program", `${courseName} (${courseId})`);
    setElText("dash-profile-course-code", courseId);
    setElText("dash-profile-ay", `SY ${academicYear} • 1st & 2nd Sem Curriculum`);

    const emailEl = document.getElementById("dash-profile-email");
    if (emailEl) {
        emailEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span> ${currentStudent.email || "VERIFIED STUDENT ACCOUNT"}`;
    }

    const statusBadge = document.getElementById("dash-profile-status-badge");
    if (statusBadge) {
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-primary-container"></span> ${statusText}`;
    }

    // Physical Documents Verified Summary
    const docs = Array.isArray(app.documents) ? app.documents : [];
    setElText("dash-profile-docs-summary", `Physical Documents Verified by Admissions: ${docs.length} / 4`);
    setElText("dash-docs-badge", `${docs.length} / 4 Verified`);

    const requiredDocs = [
        "PSA Birth Certificate",
        "Form 138 / Report Card",
        "Certificate of Good Moral",
        "2x2 ID Picture"
    ];
    const handedTypes = new Set(docs.map(d => String(d.document_type || "").toLowerCase()));
    const docsPillsContainer = document.getElementById("dash-docs-pills");
    if (docsPillsContainer) {
        docsPillsContainer.innerHTML = requiredDocs.map(docName => {
            const isHanded = handedTypes.has(docName.toLowerCase()) || docs.length >= 4;
            return `
                <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-container">
                    <span class="font-body-sm text-body-sm text-on-surface truncate">${docName}</span>
                    <span class="font-label-code text-[11px] ${isHanded ? "text-primary-container" : "text-outline"} flex items-center gap-1 shrink-0">
                        <span class="material-symbols-outlined text-[14px]">${isHanded ? "verified" : "schedule"}</span>
                        ${isHanded ? "Verified" : "Pending"}
                    </span>
                </div>
            `;
        }).join("");
    }

    // Subjects Highlights (1st Semester subjects from database)
    const sem1Subjects = activeProgramSubjects.filter(s => Number(s.semester) === 1);
    const sem2Subjects = activeProgramSubjects.filter(s => Number(s.semester) === 2);
    const sem1Units = sem1Subjects.reduce((sum, s) => sum + (Number(s.units) || 0), 0);
    const sem2Units = sem2Subjects.reduce((sum, s) => sum + (Number(s.units) || 0), 0);

    const appGrades = Array.isArray(app.grades) ? app.grades : [];
    const gradeBySubjectId = {};
    appGrades.forEach(g => {
        gradeBySubjectId[g.subject_id] = g;
    });

    const gwaValues = appGrades
        .map(g => g.gwa !== null && g.gwa !== undefined ? Number(g.gwa) : null)
        .filter(v => v !== null && !isNaN(v));
    const overallAvg = gwaValues.length > 0
        ? `${(gwaValues.reduce((a, b) => a + b, 0) / gwaValues.length).toFixed(2)}%`
        : "N/A";

    const staffedSubjects = activeProgramSubjects.filter(
        s => s.instructor_name && s.instructor_name.trim() !== "" && s.instructor_name !== "N/A"
    ).length;

    setElText("dash-enrolled-units-pill", `${sem1Units.toFixed(1)} Total Units Enrolled (1st Sem)`);
    setElText("dash-active-subjects-count", `${sem1Subjects.length} Active Subjects Registered in 1st Semester (${sem2Subjects.length} in 2nd Sem)`);
    setElText("dash-matrix-title", `${courseId} — Degree Curriculum Unit Matrix`);
    setElText("dash-sem1-unit-label", `1st Semester (${sem1Units.toFixed(1)} Units • ${sem1Subjects.length} Subjects)`);
    setElText("dash-sem2-unit-label", `2nd Semester (${sem2Units.toFixed(1)} Units • ${sem2Subjects.length} Subjects)`);
    setElText("dash-term-gwa-val", overallAvg);
    setElText("dash-grades-encoded-status", `${gwaValues.length} / ${activeProgramSubjects.length} Subject Grades Encoded`);
    setElText("dash-faculty-count-note", `${staffedSubjects} / ${activeProgramSubjects.length} Subject Instructors Assigned`);

    const highlightContainer = document.getElementById("dash-subjects-highlight-list");
    if (highlightContainer) {
        if (sem1Subjects.length === 0) {
            highlightContainer.innerHTML = `
                <div class="p-4 rounded-xl bg-surface-container text-on-surface-variant font-body-sm text-body-sm">
                    No subjects have been published for ${courseId} yet.
                </div>
            `;
        } else {
            const firstSubj = sem1Subjects[0];
            const firstGrade = gradeBySubjectId[firstSubj.subject_id];
            const firstGradeText = (firstGrade && firstGrade.gwa !== null && firstGrade.gwa !== undefined)
                ? `Grade: ${Number(firstGrade.gwa).toFixed(2)}% (${firstGrade.remarks || "Encoded"})`
                : "Grade: N/A";
            const restSubjs = sem1Subjects.slice(1, 4);

            highlightContainer.innerHTML = `
                <div class="relative bg-surface-container rounded-xl p-4 overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-outline-variant">
                    <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-primary-container"></div>
                    <div class="flex flex-col gap-1 pl-2">
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded bg-primary-container/20 text-primary-container font-label-caps text-label-caps uppercase font-bold tracking-wider">Enrolled Subject #01</span>
                            <span class="font-label-code text-label-code text-tertiary-fixed-dim font-bold">${firstSubj.subject_code}</span>
                        </div>
                        <h4 class="font-headline-sm text-headline-sm text-tertiary font-bold tracking-tight">${firstSubj.subject_name}</h4>
                        <div class="flex items-center flex-wrap gap-y-1 gap-x-4 font-body-sm text-body-sm text-on-surface-variant mt-1">
                            <span class="flex items-center gap-1.5">
                                <span class="material-symbols-outlined text-base text-primary-container">meeting_room</span>
                                Room: <strong class="text-primary">${firstSubj.room || "N/A"}</strong>
                            </span>
                            <span class="flex items-center gap-1.5">
                                <span class="material-symbols-outlined text-base text-primary-container">person</span>
                                Instructor: <strong class="text-primary">${firstSubj.instructor_name || "N/A"}</strong>
                            </span>
                            <span class="flex items-center gap-1.5 font-label-code text-label-code text-primary">
                                <span class="material-symbols-outlined text-base text-primary-container">grade</span>
                                ${firstGradeText}
                            </span>
                        </div>
                    </div>
                    <div class="flex sm:flex-col items-center sm:items-end justify-between shrink-0 pl-2 sm:pl-0">
                        <span class="font-label-code text-label-code text-primary-container font-bold">${Number(firstSubj.units).toFixed(1)} Units</span>
                        <span class="font-label-code text-[11px] text-outline mt-1">ID: ${firstSubj.subject_id}</span>
                    </div>
                </div>
                ${restSubjs.map(s => {
                    const sg = gradeBySubjectId[s.subject_id];
                    const sgText = (sg && sg.gwa !== null && sg.gwa !== undefined)
                        ? `Grade: ${Number(sg.gwa).toFixed(2)}%`
                        : "Grade: N/A";
                    return `
                        <div class="bg-surface-container-lowest rounded-xl p-3.5 border border-outline-variant flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div class="flex items-start gap-3">
                                <div class="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-secondary shrink-0">
                                    <span class="material-symbols-outlined text-lg">menu_book</span>
                                </div>
                                <div class="flex flex-col">
                                    <div class="flex items-center gap-2">
                                        <span class="font-label-code text-label-code text-secondary-fixed-dim font-bold">${s.subject_code}</span>
                                        <span class="font-headline-sm text-headline-sm text-on-surface font-semibold">${s.subject_name}</span>
                                    </div>
                                    <span class="font-body-sm text-body-sm text-on-surface-variant">
                                        Instructor: <strong class="text-primary">${s.instructor_name || "N/A"}</strong> • Room: ${s.room || "N/A"} • ${sgText}
                                    </span>
                                </div>
                            </div>
                            <span class="font-label-code text-label-code text-primary shrink-0">${Number(s.units).toFixed(1)} Units</span>
                        </div>
                    `;
                }).join("")}
            `;
        }
    }

    // Tuition & Financial Summary
    const fin = extractTuitionAndEnrollmentPayments(app);
    const settledTuition = Math.min(20000, fin.tuitionPaid);
    const remainingTuition = Math.max(0, 20000 - settledTuition);
    const paidMilestones = Math.min(4, Math.floor(settledTuition / 5000));

    setElText("dash-running-balance", formatPHP(remainingTuition));
    setElText("dash-settled-subtext", `(${formatPHP(settledTuition)} of ₱20,000.00 Settled)`);
    setElText("dash-balance-tag", remainingTuition === 0 ? "Fully Cleared" : `${4 - paidMilestones} Installment(s) Left`);

    const finPill = document.getElementById("dash-financial-status-pill");
    if (finPill) {
        finPill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span> ${
            remainingTuition === 0 ? "Fully Paid ✓" : `${paidMilestones}/4 Paid`
        }`;
    }

    const milestonesMeta = [
        { num: 1, title: "Month 1 (Prelims)", due: "Aug 28, 2026" },
        { num: 2, title: "Month 2 (Midterms)", due: "Oct 15, 2026" },
        { num: 3, title: "Month 3 (Semi-Finals)", due: "Nov 15, 2026" },
        { num: 4, title: "Month 4 (Finals)", due: "Dec 15, 2026" }
    ];

    const milestoneContainer = document.getElementById("dash-milestone-list");
    if (milestoneContainer) {
        milestoneContainer.innerHTML = milestonesMeta.map((m, idx) => {
            const matchingPay = fin.tuitionPayments[idx];
            if (m.num <= paidMilestones) {
                const orText = matchingPay ? `OR #${matchingPay.reference_number}` : "Verified by Registrar";
                return `
                    <div class="flex items-center justify-between p-3 rounded-lg bg-surface-container">
                        <div class="flex items-center gap-3">
                            <div class="w-6 h-6 rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-[0_0_8px_rgba(0,242,254,0.4)]">
                                <span class="material-symbols-outlined text-sm font-bold">check</span>
                            </div>
                            <div class="flex flex-col">
                                <span class="font-body-sm text-body-sm text-primary font-semibold">${m.title}</span>
                                <span class="font-label-code text-label-code text-secondary-fixed-dim">${orText}</span>
                            </div>
                        </div>
                        <div class="flex flex-col text-right">
                            <span class="font-label-code text-label-code text-primary font-bold">₱5,000.00</span>
                            <span class="font-label-caps text-label-caps text-primary-container uppercase font-bold">Settled ✓</span>
                        </div>
                    </div>
                `;
            }
            return `
                <div class="flex items-center justify-between p-3 rounded-lg bg-surface-container-lowest opacity-80">
                    <div class="flex items-center gap-3">
                        <div class="w-6 h-6 rounded-full bg-surface-container-high text-outline flex items-center justify-center font-label-code text-xs">
                            ${m.num}
                        </div>
                        <div class="flex flex-col">
                            <span class="font-body-sm text-body-sm text-on-surface">${m.title}</span>
                            <span class="font-label-code text-label-code text-outline">Scheduled Due: ${m.due}</span>
                        </div>
                    </div>
                    <div class="flex flex-col text-right">
                        <span class="font-label-code text-label-code text-outline">₱5,000.00</span>
                        <span class="font-label-caps text-label-caps text-outline uppercase">${m.num === paidMilestones + 1 ? "Next Due" : "Pending"}</span>
                    </div>
                </div>
            `;
        }).join("");
    }
}

function renderGradesTab() {
    if (!activeStudentApp) return;

    const app = activeStudentApp;
    const semSelect = document.getElementById("grades-semester-select");
    const searchInput = document.getElementById("grades-search-input");
    const selectedSem = Number(semSelect ? semSelect.value : 1);
    const query = (searchInput ? searchInput.value : "").trim().toLowerCase();

    const courseId = app.course_id || "COURSE";
    const courseName = (app.program && app.program.course_name) ? app.program.course_name : courseId;
    const academicYear = (app.program && app.program.academic_year) ? app.program.academic_year : "2026-2027";

    const appGrades = Array.isArray(app.grades) ? app.grades : [];
    const gradeBySubject = {};
    appGrades.forEach(g => {
        gradeBySubject[g.subject_id] = g;
    });

    const semSubjects = activeProgramSubjects.filter(s => Number(s.semester) === selectedSem);
    const totalUnits = semSubjects.reduce((sum, s) => sum + (Number(s.units) || 0), 0);

    const filtered = semSubjects.filter(s => {
        if (!query) return true;
        return (
            String(s.subject_code || "").toLowerCase().includes(query) ||
            String(s.subject_name || "").toLowerCase().includes(query) ||
            String(s.instructor_name || "").toLowerCase().includes(query)
        );
    });

    // Compute Term GWA and staffed faculty count
    let weightedSum = 0;
    let weightedUnits = 0;
    let encodedSubjects = 0;
    let staffedSubjects = 0;

    semSubjects.forEach(s => {
        const instr = (s.instructor_name || "").trim();
        if (instr && instr !== "N/A") staffedSubjects += 1;

        const g = gradeBySubject[s.subject_id];
        if (g && g.gwa !== null && g.gwa !== undefined) {
            encodedSubjects += 1;
            const u = Number(s.units) || 3;
            weightedSum += Number(g.gwa) * u;
            weightedUnits += u;
        }
    });

    const termPct = weightedUnits > 0 ? (weightedSum / weightedUnits) : null;
    let standingTag = "Awaiting Encoded Marks";
    if (termPct !== null) {
        if (termPct >= 95.0) standingTag = "DEAN'S LIST • HIGHEST HONORS";
        else if (termPct >= 90.0) standingTag = "HONOR STANDING • SUPERIOR";
        else if (termPct >= 75.0) standingTag = "GOOD STANDING • PASSING";
        else standingTag = "ACADEMIC WARNING • BELOW 75%";
    }

    const encodedPct = semSubjects.length > 0 ? Math.round((encodedSubjects / semSubjects.length) * 100) : 0;

    const setElText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setElText("grades-student-fullname", (currentStudent.fullName || "STUDENT").toUpperCase());
    setElText("grades-student-id-label", `ID: ${currentStudent.userId}`);
    setElText("grades-table-program-subtitle", `${courseName} (${courseId})`);
    setElText("grades-term-gwa", termPct !== null ? `${termPct.toFixed(2)}%` : "N/A");
    setElText("grades-standing-tag", standingTag);
    setElText("grades-card-units", totalUnits.toFixed(1));
    setElText("grades-record-count", `${filtered.length} Subjects`);
    setElText("grades-encoded-pct", `${encodedPct}% Encoded`);
    setElText("grades-staffed-count", `${staffedSubjects} / ${semSubjects.length}`);
    setElText("grades-clearance-appid", `#${app.application_id}`);
    setElText(
        "grades-table-sem-title",
        `Semestral Course Ledger & Enrolled Instructors (${selectedSem === 2 ? "2nd Sem" : "1st Sem"} • SY ${academicYear})`
    );

    const tbody = document.getElementById("grades-table-tbody");
    if (tbody) {
        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="py-8 text-center font-label-code text-label-code text-on-surface-variant">
                        No subjects found for this semester.
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = filtered.map(s => {
                const g = gradeBySubject[s.subject_id] || {};
                const fmt = (val) => (val !== null && val !== undefined) ? `${Number(val).toFixed(2)}%` : "N/A";
                const prelimTxt = fmt(g.prelim);
                const midTxt = fmt(g.midterm);
                const finalTxt = fmt(g.final);
                const avgTxt = fmt(g.gwa);
                const remarkTxt = g.remarks || "Pending";
                const instrTxt = s.instructor_name && s.instructor_name.trim() ? s.instructor_name : "N/A";
                const roomTxt = s.room && s.room.trim() ? s.room : "N/A";
                const isFailed = g.gwa !== null && g.gwa !== undefined && Number(g.gwa) < 75.0;

                return `
                    <tr class="hover:bg-surface-container-high/40 transition-colors">
                        <td class="py-3.5 px-4">
                            <div class="flex flex-col">
                                <span class="font-label-code text-label-code font-bold text-primary">${s.subject_code}</span>
                                <span class="text-on-surface-variant font-medium">${s.subject_name}</span>
                            </div>
                        </td>
                        <td class="py-3.5 px-3 font-label-code text-label-code text-on-surface-variant">${Number(s.units).toFixed(1)}</td>
                        <td class="py-3.5 px-4">
                            <div class="flex flex-col">
                                <span class="font-body-sm text-primary font-medium">${instrTxt}</span>
                                <span class="font-label-code text-[11px] text-on-surface-variant">Room: ${roomTxt}</span>
                            </div>
                        </td>
                        <td class="py-3.5 px-2 font-label-code text-label-code text-right ${prelimTxt === "N/A" ? "text-on-surface-variant" : "text-primary font-semibold"}">${prelimTxt}</td>
                        <td class="py-3.5 px-2 font-label-code text-label-code text-right ${midTxt === "N/A" ? "text-on-surface-variant" : "text-primary font-semibold"}">${midTxt}</td>
                        <td class="py-3.5 px-2 font-label-code text-label-code text-right ${finalTxt === "N/A" ? "text-on-surface-variant" : "text-primary font-semibold"}">${finalTxt}</td>
                        <td class="py-3.5 px-3 font-label-code text-label-code text-right font-bold ${isFailed ? "text-error" : "text-primary"}">${avgTxt}</td>
                        <td class="py-3.5 px-4 text-right">
                            <span class="px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant font-label-code text-[11px] font-bold ${isFailed ? "text-error" : "text-primary"}">
                                ${remarkTxt}
                            </span>
                        </td>
                    </tr>
                `;
            }).join("");
        }
    }

    // Populate Enrolled Subject Faculty Directory cards
    const dirGrid = document.getElementById("faculty-directory-cards");
    if (dirGrid) {
        if (filtered.length === 0) {
            dirGrid.innerHTML = `<p class="font-body-sm text-on-surface-variant col-span-full py-4">No faculty assignments found for this semester.</p>`;
        } else {
            dirGrid.innerHTML = filtered.map(s => {
                const instrTxt = s.instructor_name && s.instructor_name.trim() ? s.instructor_name : "N/A";
                const roomTxt = s.room && s.room.trim() ? s.room : "N/A";
                const g = gradeBySubject[s.subject_id];
                const gradeBadge = (g && g.gwa !== null && g.gwa !== undefined)
                    ? `Avg: ${Number(g.gwa).toFixed(2)}%`
                    : "Grade: N/A";

                return `
                    <div class="bg-surface-container border border-outline-variant p-4 rounded-xl flex flex-col justify-between gap-3">
                        <div class="flex flex-col gap-1">
                            <div class="flex items-center justify-between">
                                <span class="px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant font-label-code text-[11px] text-primary font-bold">${s.subject_code}</span>
                                <span class="font-label-code text-[11px] text-on-surface-variant">Room: ${roomTxt}</span>
                            </div>
                            <span class="font-headline-sm text-primary font-bold mt-1">${instrTxt}</span>
                            <span class="font-body-sm text-on-surface-variant">${s.subject_name} (${s.units}.0 Units)</span>
                        </div>
                        <div class="pt-2 border-t border-outline-variant flex items-center justify-between font-label-code text-[11px]">
                            <span class="text-on-surface-variant">ID: ${s.subject_id}</span>
                            <span class="text-primary font-bold">${gradeBadge}</span>
                        </div>
                    </div>
                `;
            }).join("");
        }
    }
}

function renderScheduleTab() {
    if (!activeStudentApp) return;

    const app = activeStudentApp;
    const semSelect = document.getElementById("sched-semester-select");
    const selectedSem = Number(semSelect ? semSelect.value : 1);
    const courseId = app.course_id || "COURSE";

    const semSubjects = activeProgramSubjects.filter(s => Number(s.semester) === selectedSem);
    let totalUnits = 0;
    let lecUnits = 0;
    let labUnits = 0;

    semSubjects.forEach(s => {
        const u = Number(s.units) || 0;
        const isLab = /lab/i.test(s.subject_name) || /lab/i.test(s.subject_code);
        totalUnits += u;
        if (isLab) {
            labUnits += u;
        } else {
            lecUnits += u;
        }
    });

    const badgeEl = document.getElementById("sched-course-badge");
    if (badgeEl) badgeEl.textContent = `${courseId} • ${selectedSem === 2 ? "2ND SEM" : "1ST SEM"}`;

    const countEl = document.getElementById("sched-class-count");
    if (countEl) countEl.textContent = `${semSubjects.length} subjects`;

    const totalEl = document.getElementById("sched-total-units");
    if (totalEl) totalEl.innerHTML = `${totalUnits.toFixed(1)} <span class="font-headline-sm text-headline-sm text-on-surface-variant font-normal">Units</span>`;

    const lecEl = document.getElementById("sched-lec-units");
    if (lecEl) lecEl.innerHTML = `${lecUnits.toFixed(1)} <span class="font-headline-sm text-headline-sm text-on-surface-variant font-normal">Units</span>`;

    const labEl = document.getElementById("sched-lab-units");
    if (labEl) labEl.innerHTML = `${labUnits.toFixed(1)} <span class="font-headline-sm text-headline-sm text-on-surface-variant font-normal">Units</span>`;

    const tbody = document.getElementById("sched-table-tbody");
    if (!tbody) return;

    if (semSubjects.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-8 text-center font-label-code text-label-code text-on-surface-variant">
                    No subjects configured for this semester.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = semSubjects.map(s => {
        const isLab = /lab/i.test(s.subject_name) || /lab/i.test(s.subject_code);
        const typeBadge = isLab
            ? `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high border border-outline-variant text-primary font-label-caps text-label-caps uppercase tracking-wider font-semibold">
                    Laboratory
                </span>
            `
            : `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high border border-outline-variant text-primary font-label-caps text-label-caps uppercase tracking-wider font-semibold">
                    Lecture
                </span>
            `;

        return `
            <tr class="hover:bg-surface-container transition-colors">
                <td class="py-4 px-5">
                    <span class="font-label-code text-label-code text-primary font-bold px-2.5 py-1 rounded bg-surface-container-lowest border border-outline-variant">${s.subject_code}</span>
                </td>
                <td class="py-4 px-5">
                    <div class="flex flex-col">
                        <span class="font-body-md text-body-md text-primary font-semibold">${s.subject_name}</span>
                        <span class="font-label-caps text-label-caps text-on-surface-variant">Subject ID: ${s.subject_id}</span>
                    </div>
                </td>
                <td class="py-4 px-4 font-label-code text-label-code text-primary font-bold">${Number(s.units).toFixed(1)} Units</td>
                <td class="py-4 px-4 font-label-code text-label-code text-primary">${s.room || "N/A"}</td>
                <td class="py-4 px-4 font-label-code text-label-code text-on-surface-variant">N/A</td>
                <td class="py-4 px-4 font-body-sm text-body-sm text-primary font-medium">${s.instructor_name || "N/A"}</td>
                <td class="py-4 px-5 text-right">${typeBadge}</td>
            </tr>
        `;
    }).join("");
}

function renderPaymentHistoryTab() {
    if (!activeStudentApp) return;

    const app = activeStudentApp;
    const fin = extractTuitionAndEnrollmentPayments(app);
    const courseId = app.course_id || "COURSE";
    const academicYear = (app.program && app.program.academic_year) ? app.program.academic_year : "2026-2027";

    const setElText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setElText("payhist-program-label", `SY ${academicYear} • ${courseId}`);
    setElText("payhist-appid-label", app.application_id);
    setElText("payhist-userid-label", currentStudent.userId);
    setElText("payhist-total-amount", formatPHP(fin.totalPaid));
    setElText("payhist-receipt-count", `${fin.allPayments.length} ${fin.allPayments.length === 1 ? "receipt" : "receipts"}`);

    const tbody = document.getElementById("payhist-table-tbody");
    if (!tbody) return;

    if (fin.allPayments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-8 text-center font-label-code text-label-code text-on-surface-variant">
                    No payment records posted for this student dossier yet.
                </td>
            </tr>
        `;
        return;
    }

    // Show newest payments first
    const reversed = [...fin.allPayments].reverse();
    tbody.innerHTML = reversed.map((p) => {
        const ref = String(p.reference_number || "OR-0000");
        const isTuition = ref.startsWith("TUI-") || Number(p.amount) >= 1000;
        const descTitle = isTuition ? "Semestral Tuition Installment" : "Walk-In Enrollment & Registration Fee";
        const badgeTag = isTuition ? "Tuition Ledger" : "Initial Reg Fee";
        const methodText = formatPaymentMethod(p.payment_method);
        const escapedRef = ref.replace(/'/g, "\\'");

        return `
            <tr class="hover:bg-surface-container-high/60 transition-colors group">
                <td class="py-4 px-6 whitespace-nowrap">
                    <div class="flex items-center gap-2.5">
                        <span class="w-1.5 h-1.5 rounded-full ${isTuition ? "bg-primary-container" : "bg-secondary"}"></span>
                        <span class="font-label-code text-label-code font-bold text-primary-container tracking-wider">${ref}</span>
                    </div>
                </td>
                <td class="py-4 px-6 whitespace-nowrap">
                    <div class="flex flex-col">
                        <div class="flex items-center gap-2">
                            <span class="font-body-md text-body-md font-semibold text-primary">${descTitle}</span>
                            <span class="px-2 py-0.5 rounded text-[11px] font-label-code bg-surface-container-high text-on-surface-variant">${badgeTag}</span>
                        </div>
                        <span class="font-label-code text-[11px] text-secondary-fixed-dim">Channel: ${methodText}</span>
                    </div>
                </td>
                <td class="py-4 px-6 whitespace-nowrap">
                    <span class="px-2.5 py-0.5 rounded-full bg-primary-container/15 text-primary-container font-label-code text-label-code uppercase font-semibold">
                        ${p.status || "completed"} ✓
                    </span>
                </td>
                <td class="py-4 px-6 whitespace-nowrap text-right">
                    <span class="font-metric-num text-headline-sm font-bold text-primary-container">${formatPHP(p.amount)}</span>
                </td>
                <td class="py-4 px-6 whitespace-nowrap">
                    <div class="flex items-center gap-1.5 text-on-surface-variant font-label-code text-label-code">
                        <span class="material-symbols-outlined text-sm text-outline">badge</span>
                        <span>Registrar Cashier #ADMIN-001</span>
                    </div>
                </td>
                <td class="py-4 px-6 whitespace-nowrap text-center">
                    <button onclick="viewOfficialReceipt('${escapedRef}', '${formatPHP(p.amount)}', '${methodText}', '${descTitle}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-primary-container hover:text-on-primary-container text-on-surface font-label-code text-label-code transition-all shadow-sm" type="button">
                        <span class="material-symbols-outlined text-base">receipt</span>
                        <span>View OR</span>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function viewOfficialReceipt(orNum, amount, channel, description) {
    window.alert(
        `OFFICIAL RECEIPT • ${orNum}\n` +
        `----------------------------------------\n` +
        `Student: ${currentStudent.fullName} (${currentStudent.userId})\n` +
        `Particulars: ${description}\n` +
        `Payment Channel: ${channel}\n` +
        `Amount Paid: ${amount}\n` +
        `Status: VERIFIED & POSTED`
    );
}

function renderLedgerTab() {
    if (!activeStudentApp) return;

    const app = activeStudentApp;
    const fin = extractTuitionAndEnrollmentPayments(app);
    const academicYear = (app.program && app.program.academic_year) ? app.program.academic_year : "2026-2027";

    const totalDebit = 20500.00; // ₱500.00 Enrollment Fee + ₱20,000.00 Semestral Tuition
    const totalCredit = fin.totalPaid;
    const runningBalance = Math.max(0, totalDebit - totalCredit);

    const setElText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setElText("ledger-header-userid", `ID: ${currentStudent.userId}`);
    setElText("ledger-term-card", `SY ${academicYear} • 1st Sem`);
    setElText("ledger-total-debit", formatPHP(totalDebit));
    setElText("ledger-total-credit", formatPHP(totalCredit));
    setElText("ledger-payments-badge", `${fin.allPayments.length} ${fin.allPayments.length === 1 ? "Payment" : "Payments"}`);
    setElText("ledger-running-balance", formatPHP(runningBalance));
    setElText("ledger-balance-status", runningBalance === 0 ? "Fully Settled & Cleared ✓" : "Remaining Semestral Balance");

    // Build ledger entries chronologically
    const entries = [
        {
            category: "assessment",
            ref: app.application_id,
            title: "Walk-In Enrollment & Registration Fee",
            subtitle: "Assessment • Admissions Gate",
            channel: "Institutional Charge",
            debit: 500.00,
            credit: 0
        },
        {
            category: "assessment",
            ref: app.course_id || "TUITION-21U",
            title: "Semestral Base Tuition Fee (21.0 Academic Units)",
            subtitle: "Assessment • 4-Month Installment Schedule",
            channel: "Institutional Charge",
            debit: 20000.00,
            credit: 0
        }
    ];

    fin.allPayments.forEach((p, idx) => {
        const ref = String(p.reference_number || `OR-${idx + 1}`);
        const isTuition = ref.startsWith("TUI-") || Number(p.amount) >= 1000;
        entries.push({
            category: "payment",
            ref: ref,
            title: isTuition ? `Tuition Installment Payment (${ref})` : `Enrollment Fee Settlement (${ref})`,
            subtitle: "Posted Payment Credit",
            channel: formatPaymentMethod(p.payment_method),
            debit: 0,
            credit: Number(p.amount || 0)
        });
    });

    let running = 0;
    const tbody = document.getElementById("ledger-table-tbody");
    const tfoot = document.getElementById("ledger-table-tfoot");

    if (tbody) {
        tbody.innerHTML = entries.map(item => {
            running = running + item.debit - item.credit;
            const displayRow =
                currentLedgerFilter === "all" ||
                currentLedgerFilter === item.category;

            return `
                <tr class="ledger-entry-row hover:bg-surface-container-high/40 transition-colors ${item.category === "payment" ? "bg-surface-container-lowest/30" : ""}" data-category="${item.category}" style="${displayRow ? "" : "display:none;"}">
                    <td class="py-4 px-6 font-label-code text-label-code ${item.category === "payment" ? "text-primary-container font-bold" : "text-on-surface-variant"}">
                        ${item.ref}
                    </td>
                    <td class="py-4 px-6">
                        <div class="flex flex-col">
                            <span class="font-body-md text-body-md text-primary font-medium">${item.title}</span>
                            <span class="font-label-code text-label-code ${item.category === "payment" ? "text-secondary-fixed-dim" : "text-on-surface-variant"}">${item.subtitle}</span>
                        </div>
                    </td>
                    <td class="py-4 px-6 font-label-code text-label-code text-on-surface-variant">${item.channel}</td>
                    <td class="py-4 px-6 font-label-code text-label-code text-on-surface font-medium text-right">
                        ${item.debit > 0 ? formatPHP(item.debit) : "—"}
                    </td>
                    <td class="py-4 px-6 font-label-code text-label-code text-primary-container font-semibold text-right">
                        ${item.credit > 0 ? formatPHP(item.credit) : "—"}
                    </td>
                    <td class="py-4 px-6 font-label-code text-label-code text-on-surface font-semibold text-right">
                        ${formatPHP(Math.max(0, running))}
                    </td>
                </tr>
            `;
        }).join("");
    }

    if (tfoot) {
        tfoot.innerHTML = `
            <tr class="bg-surface-container-high text-primary font-semibold">
                <td class="py-4 px-6 font-headline-sm text-headline-sm" colspan="3">Summary Totals</td>
                <td class="py-4 px-6 font-label-code text-label-code text-right text-primary">${formatPHP(totalDebit)}</td>
                <td class="py-4 px-6 font-label-code text-label-code text-right text-primary-container font-bold">${formatPHP(totalCredit)}</td>
                <td class="py-4 px-6 font-label-code text-label-code text-right text-primary-container font-bold">${formatPHP(runningBalance)}</td>
            </tr>
        `;
    }
}

function filterLedgerRows(filterType) {
    currentLedgerFilter = filterType;
    const buttons = document.querySelectorAll(".ledger-tab-btn");
    buttons.forEach(btn => {
        if (btn.getAttribute("data-filter") === filterType) {
            btn.className = "ledger-tab-btn px-4 py-1.5 rounded-md font-body-sm text-body-sm font-semibold bg-surface-container-high text-primary-container transition-all";
        } else {
            btn.className = "ledger-tab-btn px-4 py-1.5 rounded-md font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface transition-all";
        }
    });

    const rows = document.querySelectorAll(".ledger-entry-row");
    rows.forEach(row => {
        const cat = row.getAttribute("data-category");
        if (filterType === "all" || cat === filterType) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}

async function loginStudent() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const resultDiv = document.getElementById("login-result");
    resultDiv.innerHTML = "";

    if (!email || !password) {
        resultDiv.innerHTML = "<p class='text-error font-label-code text-label-code'>Please enter your email and password.</p>";
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/users/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, user_password: password })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Invalid email or password.");
        }

        const data = await response.json();
        currentStudent.userId = data.user_id;
        currentStudent.fullName = data.full_name;
        currentStudent.email = data.email;

        localStorage.setItem("student_user_id", data.user_id);
        localStorage.setItem("student_name", data.full_name);
        localStorage.setItem("student_email", data.email || "");

        switchView("dashboard");
    } catch (error) {
        resultDiv.innerHTML = `<p class="text-error font-label-code text-label-code">Error: ${error.message}</p>`;
    }
}

function logoutStudent() {
    currentStudent = { userId: null, fullName: null, email: null };
    activeStudentApp = null;
    activeProgramSubjects = [];
    localStorage.removeItem("student_user_id");
    localStorage.removeItem("student_name");
    localStorage.removeItem("student_email");
    localStorage.removeItem("student_application_id");
    sessionStorage.removeItem("enrollment_wizard_step");
    const emailInput = document.getElementById("login-email");
    const passInput = document.getElementById("login-password");
    if (emailInput) emailInput.value = "";
    if (passInput) passInput.value = "";
    switchView("auth");
}
