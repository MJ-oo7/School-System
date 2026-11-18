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

let cachedApplications = [];
let activeFilterKey = "ALL";

let currentApplicant = {
    appId: null,
    userId: null,
    name: "Select or Create Walk-In Candidate",
    program: "-",
    phone: "-",
    email: "-",
    docs: { psa: false, f138: false, moral: false, photo: false },
    feePaid: false,
    orNumber: "",
    status: "INCOMPLETE"
};

const DOC_MAP = {
    psa: "Birth Certificate",
    f138: "Report Card",
    moral: "Good Moral Certificate",
    photo: "2x2 ID Photos"
};

window.onload = function () {
    ["admin-id-input", "admin-password-input"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("keydown", function (e) {
                if (e.key === "Enter") verifyAdminAccess();
            });
        }
    });

    if (sessionStorage.getItem("admin_authenticated") === "true") {
        const savedId = sessionStorage.getItem("admin_user_id") || "ADMIN-001";
        const savedName = sessionStorage.getItem("admin_full_name") || "Admin Registrar";
        showAdminDashboard(savedId, savedName);
    }
};

function showAdminDashboard(adminId, fullName) {
    document.getElementById("auth-gate-view").style.display = "none";
    document.getElementById("admin-shell").style.display = "block";
    const badgeEl = document.getElementById("header-admin-badge");
    if (badgeEl) {
        badgeEl.innerText = `${fullName || "Admin Registrar"} #${adminId || "ADMIN-001"}`;
    }
    loadProgramsDropdown();
    fetchAllApplications();
}

async function verifyAdminAccess() {
    const adminId = document.getElementById("admin-id-input").value.trim();
    const password = document.getElementById("admin-password-input").value;
    const errorDiv = document.getElementById("auth-error");
    errorDiv.innerHTML = "";

    if (!adminId || !password) {
        errorDiv.innerHTML = "<p class='error-msg'>Please enter both Admin User ID and Password.</p>";
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/users/${encodeURIComponent(adminId)}/verify-admin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_password: password })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Authentication failed.");
        }

        const data = await response.json();
        sessionStorage.setItem("admin_authenticated", "true");
        sessionStorage.setItem("admin_user_id", data.user_id);
        sessionStorage.setItem("admin_full_name", data.full_name);

        showAdminDashboard(data.user_id, data.full_name);

    } catch (error) {
        errorDiv.innerHTML = `<p class='error-msg'>Error: ${error.message}</p>`;
    }
}

function logoutAdmin() {
    sessionStorage.removeItem("admin_authenticated");
    sessionStorage.removeItem("admin_user_id");
    sessionStorage.removeItem("admin_full_name");
    document.getElementById("admin-id-input").value = "";
    document.getElementById("admin-password-input").value = "";
    document.getElementById("auth-error").innerHTML = "";
    document.getElementById("admin-shell").style.display = "none";
    document.getElementById("auth-gate-view").style.display = "flex";
}

async function loadProgramsDropdown() {
    const selectEl = document.getElementById("walkin-program");
    if (!selectEl) return;
    try {
        const res = await fetch(`${API_BASE}/programs/`);
        if (!res.ok) return;
        const programs = await res.json();
        if (programs.length > 0) {
            selectEl.innerHTML = programs.map(p =>
                `<option value="${p.course_id}">${p.course_name} (${p.course_id})</option>`
            ).join("");
        }
    } catch (e) {
        // Keep fallback options
    }
}

function toggleWalkInModal(show) {
    const modal = document.getElementById("walkin-modal");
    if (!modal) return;
    const isVisible = typeof show === "boolean" ? show : modal.classList.contains("hidden");
    if (isVisible) {
        modal.classList.remove("hidden");
        document.getElementById("walkin-error").innerHTML = "";
        document.getElementById("walkin-name").focus();
    } else {
        modal.classList.add("hidden");
    }
}

function resetIntakeConsole() {
    toggleWalkInModal(true);
}

