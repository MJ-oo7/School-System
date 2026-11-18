var API_BASE = window.API_BASE || "http://127.0.0.1:8000";
const SEMESTRAL_TUITION = 20000;
const MILESTONE_AMOUNT = 5000;

let allApplications = [];
let activeLedgerApp = null;

window.onload = async function () {
    const input = document.getElementById("student-lookup-input");
    if (input) {
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") triggerLookupAnimation();
        });
    }

    await loadQuickAccessDossiers();

    const params = new URLSearchParams(window.location.search);
    const prefillAppId = params.get("app_id");
    if (prefillAppId && input) {
        input.value = prefillAppId.trim().toUpperCase();
        await lookupDossier(prefillAppId.trim().toUpperCase(), false);
    } else if (allApplications.length > 0) {
        const firstApproved = allApplications.find(a => a.status === "approved") || allApplications[0];
        if (firstApproved && input) {
            input.value = firstApproved.application_id;
            await lookupDossier(firstApproved.application_id, false);
        }
    }
};

async function loadQuickAccessDossiers() {
    try {
        const res = await fetch(`${API_BASE}/admin/applications`);
        if (!res.ok) return;
        allApplications = await res.json();

        const chipsContainer = document.getElementById("quick-access-chips");
        if (!chipsContainer) return;

        const topApps = allApplications.slice(0, 4);
        chipsContainer.innerHTML = `<span class="font-label-caps text-label-caps text-on-surface-variant/70 uppercase">Recently Accessed Dossiers:</span>` +
            topApps.map((app, idx) => {
                const name = (app.user && app.user.full_name) ? app.user.full_name : app.user_id;
                const shortName = name.split(" ").map((p, i) => i === 0 ? p : p[0] + ".").join(" ");
                const dotColor = idx === 0 ? "bg-secondary" : "bg-outline-variant";
                return `
                    <button class="flex items-center gap-1.5 bg-surface-container-low hover:bg-surface-container px-space-sm py-1 rounded text-secondary transition-colors font-label-code text-label-code" onclick="selectQuickDossier('${app.application_id}')" type="button">
                        <span class="w-1.5 h-1.5 rounded-full ${dotColor}"></span>
                        <span>${app.application_id}</span>
                        <span class="text-on-surface-variant/70">(${shortName})</span>
                    </button>
                `;
            }).join("");
    } catch (e) {
        console.error(e);
    }
}