async function submitNewWalkInApplicant() {
    const fullName = document.getElementById("walkin-name").value.trim();
    const email = document.getElementById("walkin-email").value.trim();
    const phone = document.getElementById("walkin-phone").value.trim();
    const courseId = document.getElementById("walkin-program").value;
    const errDiv = document.getElementById("walkin-error");
    errDiv.innerHTML = "";

    if (!fullName || !email || !courseId) {
        errDiv.innerHTML = "<p class='error-msg'>Please fill in Full Name, Email, and Target Degree Program.</p>";
        return;
    }

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
            let msg = "Failed to register walk-in candidate.";
            if (typeof err.detail === "string") msg = err.detail;
            else if (Array.isArray(err.detail)) msg = err.detail.map(e => e.msg).join(", ");
            throw new Error(msg);
        }

        const data = await response.json();
        document.getElementById("walkin-name").value = "";
        document.getElementById("walkin-email").value = "";
        document.getElementById("walkin-phone").value = "";
        toggleWalkInModal(false);

        await fetchAllApplications(data.application_id);

    } catch (error) {
        errDiv.innerHTML = `<p class='error-msg'>Error: ${error.message}</p>`;
    }
}

function deriveDocsFromApp(app) {
    const types = new Set((app.documents || []).map(d => (d.document_type || "").toLowerCase()));
    const hasAllLegacy = types.has("report card") && types.has("birth certificate") && app.payments && app.payments.length > 0 && types.size === 2;
    return {
        psa: types.has("birth certificate") || types.has("psa birth certificate"),
        f138: types.has("report card") || types.has("form 138 / shs report card"),
        moral: types.has("good moral certificate") || types.has("certificate of good moral character") || hasAllLegacy,
        photo: types.has("2x2 id photos") || types.has("2x2 official id photographs") || hasAllLegacy
    };
}

function getRowDisplayStatus(app, docsCount, feePaid) {
    if (app.status === "approved") return "APPROVED";
    if (app.status === "rejected") return "REJECTED";
    if (docsCount === 4 && feePaid) return "READY";
    return "INCOMPLETE";
}

async function fetchAllApplications(preselectAppId) {
    try {
        const response = await fetch(`${API_BASE}/admin/applications`);
        if (!response.ok) throw new Error("Failed to load applications.");
        const applications = await response.json();
        cachedApplications = applications;

        const verifiedTodayEl = document.getElementById("ribbon-verified-count");
        if (verifiedTodayEl) {
            verifiedTodayEl.innerText = `${applications.length} Dossiers`;
        }

        renderMasterQueueTable();

        const params = new URLSearchParams(window.location.search);
        const targetId = preselectAppId || params.get("app_id") || (currentApplicant && currentApplicant.appId);
        if (targetId && applications.some(a => a.application_id === targetId)) {
            loadApplicantToConsole(targetId, false);
        } else if (applications.length > 0) {
            const firstIncomplete = applications.find(a => a.status !== "approved" && a.status !== "rejected") || applications[0];
            loadApplicantToConsole(firstIncomplete.application_id, false);
        }
    } catch (e) {
        console.error(e);
    }
}