function showNotification(title, message) {
    const toast = document.getElementById("toast-notification");
    const toastTitle = document.getElementById("toast-title");
    const toastMessage = document.getElementById("toast-message");

    if (!toast) return;
    toastTitle.innerText = title;
    toastMessage.innerText = message;

    toast.classList.remove("translate-y-24", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");

    setTimeout(() => {
        toast.classList.remove("translate-y-0", "opacity-100");
        toast.classList.add("translate-y-24", "opacity-0");
    }, 4000);
}

async function triggerLookupAnimation() {
    const input = document.getElementById("student-lookup-input");
    const val = input ? input.value.trim().toUpperCase() : "";
    if (!val) {
        showNotification("Invalid Application ID", "Please enter a valid Application ID or Student User ID.");
        return;
    }
    await lookupDossier(val, true);
}

async function selectQuickDossier(appId) {
    const input = document.getElementById("student-lookup-input");
    if (input) input.value = appId;
    await lookupDossier(appId, true);
}

async function lookupDossier(queryId, notify) {
    try {
        // Support looking up by Application ID or User ID
        let targetAppId = queryId;
        if (queryId.startsWith("USER-") && allApplications.length > 0) {
            const match = allApplications.find(a => a.user_id.toUpperCase() === queryId);
            if (match) targetAppId = match.application_id;
        }

        const res = await fetch(`${API_BASE}/applications/${encodeURIComponent(targetAppId)}`);
        if (!res.ok) {
            showNotification("Record Not Found", `No application dossier found matching '${queryId}'.`);
            return;
        }
        const app = await res.json();
        activeLedgerApp = app;
        renderLoadedStudentLedger(app);
        if (notify) {
            showNotification("Student Record Loaded", `Dossier for ${app.application_id} synchronized with Central Treasury ledger.`);
        }
    } catch (e) {
        showNotification("Lookup Error", e.message);
    }
}

function computeTuitionStats(app) {
    let tuitionPaidFromDb = 0;
    let enrollmentFeeRecord = null;
    const tuitionPayments = [];

    if (app.payments && app.payments.length > 0) {
        app.payments.forEach((p, idx) => {
            const ref = String(p.reference_number || "");
            if (idx === 0 && !ref.startsWith("TUI-")) {
                enrollmentFeeRecord = p;
            } else {
                tuitionPaidFromDb += Number(p.amount || 0);
                tuitionPayments.push(p);
            }
        });
    }

    const paidMilestones = Math.min(4, Math.floor(tuitionPaidFromDb / MILESTONE_AMOUNT));
    const totalSettled = Math.min(SEMESTRAL_TUITION, tuitionPaidFromDb);
    const outstanding = Math.max(0, SEMESTRAL_TUITION - totalSettled);

    return {
        paidMilestones,
        totalSettled,
        outstanding,
        enrollmentFeeRecord,
        tuitionPayments
    };
}

function renderLoadedStudentLedger(app) {
    const stats = computeTuitionStats(app);
    const fullName = (app.user && app.user.full_name) ? app.user.full_name : app.user_id;
    const initials = fullName.split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "ST";
    const progName = (app.program && app.program.course_name) ? `${app.program.course_name} (${app.course_id})` : app.course_id;
    const termName = (app.program && app.program.academic_year) ? `AY ${app.program.academic_year} (1st Semester)` : "AY 2026-2027 (1st Semester)";
    const hasPortalAcct = Boolean(app.user && app.user.has_portal_account);

    // Header Card
    document.getElementById("dossier-initials").textContent = initials;
    document.getElementById("dossier-student-name").textContent = fullName;
    document.getElementById("dossier-status-badge").textContent = (app.status || "").replace("_", " ").toUpperCase();
    document.getElementById("dossier-account-badge").textContent = hasPortalAcct ? "Account: Active" : "Account: Unprovisioned";
    document.getElementById("dossier-app-id").textContent = app.application_id;
    document.getElementById("dossier-user-id").textContent = app.user_id;
    document.getElementById("dossier-program").textContent = progName;
    document.getElementById("dossier-term").textContent = termName;

    // 4 Metric Bento Cards
    const pct = Math.round((stats.totalSettled / SEMESTRAL_TUITION) * 100);
    document.getElementById("ledger-settled-pct").textContent = `${pct}% SETTLED`;
    document.getElementById("ledger-settled-amt").textContent = `₱${stats.totalSettled.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    document.getElementById("ledger-settled-count").textContent = `${stats.paidMilestones} of 4 Installments Cleared`;
    document.getElementById("ledger-settled-bar").style.width = `${pct}%`;

    document.getElementById("ledger-balance-amt").textContent = `₱${stats.outstanding.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    document.getElementById("ledger-balance-count").textContent = `${4 - stats.paidMilestones} Installments Remaining`;

    const milestonesMeta = [
        { num: 1, code: "M1", title: "Month 1 (Prelims)", due: "Aug 28, 2026", permit: "Prelim Examination Permit" },
        { num: 2, code: "M2", title: "Month 2 (Midterms)", due: "Oct 15, 2026", permit: "Midterm Examination Permit" },
        { num: 3, code: "M3", title: "Month 3 (Semi-Finals)", due: "Nov 15, 2026", permit: "Pre-Final Examination Permit" },
        { num: 4, code: "M4", title: "Month 4 (Finals)", due: "Dec 15, 2026", permit: "Final Term Examination Permit" }
    ];

    const nextDue = milestonesMeta.find(m => m.num > stats.paidMilestones);
    document.getElementById("ledger-next-due-date").textContent = nextDue ? `Next: ${nextDue.due}` : "Full Semester Settled";
    document.getElementById("ledger-next-due-amt").textContent = nextDue ? "₱5,000.00 Due" : "₱0.00 Due";

    document.getElementById("ledger-current-milestone-title").textContent = nextDue ? nextDue.title : "All 4 Milestones Cleared";
    document.getElementById("ledger-current-milestone-date").textContent = nextDue ? `Target Date: ${nextDue.due}` : "Full Semestral Clearance";
    document.getElementById("ledger-current-milestone-badge").textContent = nextDue ? "DUE TODAY" : "CLEARED ✓";
    document.getElementById("ledger-permit-status").textContent = nextDue ? "Locked" : "Released ✓";
    document.getElementById("ledger-permit-status").className = nextDue ? "text-error uppercase font-semibold" : "text-secondary uppercase font-semibold";

    // 4-Month Installment Nodes Grid
    const nodesGrid = document.getElementById("installment-nodes-grid");
    nodesGrid.innerHTML = milestonesMeta.map(m => {
        const isPaid = m.num <= stats.paidMilestones;
        const isCurrent = m.num === stats.paidMilestones + 1;
        const payObj = stats.tuitionPayments[m.num - 1];
        const orText = payObj ? payObj.reference_number : `OR-M${m.num}`;

        if (isPaid) {
            return `
                <div class="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between relative group hover:bg-surface-container transition-all">
                    <div class="flex items-center justify-between mb-space-sm">
                        <span class="font-label-code text-label-code text-secondary font-semibold">MILESTONE 0${m.num}</span>
                        <span class="flex items-center gap-1 font-label-code text-label-code bg-secondary/15 text-secondary px-2 py-0.5 rounded">
                            <span class="material-symbols-outlined text-[14px]">check_circle</span>
                            PAID
                        </span>
                    </div>
                    <div>
                        <h4 class="font-headline-sm text-headline-sm text-tertiary">${m.title}</h4>
                        <div class="font-metric-num text-headline-md text-secondary-fixed-dim mt-1">₱5,000.00</div>
                    </div>
                    <div class="mt-space-md pt-space-sm border-t border-outline-variant/10 text-on-surface-variant font-label-code text-body-sm space-y-1">
                        <div class="flex justify-between items-center text-[12px]">
                            <span class="text-outline">Scheduled:</span>
                            <span class="text-tertiary">${m.due}</span>
                        </div>
                        <div class="flex justify-between items-center text-[12px]">
                            <span class="text-outline">Receipt No:</span>
                            <span class="text-secondary font-medium">${orText}</span>
                        </div>
                        <div class="flex justify-between items-center text-[12px]">
                            <span class="text-outline">Permit:</span>
                            <span class="text-secondary">Released</span>
                        </div>
                    </div>
                </div>
            `;
        } else if (isCurrent) {
            return `
                <div class="bg-surface-container rounded-xl p-space-md flex flex-col justify-between relative ring-1 ring-primary-container shadow-lg shadow-primary-container/5">
                    <div class="flex items-center justify-between mb-space-sm">
                        <span class="font-label-code text-label-code text-primary-container font-semibold">MILESTONE 0${m.num}</span>
                        <span class="flex items-center gap-1 font-label-code text-label-code bg-error-container/40 text-error px-2 py-0.5 rounded font-bold animate-pulse">
                            <span class="material-symbols-outlined text-[14px]">schedule</span>
                            DUE TODAY
                        </span>
                    </div>
                    <div>
                        <h4 class="font-headline-sm text-headline-sm text-tertiary">${m.title}</h4>
                        <div class="font-metric-num text-headline-md text-tertiary mt-1">₱5,000.00</div>
                    </div>
                    <div class="mt-space-md pt-space-sm border-t border-outline-variant/10 text-on-surface-variant font-label-code text-body-sm space-y-1">
                        <div class="flex justify-between items-center text-[12px]">
                            <span class="text-outline">Due Date:</span>
                            <span class="text-error font-semibold">${m.due}</span>
                        </div>
                        <div class="flex justify-between items-center text-[12px]">
                            <span class="text-outline">Status:</span>
                            <span class="text-tertiary">Awaiting Cashier</span>
                        </div>
                        <div class="flex justify-between items-center text-[12px]">
                            <span class="text-outline">Permit:</span>
                            <span class="text-error">On Hold</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            return `
                <div class="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between opacity-85 hover:opacity-100 transition-opacity">
                    <div class="flex items-center justify-between mb-space-sm">
                        <span class="font-label-code text-label-code text-on-surface-variant font-semibold">MILESTONE 0${m.num}</span>
                        <span class="font-label-code text-label-code bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded">
                            UPCOMING
                        </span>
                    </div>
                    <div>
                        <h4 class="font-headline-sm text-headline-sm text-tertiary">${m.title}</h4>
                        <div class="font-metric-num text-headline-md text-tertiary mt-1">₱5,000.00</div>
                    </div>
                    <div class="mt-space-md pt-space-sm border-t border-outline-variant/10 text-on-surface-variant font-label-code text-body-sm space-y-1">
                        <div class="flex justify-between items-center text-[12px]">
                            <span class="text-outline">Due Date:</span>
                            <span class="text-on-surface">${m.due}</span>
                        </div>
                        <div class="flex justify-between items-center text-[12px]">
                            <span class="text-outline">Grace Period:</span>
                            <span class="text-on-surface">3 Days</span>
                        </div>
                        <div class="flex justify-between items-center text-[12px]">
                            <span class="text-outline">Permit:</span>
                            <span class="text-on-surface-variant">Scheduled</span>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join("");

    // Pre-select next milestone in form
    const milestoneSelect = document.getElementById("payment-milestone-select");
    const activeMilestoneTag = document.getElementById("active-milestone-tag");
    if (milestoneSelect && nextDue) {
        milestoneSelect.value = nextDue.code;
        if (activeMilestoneTag) activeMilestoneTag.textContent = `Milestone #${nextDue.num} active`;
        document.getElementById("payment-amount-input").value = "5000.00";
    } else if (milestoneSelect && !nextDue) {
        milestoneSelect.value = "FULL";
        if (activeMilestoneTag) activeMilestoneTag.textContent = "All Milestones Settled";
        document.getElementById("payment-amount-input").value = "0.00";
    }

    // Clearance Governance Right Panel
    document.getElementById("summary-total-posted").textContent = `₱${stats.totalSettled.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    document.getElementById("summary-current-due").textContent = nextDue ? "₱5,000.00" : "₱0.00";
    document.getElementById("clearance-gate-badge").textContent = nextDue ? "GATED" : "CLEARED";
    document.getElementById("clearance-gate-badge").className = nextDue
        ? "font-label-code text-label-code text-error bg-error-container/30 px-2 py-0.5 rounded font-semibold"
        : "font-label-code text-label-code text-secondary bg-secondary/15 px-2 py-0.5 rounded font-semibold";
    document.getElementById("clearance-permit-title").textContent = nextDue ? nextDue.permit : "All Examination Permits Released";

    // Audit History Table
    document.getElementById("ledger-history-heading").textContent = `Payment Ledger Entries for ${fullName}`;
    const tbody = document.getElementById("ledger-table-body");
    const allPayments = app.payments || [];

    document.getElementById("ledger-footer-summary").textContent = `Showing ${allPayments.length} ledger transaction(s) for Student ${app.application_id}`;

    if (allPayments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-6 px-space-md text-center text-on-surface-variant font-label-code">
                    No payments recorded for ${app.application_id} yet.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = allPayments.slice().reverse().map((p, idx) => {
        const ref = String(p.reference_number || "OR-0000");
        const isEnrollmentDeposit = !ref.startsWith("TUI-") && Number(p.amount) === 500;
        const targetLabel = isEnrollmentDeposit ? "Initial Enrollment Assessment Fee" : `Semestral Tuition Installment (${ref})`;
        const methodText = String(p.payment_method || "gcash").toUpperCase();

        return `
            <tr class="hover:bg-surface-container/50 transition-colors">
                <td class="py-3.5 px-space-md font-label-code text-tertiary">
                    AY 2026-2027 <span class="text-on-surface-variant text-[11px]">Posted</span>
                </td>
                <td class="py-3.5 px-space-md">
                    <span class="font-label-code text-secondary bg-secondary/10 px-2 py-0.5 rounded font-medium">
                        ${ref}
                    </span>
                </td>
                <td class="py-3.5 px-space-md">
                    <span class="text-tertiary font-medium">${targetLabel}</span>
                </td>
                <td class="py-3.5 px-space-md text-right font-metric-num text-headline-sm text-secondary-fixed-dim">
                    ₱${Number(p.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </td>
                <td class="py-3.5 px-space-md">
                    <div class="flex items-center gap-1 text-on-surface-variant font-label-code text-[12px]">
                        <span class="material-symbols-outlined text-[16px] text-tertiary">account_balance_wallet</span>
                        <span>${methodText}</span>
                    </div>
                </td>
                <td class="py-3.5 px-space-md font-label-code text-on-surface-variant text-[12px]">
                    Admin Registrar #ADMIN-001
                </td>
                <td class="py-3.5 px-space-md text-center">
                    <button class="inline-flex items-center gap-1 text-secondary hover:text-primary-container transition-colors font-label-code text-[12px] bg-surface-container px-2.5 py-1 rounded hover:bg-surface-container-high" onclick="downloadReceipt('${ref}')" type="button">
                        <span class="material-symbols-outlined text-[16px]">receipt</span>
                        <span>PDF OR</span>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function setExactAmount(amt) {
    const amtInput = document.getElementById("payment-amount-input");
    if (amtInput) amtInput.value = amt.toFixed(2);
}

function updateAmountSuggestion(milestone) {
    const amtInput = document.getElementById("payment-amount-input");
    if (!amtInput || !activeLedgerApp) return;
    const stats = computeTuitionStats(activeLedgerApp);
    if (milestone === "FULL") {
        amtInput.value = stats.outstanding.toFixed(2);
    } else {
        amtInput.value = "5000.00";
    }
}

async function handlePostPayment(e) {
    e.preventDefault();
    if (!activeLedgerApp) {
        showNotification("No Student Selected", "Please look up a Student Application ID first.");
        return;
    }

    const milestoneSelect = document.getElementById("payment-milestone-select");
    const milestoneVal = milestoneSelect.value;
    const amtVal = parseFloat(document.getElementById("payment-amount-input").value);
    const methodSelect = document.getElementById("payment-method-select");
    const methodVal = methodSelect.value;

    if (isNaN(amtVal) || amtVal <= 0) {
        showNotification("Invalid Amount", "Please enter a payment amount greater than 0.");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/applications/${encodeURIComponent(activeLedgerApp.application_id)}/tuition-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                amount: amtVal,
                payment_method: methodVal,
                milestone_label: milestoneVal
            })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to post payment.");
        }

        const updatedApp = await res.json();
        activeLedgerApp = updatedApp;
        renderLoadedStudentLedger(updatedApp);

        const latestPayment = updatedApp.payments[updatedApp.payments.length - 1];
        const orNum = latestPayment ? latestPayment.reference_number : "OR-POSTED";
        document.getElementById("payment-or-input").value = orNum;

        showNotification("Payment Successfully Posted", `OR #${orNum} for ₱${amtVal.toLocaleString("en-US", { minimumFractionDigits: 2 })} logged and ledger updated.`);

    } catch (error) {
        showNotification("Transaction Error", error.message);
    }
}

function printSOA() {
    window.print();
}

function openAdjustmentModal() {
    showNotification("Tuition Adjustment", "Select a target milestone and enter the adjusted amount below.");
}

function issueExamPermit() {
    if (!activeLedgerApp) return;
    showNotification("Exam Clearance Issued", `Digital examination permit released for ${activeLedgerApp.application_id}.`);
}

function exportLedgerCSV() {
    if (!activeLedgerApp) return;
    showNotification("Ledger Export Triggered", `Exported audit ledger for ${activeLedgerApp.application_id}.`);
}

function downloadReceipt(orNumber) {
    showNotification("Official Receipt Verified", `Receipt ${orNumber} verified in Central Treasury Ledger.`);
}