function renderMasterQueueTable() {
    const tbody = document.getElementById("queue-table-body");
    if (!tbody) return;

    const searchInput = document.getElementById("queue-search");
    const q = searchInput ? searchInput.value.trim().toLowerCase() : "";

    let readyCount = 0;
    let pendingDocsCount = 0;
    let approvedCount = 0;

    cachedApplications.forEach(app => {
        const docs = deriveDocsFromApp(app);
        const docsCount = [docs.psa, docs.f138, docs.moral, docs.photo].filter(Boolean).length;
        const feePaid = Boolean(app.payments && app.payments.length > 0);
        const displayStatus = getRowDisplayStatus(app, docsCount, feePaid);
        if (displayStatus === "READY") readyCount++;
        else if (displayStatus === "INCOMPLETE") pendingDocsCount++;
        else if (displayStatus === "APPROVED") approvedCount++;
    });

    const filtered = cachedApplications.filter(app => {
        const docs = deriveDocsFromApp(app);
        const docsCount = [docs.psa, docs.f138, docs.moral, docs.photo].filter(Boolean).length;
        const feePaid = Boolean(app.payments && app.payments.length > 0);
        const displayStatus = getRowDisplayStatus(app, docsCount, feePaid);

        if (activeFilterKey === "PENDING_DOCS" && displayStatus !== "INCOMPLETE") return false;
        if (activeFilterKey === "READY" && displayStatus !== "READY") return false;
        if (activeFilterKey === "APPROVED" && displayStatus !== "APPROVED") return false;
        if (activeFilterKey === "REJECTED" && displayStatus !== "REJECTED") return false;

        if (q) {
            const name = ((app.user && app.user.full_name) || "").toLowerCase();
            const appId = (app.application_id || "").toLowerCase();
            const userId = (app.user_id || "").toLowerCase();
            const courseId = (app.course_id || "").toLowerCase();
            return name.includes(q) || appId.includes(q) || userId.includes(q) || courseId.includes(q);
        }
        return true;
    });

    const footerCountEl = document.getElementById("queue-footer-count");
    if (footerCountEl) {
        footerCountEl.innerText = `Showing ${filtered.length} walk-in candidates in active desk queue`;
    }
    const statReadyEl = document.getElementById("stat-ready-count");
    const statPendingEl = document.getElementById("stat-pending-count");
    const statApprovedEl = document.getElementById("stat-approved-count");
    if (statReadyEl) statReadyEl.innerText = `Ready for Lock: ${readyCount}`;
    if (statPendingEl) statPendingEl.innerText = `Pending Documents: ${pendingDocsCount}`;
    if (statApprovedEl) statApprovedEl.innerText = `Fully Matriculated: ${approvedCount}`;

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-8 px-4 text-center text-on-surface-variant font-label-code">
                    No walk-in candidate dossiers match your search filter.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(app => {
        const fullName = (app.user && app.user.full_name) ? app.user.full_name : app.user_id;
        const initials = fullName.split(" ").filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join("") || "ST";
        const docs = deriveDocsFromApp(app);
        const docsCount = [docs.psa, docs.f138, docs.moral, docs.photo].filter(Boolean).length;
        const feePaid = Boolean(app.payments && app.payments.length > 0);
        const orNum = feePaid ? app.payments[0].reference_number : "N/A";
        const payMethod = feePaid ? app.payments[0].payment_method.toUpperCase() : "";
        const displayStatus = getRowDisplayStatus(app, docsCount, feePaid);
        const createdDate = app.created_at ? new Date(app.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Active Term";
        const termYear = (app.program && app.program.academic_year) ? `AY ${app.program.academic_year}` : "AY 2026-2027";

        // Physical Documents Column
        let docsHtml = "";
        if (docsCount === 4) {
            docsHtml = `
                <span class="inline-flex items-center gap-1 font-label-code text-label-code text-secondary font-semibold">
                    <span class="material-symbols-outlined text-[16px]">check_circle</span> 4/4 Complete ✓
                </span>
            `;
        } else if (displayStatus === "REJECTED") {
            docsHtml = `
                <span class="inline-flex items-center gap-1 font-label-code text-label-code text-error">
                    <span class="material-symbols-outlined text-[16px]">close</span> ${docsCount}/4 Incomplete
                </span>
            `;
        } else {
            docsHtml = `
                <span class="inline-flex items-center gap-1 font-label-code text-label-code text-secondary">
                    <span class="material-symbols-outlined text-[16px] text-outline">warning</span> ${docsCount}/4 Handed In
                </span>
            `;
        }

        // Fee Ledger Column
        let feeHtml = "";
        if (feePaid) {
            feeHtml = `
                <span class="text-primary font-semibold">₱500.00 Settled</span>
                <span class="block text-[11px] text-on-surface-variant">${orNum} (${payMethod})</span>
            `;
        } else {
            feeHtml = `
                <span class="text-on-surface-variant">Unpaid</span>
                <span class="block text-[11px] text-outline">${docsCount < 4 ? "Awaiting Docs" : "Ready for Cashier"}</span>
            `;
        }

        // Status Badge Column
        let statusBadge = "";
        if (displayStatus === "APPROVED") {
            statusBadge = `
                <span class="inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-label-caps font-semibold uppercase bg-secondary-container/20 text-secondary">
                    APPROVED
                </span>
            `;
        } else if (displayStatus === "REJECTED") {
            statusBadge = `
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-label-caps font-semibold uppercase bg-error-container/20 text-error">
                    REJECTED
                </span>
            `;
        } else if (displayStatus === "READY") {
            statusBadge = `
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-label-caps font-semibold uppercase bg-primary-container/20 text-secondary shadow-[0_0_10px_rgba(0,242,254,0.15)]">
                    <span class="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse"></span> READY FOR DECISION
                </span>
            `;
        } else {
            statusBadge = `
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-label-caps font-semibold uppercase bg-surface-variant text-on-surface">
                    INCOMPLETE / IN PROGRESS
                </span>
            `;
        }

        // Action Gate Column (Resume button removed when APPROVED or REJECTED)
        let actionHtml = "";
        if (displayStatus === "APPROVED") {
            const hasAccount = Boolean(app.user && app.user.has_portal_account);
            actionHtml = `
                <a href="create-account.html?user_id=${encodeURIComponent(app.user_id)}" class="font-label-code text-label-code text-secondary bg-surface-container hover:bg-surface-container-high px-2.5 py-1 rounded inline-flex items-center gap-1 transition-all">
                    <span class="material-symbols-outlined text-[14px]">account_box</span>
                    <span>${hasAccount ? "Account Active ✓" : "Account Provision Ready"}</span>
                </a>
            `;
        } else if (displayStatus === "REJECTED") {
            actionHtml = `
                <span class="font-label-code text-label-code text-on-surface-variant bg-surface-container px-2.5 py-1 rounded inline-flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">archive</span> Archived / Dismissed
                </span>
            `;
        } else if (displayStatus === "READY") {
            actionHtml = `
                <div class="inline-flex items-center gap-1.5">
                    <button class="px-2.5 py-1.5 rounded bg-surface-container-high hover:bg-surface-bright text-tertiary font-label-code text-label-code" onclick="loadApplicantToConsole('${app.application_id}', true)" type="button">
                        Resume
                    </button>
                    <button class="px-3 py-1.5 rounded bg-primary-container text-on-primary-container hover:bg-secondary font-label-code text-label-code font-bold" onclick="quickApprove('${app.application_id}')" type="button">
                        Approve
                    </button>
                    <button class="px-2.5 py-1.5 rounded bg-error-container/30 hover:bg-error-container text-error font-label-code text-label-code" onclick="quickReject('${app.application_id}')" type="button">
                        Reject
                    </button>
                </div>
            `;
        } else {
            actionHtml = `
                <button class="px-3 py-1.5 rounded bg-primary-container text-on-primary-container hover:bg-secondary font-label-code text-label-code font-bold transition-all shadow-[0_0_10px_rgba(0,242,254,0.2)]" onclick="loadApplicantToConsole('${app.application_id}', true)" type="button">
                    Resume Enrollment Flow
                </button>
            `;
        }

        const isCurrent = currentApplicant && currentApplicant.appId === app.application_id;
        return `
            <tr class="applicant-row hover:bg-surface-container transition-colors ${isCurrent ? "bg-surface-container/60" : ""}" data-id="${app.application_id}">
                <td class="py-3.5 px-4 font-label-code text-label-code">
                    <span class="text-secondary font-bold block">${app.application_id}</span>
                    <span class="text-on-surface-variant text-[11px]">${createdDate}</span>
                </td>
                <td class="py-3.5 px-4">
                    <div class="flex items-center gap-space-sm">
                        <div class="w-8 h-8 rounded-full bg-surface-container-highest text-secondary flex items-center justify-center font-bold text-headline-sm">${initials}</div>
                        <div class="min-w-0">
                            <span class="font-medium text-tertiary block truncate">${fullName}</span>
                            <span class="font-label-code text-label-code text-on-surface-variant">${app.user_id}</span>
                        </div>
                    </div>
                </td>
                <td class="py-3.5 px-4">
                    <span class="bg-surface-container px-2 py-0.5 rounded font-label-code text-label-code text-on-surface">${app.course_id}</span>
                    <span class="block text-[11px] text-on-surface-variant">${termYear}</span>
                </td>
                <td class="py-3.5 px-4">
                    ${docsHtml}
                </td>
                <td class="py-3.5 px-4 font-label-code text-label-code">
                    ${feeHtml}
                </td>
                <td class="py-3.5 px-4">
                    ${statusBadge}
                </td>
                <td class="py-3.5 px-4 text-right">
                    ${actionHtml}
                </td>
            </tr>
        `;
    }).join("");
}

function loadApplicantToConsole(appId, shouldScroll) {
    const app = cachedApplications.find(a => a.application_id === appId);
    if (!app) return;

    const docs = deriveDocsFromApp(app);
    const feePaid = Boolean(app.payments && app.payments.length > 0);
    const orNum = feePaid ? app.payments[0].reference_number : "";
    const fullName = (app.user && app.user.full_name) ? app.user.full_name : app.user_id;
    const progName = (app.program && app.program.course_name)
        ? `${app.program.course_name} (${app.course_id})`
        : app.course_id;
    const phone = (app.user && app.user.phone_number) ? app.user.phone_number : "Not provided";
    const email = (app.user && app.user.email) ? app.user.email : "-";
    const docsCount = [docs.psa, docs.f138, docs.moral, docs.photo].filter(Boolean).length;

    currentApplicant = {
        appId: app.application_id,
        userId: app.user_id,
        name: fullName,
        program: progName,
        phone: phone,
        email: email,
        docs: docs,
        feePaid: feePaid,
        orNumber: orNum,
        status: getRowDisplayStatus(app, docsCount, feePaid)
    };

    document.getElementById("active-session-id").textContent = currentApplicant.appId;
    document.getElementById("console-applicant-name").textContent = currentApplicant.name;
    document.getElementById("console-applicant-id").textContent = currentApplicant.userId;
    document.getElementById("console-program").textContent = currentApplicant.program;
    document.getElementById("console-phone").textContent = currentApplicant.phone;
    document.getElementById("console-email").textContent = currentApplicant.email;

    document.getElementById("doc-psa").checked = currentApplicant.docs.psa;
    document.getElementById("doc-f138").checked = currentApplicant.docs.f138;
    document.getElementById("doc-moral").checked = currentApplicant.docs.moral;
    document.getElementById("doc-photo").checked = currentApplicant.docs.photo;

    document.getElementById("fee-paid-toggle").checked = currentApplicant.feePaid;
    document.getElementById("or-number-input").value = currentApplicant.orNumber;

    refreshConsoleVisualState();
    renderMasterQueueTable();

    if (shouldScroll) {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

function updateItemStatusBadge(badgeId, isChecked) {
    const el = document.getElementById(badgeId);
    if (!el) return;
    if (isChecked) {
        el.className = "font-label-code text-label-code text-secondary flex items-center gap-1";
        el.innerHTML = '<span class="material-symbols-outlined text-[16px]">verified</span> Validated';
    } else {
        el.className = "font-label-code text-label-code text-error flex items-center gap-1 bg-error-container/20 px-2 py-0.5 rounded";
        el.innerHTML = '<span class="material-symbols-outlined text-[16px]">pending</span> Pending Hand-in';
    }
}

function refreshConsoleVisualState() {
    const psa = document.getElementById("doc-psa").checked;
    const f138 = document.getElementById("doc-f138").checked;
    const moral = document.getElementById("doc-moral").checked;
    const photo = document.getElementById("doc-photo").checked;

    currentApplicant.docs = { psa, f138, moral, photo };
    const checkedCount = [psa, f138, moral, photo].filter(Boolean).length;

    updateItemStatusBadge("doc-psa-status", psa);
    updateItemStatusBadge("doc-f138-status", f138);
    updateItemStatusBadge("doc-moral-status", moral);
    updateItemStatusBadge("doc-photo-status", photo);

    const badge = document.getElementById("doc-counter-badge");
    const stepSubtext2 = document.getElementById("step-subtext-2");
    const stepNode3 = document.getElementById("step-node-3");
    const stepBadge3 = document.getElementById("step-badge-3");
    const stepNode4 = document.getElementById("step-node-4");
    const stepBadge4 = document.getElementById("step-badge-4");
    const btnApprove = document.getElementById("btn-approve");
    const actionLockStatus = document.getElementById("action-lock-status");
    const feeDesc = document.getElementById("fee-status-description");
    const feeToggle = document.getElementById("fee-paid-toggle");

    badge.textContent = `${checkedCount} / 4 VERIFIED`;
    stepSubtext2.textContent = `${checkedCount}/4 Documents Handed`;

    const allDocsVerified = checkedCount === 4;
    const feeSettled = feeToggle.checked;

    if (feeSettled) {
        feeDesc.textContent = `Confirmed Cashier Slip (${currentApplicant.orNumber || "Verified"})`;
        feeDesc.classList.remove("text-error");
        feeDesc.classList.add("text-on-surface-variant");
    } else {
        feeDesc.textContent = allDocsVerified ? "Ready for ₱500.00 Cashier Settlement" : "Awaiting 4/4 Physical Documents";
        feeDesc.classList.add("text-error");
        feeDesc.classList.remove("text-on-surface-variant");
    }

    if (allDocsVerified) {
        stepNode3.classList.remove("opacity-70");
        stepBadge3.className = "w-8 h-8 rounded-full bg-primary-container text-on-primary-container font-headline-sm text-headline-sm flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(0,242,254,0.3)]";
        stepBadge3.innerHTML = feeSettled ? '<span class="material-symbols-outlined text-[18px]">done</span>' : "3";
    } else {
        stepNode3.classList.add("opacity-70");
        stepBadge3.className = "w-8 h-8 rounded-full bg-surface-variant text-on-surface-variant font-headline-sm text-headline-sm flex items-center justify-center shrink-0";
        stepBadge3.textContent = "3";
    }

    if (allDocsVerified && feeSettled) {
        stepNode4.classList.remove("opacity-70");
        stepBadge4.className = "w-8 h-8 rounded-full bg-primary-container text-on-primary-container font-headline-sm text-headline-sm flex items-center justify-center shrink-0 ring-4 ring-primary-container/20";
        btnApprove.disabled = false;
        btnApprove.classList.remove("opacity-40", "cursor-not-allowed");
        actionLockStatus.innerHTML = '<span class="material-symbols-outlined text-[16px] text-secondary">check_circle</span> Ready For Approval';
    } else {
        stepNode4.classList.add("opacity-70");
        stepBadge4.className = "w-8 h-8 rounded-full bg-surface-variant text-on-surface-variant font-headline-sm text-headline-sm flex items-center justify-center shrink-0";
        btnApprove.disabled = true;
        btnApprove.classList.add("opacity-40", "cursor-not-allowed");
        actionLockStatus.innerHTML = '<span class="material-symbols-outlined text-[16px] text-outline">lock</span> Prerequisites Required';
    }
}

async function persistCurrentChecklist() {
    if (!currentApplicant || !currentApplicant.appId) return;
    const checkedList = [];
    if (document.getElementById("doc-psa").checked) checkedList.push(DOC_MAP.psa);
    if (document.getElementById("doc-f138").checked) checkedList.push(DOC_MAP.f138);
    if (document.getElementById("doc-moral").checked) checkedList.push(DOC_MAP.moral);
    if (document.getElementById("doc-photo").checked) checkedList.push(DOC_MAP.photo);

    const res = await fetch(`${API_BASE}/documents/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            application_id: currentApplicant.appId,
            checked_documents: checkedList
        })
    });
    if (res.ok) {
        const updatedApp = await res.json();
        const idx = cachedApplications.findIndex(a => a.application_id === updatedApp.application_id);
        if (idx >= 0) cachedApplications[idx] = updatedApp;
        renderMasterQueueTable();
    }
}

async function updateDocState() {
    refreshConsoleVisualState();
    await persistCurrentChecklist();
}

async function verifyReceiptSync() {
    if (!currentApplicant || !currentApplicant.appId) return;

    const psa = document.getElementById("doc-psa").checked;
    const f138 = document.getElementById("doc-f138").checked;
    const moral = document.getElementById("doc-moral").checked;
    const photo = document.getElementById("doc-photo").checked;
    if (![psa, f138, moral, photo].every(Boolean)) {
        showConsoleNotice("All 4 physical documents must be checked and validated before recording the ₱500.00 enrollment fee.", true);
        document.getElementById("fee-paid-toggle").checked = false;
        refreshConsoleVisualState();
        return;
    }

    await persistCurrentChecklist();

    if (currentApplicant.feePaid) {
        showConsoleNotice(`Enrollment fee already settled (${currentApplicant.orNumber}). Ready for Approval.`, false);
        return;
    }

    try {
        const methodEl = document.getElementById("fee-method-select");
        const method = methodEl ? methodEl.value : "cash";

        const res = await fetch(`${API_BASE}/payments/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                application_id: currentApplicant.appId,
                amount: 500.00,
                payment_method: method
            })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to record enrollment fee.");
        }

        const payData = await res.json();
        currentApplicant.feePaid = true;
        currentApplicant.orNumber = payData.reference_number;
        document.getElementById("or-number-input").value = payData.reference_number;
        document.getElementById("fee-paid-toggle").checked = true;

        showConsoleNotice(`Official Receipt #${payData.reference_number} (₱500.00) recorded! Applicant is now unlocked for Approval.`, false);
        await fetchAllApplications(currentApplicant.appId);

    } catch (error) {
        showConsoleNotice(`Error: ${error.message}`, true);
    }
}

async function voidEnrollmentFeePayment() {
    if (!currentApplicant || !currentApplicant.appId) return;

    if (currentApplicant.status === "APPROVED" || currentApplicant.status === "REJECTED") {
        showConsoleNotice(`Cannot void enrollment fee because application ${currentApplicant.appId} is already ${currentApplicant.status}.`, true);
        document.getElementById("fee-paid-toggle").checked = true;
        refreshConsoleVisualState();
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/payments/enrollment-fee/${encodeURIComponent(currentApplicant.appId)}`, {
            method: "DELETE"
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to void enrollment fee payment.");
        }

        currentApplicant.feePaid = false;
        currentApplicant.orNumber = "";
        document.getElementById("or-number-input").value = "";
        document.getElementById("fee-paid-toggle").checked = false;

        showConsoleNotice("Enrollment fee payment (₱500.00) voided and removed from database. Official Receipt cleared.", false);
        await fetchAllApplications(currentApplicant.appId);
    } catch (error) {
        document.getElementById("fee-paid-toggle").checked = true;
        refreshConsoleVisualState();
        showConsoleNotice(`Error: ${error.message}`, true);
    }
}

async function toggleFeeState() {
    const feeToggle = document.getElementById("fee-paid-toggle");
    if (feeToggle.checked && !currentApplicant.feePaid) {
        await verifyReceiptSync();
    } else if (!feeToggle.checked && currentApplicant.feePaid) {
        await voidEnrollmentFeePayment();
    } else {
        refreshConsoleVisualState();
    }
}

function showConsoleNotice(message, isError) {
    const box = document.getElementById("checklist-warning-box");
    if (!box) return;
    box.className = isError
        ? "mt-space-md p-space-sm rounded-lg bg-error-container/30 border-l-4 border-error flex items-center gap-space-sm"
        : "mt-space-md p-space-sm rounded-lg bg-primary-container/10 border-l-4 border-primary-container flex items-center gap-space-sm";
    box.innerHTML = `
        <span class="material-symbols-outlined ${isError ? "text-error" : "text-primary-container"} text-[22px] shrink-0">${isError ? "warning" : "verified"}</span>
        <span class="font-body-sm text-body-sm text-tertiary">${message}</span>
    `;
}

async function handleDecision(decisionType) {
    if (!currentApplicant || !currentApplicant.appId) return;

    if (decisionType === "suspend") {
        await persistCurrentChecklist();
        showConsoleNotice(`Session for ${currentApplicant.name} (${currentApplicant.appId}) saved! You can click 'Resume Enrollment Flow' in the Master Registry below anytime.`, false);
        return;
    }

    const targetStatus = decisionType === "approve" ? "approved" : "rejected";

    try {
        const res = await fetch(`${API_BASE}/applications/${encodeURIComponent(currentApplicant.appId)}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: targetStatus })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to update application decision.");
        }

        if (targetStatus === "approved") {
            showConsoleNotice(
                `Applicant ${currentApplicant.name} (${currentApplicant.appId}) is now APPROVED! Resume button removed from queue. <a href="create-account.html?user_id=${encodeURIComponent(currentApplicant.userId)}" class="underline text-primary-container font-bold ml-2">Provision Student Portal Account (${currentApplicant.userId}) &rarr;</a>`,
                false
            );
        } else {
            showConsoleNotice(`Application ${currentApplicant.appId} (${currentApplicant.name}) has been marked as REJECTED and archived.`, true);
        }

        await fetchAllApplications(currentApplicant.appId);

    } catch (error) {
        showConsoleNotice(`Error: ${error.message}`, true);
    }
}

async function quickApprove(appId) {
    loadApplicantToConsole(appId, false);
    await handleDecision("approve");
}

async function quickReject(appId) {
    loadApplicantToConsole(appId, false);
    await handleDecision("reject");
}

function filterApplicantsTable() {
    renderMasterQueueTable();
}

function setFilter(statusKey, btn) {
    activeFilterKey = statusKey;
    document.querySelectorAll(".filter-tab-btn").forEach(b => {
        b.className = "filter-tab-btn px-2.5 py-1 text-label-caps font-label-caps rounded text-on-surface-variant hover:text-tertiary";
    });
    if (btn) {
        btn.className = "filter-tab-btn px-2.5 py-1 text-label-caps font-label-caps rounded text-primary bg-surface-container-high";
    }
    renderMasterQueueTable();
}
