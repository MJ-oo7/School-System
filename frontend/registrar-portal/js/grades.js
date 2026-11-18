var API_BASE = window.API_BASE || "http://127.0.0.1:8000";

let allPrograms = [];
let currentSubjectMeta = null;
let currentRoster = [];
let currentPeriodFilter = "all";

function showGradesToast(message) {
    const toast = document.getElementById("toast-notification");
    const toastText = document.getElementById("toast-text");
    if (!toast || !toastText) return;
    toastText.textContent = message;
    toast.classList.remove("opacity-0", "pointer-events-none");
    toast.classList.add("opacity-100");
    setTimeout(() => {
        toast.classList.remove("opacity-100");
        toast.classList.add("opacity-0", "pointer-events-none");
    }, 3000);
}

function showGradesFeedback(type, message) {
    const box = document.getElementById("grades-feedback");
    if (!box) return;
    box.classList.remove("hidden");
    if (type === "success") {
        box.className = "p-3 rounded-lg bg-surface-container border border-outline-variant text-primary font-label-code text-label-code flex items-center justify-between";
        box.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-[18px]">check_circle</span>
                <span>${message}</span>
            </div>
            <button type="button" onclick="this.parentElement.classList.add('hidden')" class="text-on-surface-variant hover:text-primary">
                <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
        `;
    } else {
        box.className = "p-3 rounded-lg bg-error-container/25 border border-error text-error font-label-code text-label-code flex items-center justify-between";
        box.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-[18px]">error</span>
                <span>${message}</span>
            </div>
            <button type="button" onclick="this.parentElement.classList.add('hidden')" class="text-on-surface-variant hover:text-primary">
                <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
        `;
    }
}

function computeGwaAndRemark(prelim, midterm, final) {
    const parseGrade = (v) => {
        if (v === null || v === undefined || String(v).trim() === "") return null;
        const n = parseFloat(v);
        if (isNaN(n) || n < 0.0 || n > 100.0) return null;
        return n;
    };
    const p = parseGrade(prelim);
    const m = parseGrade(midterm);
    const f = parseGrade(final);

    if (p !== null && m !== null && f !== null) {
        const pct = p * 0.30 + m * 0.30 + f * 0.40;
        let remark = "Passing";
        if (pct >= 97.0) remark = "Excellent";
        else if (pct >= 90.0) remark = "Superior";
        else if (pct >= 82.0) remark = "Satisfactory";
        else if (pct >= 75.0) remark = "Passing";
        else remark = "Failed";
        return { gwa: pct, remark, complete: true };
    }

    const avail = [p, m, f].filter(x => x !== null);
    if (avail.length === 0) {
        return { gwa: null, remark: "Pending", complete: false };
    }
    const partial = avail.reduce((a, b) => a + b, 0) / avail.length;
    return { gwa: partial, remark: "Incomplete (In Progress)", complete: false };
}

async function initGradeEncodingPage() {
    try {
        const [progRes, appsRes] = await Promise.all([
            fetch(`${API_BASE}/programs/all`),
            fetch(`${API_BASE}/admin/applications`)
        ]);
        if (!progRes.ok) return;
        allPrograms = await progRes.json();
        const allApps = appsRes.ok ? await appsRes.json() : [];

        // Count approved/enrolled students per course_id
        const enrolledCountByCourse = {};
        allApps.forEach(a => {
            if (a.status === "approved") {
                enrolledCountByCourse[a.course_id] = (enrolledCountByCourse[a.course_id] || 0) + 1;
            }
        });

        const courseSelect = document.getElementById("grade-course-select");
        if (!courseSelect) return;

        if (allPrograms.length === 0) {
            courseSelect.innerHTML = `<option value="">No courses available</option>`;
            return;
        }

        courseSelect.innerHTML = allPrograms.map(p => {
            const cnt = enrolledCountByCourse[p.course_id] || 0;
            return `<option value="${p.course_id}">${p.course_id} — ${p.course_name} (${cnt} Enrolled)</option>`;
        }).join("");

        // Automatically select the first course that has enrolled students & subjects
        const bestProgram = allPrograms.find(p => (enrolledCountByCourse[p.course_id] || 0) > 0 && (p.subjects || []).length > 0)
            || allPrograms.find(p => (enrolledCountByCourse[p.course_id] || 0) > 0)
            || allPrograms[0];

        if (bestProgram) {
            courseSelect.value = bestProgram.course_id;
            const semSelect = document.getElementById("grade-sem-select");
            if (semSelect && Array.isArray(bestProgram.subjects) && bestProgram.subjects.length > 0) {
                const hasSem1 = bestProgram.subjects.some(s => Number(s.semester) === 1);
                if (!hasSem1) semSelect.value = "2";
            }
        }

        handleCourseOrSemChange();
    } catch (err) {
        console.error("Failed to initialize Grade Encoding portal:", err);
    }
}

function handleCourseOrSemChange() {
    const courseId = document.getElementById("grade-course-select")?.value;
    const sem = Number(document.getElementById("grade-sem-select")?.value || 1);
    const subjectSelect = document.getElementById("grade-subject-select");
    if (!subjectSelect) return;

    const program = allPrograms.find(p => p.course_id === courseId);
    const subjects = (program && Array.isArray(program.subjects))
        ? program.subjects.filter(s => Number(s.semester) === sem)
        : [];

    if (subjects.length === 0) {
        subjectSelect.innerHTML = `<option value="">No subjects in this semester</option>`;
        currentSubjectMeta = null;
        currentRoster = [];
        document.getElementById("subject-instructor-badge").textContent = "Instructor: N/A";
        document.getElementById("subject-room-badge").textContent = "Room: N/A";
        renderRosterTable();
        return;
    }

    subjectSelect.innerHTML = subjects.map(s =>
        `<option value="${s.subject_id}">${s.subject_code} — ${s.subject_name} (${s.units}u)</option>`
    ).join("");

    loadSelectedSubjectRoster();
}

async function loadSelectedSubjectRoster() {
    const subjectId = document.getElementById("grade-subject-select")?.value;
    if (!subjectId) {
        currentRoster = [];
        renderRosterTable();
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/subjects/${encodeURIComponent(subjectId)}/grades`);
        if (!res.ok) return;
        const data = await res.json();
        currentSubjectMeta = data.subject;
        currentRoster = data.roster || [];

        const semText = Number(currentSubjectMeta.semester) === 2 ? "2nd Semester" : "1st Semester";
        document.getElementById("subject-term-badge").textContent =
            `AY ${currentSubjectMeta.academic_year} • ${semText} • ${currentSubjectMeta.subject_code} (${currentSubjectMeta.units}.0 Units)`;
        document.getElementById("subject-instructor-badge").textContent =
            `Instructor: ${currentSubjectMeta.instructor_name || "N/A"}`;
        document.getElementById("subject-room-badge").textContent =
            `Room: ${currentSubjectMeta.room || "N/A"}`;

        renderRosterTable();
    } catch (err) {
        console.error("Failed to fetch subject roster:", err);
    }
}

function setPeriodFilter(period) {
    currentPeriodFilter = period;
    document.querySelectorAll(".period-filter-tab").forEach(btn => {
        if (btn.getAttribute("data-period") === period) {
            btn.className = "period-filter-tab px-3 py-1.5 rounded-lg font-label-code text-[11px] bg-primary text-on-primary font-bold";
        } else {
            btn.className = "period-filter-tab px-3 py-1.5 rounded-lg font-label-code text-[11px] bg-surface-container border border-outline-variant text-on-surface-variant hover:text-primary";
        }
    });
    applyPeriodColumnVisibility();
}

function applyPeriodColumnVisibility() {
    const showPrelim = currentPeriodFilter === "all" || currentPeriodFilter === "prelim";
    const showMid = currentPeriodFilter === "all" || currentPeriodFilter === "midterm";
    const showFinal = currentPeriodFilter === "all" || currentPeriodFilter === "final";

    document.querySelectorAll(".col-prelim").forEach(el => el.style.display = showPrelim ? "" : "none");
    document.querySelectorAll(".col-midterm").forEach(el => el.style.display = showMid ? "" : "none");
    document.querySelectorAll(".col-final").forEach(el => el.style.display = showFinal ? "" : "none");
}

function updateRosterMetrics() {
    const total = currentRoster.length;
    let completed = 0;
    let gwaSum = 0;
    let gwaCount = 0;

    currentRoster.forEach(item => {
        const res = computeGwaAndRemark(item.prelim, item.midterm, item.final);
        if (res.complete) completed += 1;
        if (res.gwa !== null) {
            gwaSum += res.gwa;
            gwaCount += 1;
        }
    });

    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    document.getElementById("metric-completion").textContent = `${completed} / ${total}`;
    document.getElementById("metric-completion-pct").textContent = `(${pct}%)`;
    document.getElementById("metric-completion-bar").style.width = `${pct}%`;
    document.getElementById("metric-avg-gwa").textContent = gwaCount > 0 ? `${(gwaSum / gwaCount).toFixed(2)}%` : "N/A";
    document.getElementById("roster-count-badge").textContent = `${total} Enrolled Student${total === 1 ? "" : "s"}`;
}

function syncRosterSearch(value) {
    const topSearch = document.getElementById("roster-search-input");
    const tableSearch = document.getElementById("roster-table-search-input");
    if (topSearch && topSearch.value !== value) topSearch.value = value;
    if (tableSearch && tableSearch.value !== value) tableSearch.value = value;

    const clearBtn = document.getElementById("clear-roster-search-btn");
    if (clearBtn) {
        if (String(value || "").trim().length > 0) {
            clearBtn.classList.remove("hidden");
        } else {
            clearBtn.classList.add("hidden");
        }
    }
    renderRosterTable();
}

function clearRosterSearch() {
    syncRosterSearch("");
}

function renderRosterTable() {
    const tbody = document.getElementById("roster-body");
    const rawQuery = (document.getElementById("roster-table-search-input")?.value ?? document.getElementById("roster-search-input")?.value ?? "");
    const searchQ = rawQuery.trim().toLowerCase();
    if (!tbody) return;

    updateRosterMetrics();

    const filtered = currentRoster.filter(item => {
        if (!searchQ) return true;
        return (
            String(item.full_name || "").toLowerCase().includes(searchQ) ||
            String(item.user_id || "").toLowerCase().includes(searchQ) ||
            String(item.application_id || "").toLowerCase().includes(searchQ)
        );
    });

    const countBadge = document.getElementById("roster-count-badge");
    if (countBadge) {
        if (searchQ) {
            countBadge.textContent = `Showing ${filtered.length} of ${currentRoster.length} Student${currentRoster.length === 1 ? "" : "s"}`;
        } else {
            countBadge.textContent = `${currentRoster.length} Enrolled Student${currentRoster.length === 1 ? "" : "s"}`;
        }
    }

    if (filtered.length === 0) {
        const emptyMsg = currentRoster.length === 0
            ? "No APPROVED / enrolled students found for this course yet. Approve an applicant in Admissions & Enrollment first."
            : "No matching enrolled students found.";
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="py-10 text-center font-label-code text-label-code text-on-surface-variant">
                    ${emptyMsg}
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        const calc = computeGwaAndRemark(item.prelim, item.midterm, item.final);
        const pVal = item.prelim !== null && item.prelim !== undefined ? Number(item.prelim).toFixed(2) : "";
        const mVal = item.midterm !== null && item.midterm !== undefined ? Number(item.midterm).toFixed(2) : "";
        const fVal = item.final !== null && item.final !== undefined ? Number(item.final).toFixed(2) : "";
        const gwaText = calc.gwa !== null ? `${calc.gwa.toFixed(2)}%` : "N/A";
        const isFailed = calc.gwa !== null && calc.gwa < 75.0;
        const lockLabel = item.is_locked ? "Locked ✓" : "Unlocked (Draft)";

        return `
            <tr class="hover:bg-surface-container/60 transition-colors" data-app-id="${item.application_id}">
                <td class="py-3.5 px-4 font-label-code text-label-code">
                    <span class="text-primary font-bold block">${item.user_id}</span>
                    <span class="text-[11px] text-on-surface-variant">${item.application_id}</span>
                </td>
                <td class="py-3.5 px-4">
                    <span class="font-body-md font-semibold text-primary block">${item.full_name}</span>
                    <span class="font-label-code text-[11px] text-on-surface-variant">${item.course_id} • ${item.email}</span>
                </td>
                <td class="py-3.5 px-3 text-center col-prelim">
                    <input type="number" step="0.01" min="0" max="100" placeholder="0 - 100"
                        class="grade-input w-20 text-center h-9 rounded font-label-code text-label-code font-bold"
                        value="${pVal}"
                        oninput="onGradeInputChange('${item.application_id}', 'prelim', this.value)">
                </td>
                <td class="py-3.5 px-3 text-center col-midterm">
                    <input type="number" step="0.01" min="0" max="100" placeholder="0 - 100"
                        class="grade-input w-20 text-center h-9 rounded font-label-code text-label-code font-bold"
                        value="${mVal}"
                        oninput="onGradeInputChange('${item.application_id}', 'midterm', this.value)">
                </td>
                <td class="py-3.5 px-3 text-center col-final">
                    <input type="number" step="0.01" min="0" max="100" placeholder="0 - 100"
                        class="grade-input w-20 text-center h-9 rounded font-label-code text-label-code font-bold"
                        value="${fVal}"
                        oninput="onGradeInputChange('${item.application_id}', 'final', this.value)">
                </td>
                <td class="py-3.5 px-4 text-right">
                    <span class="row-gwa font-metric-num text-headline-sm font-bold ${isFailed ? "text-error" : "text-primary"}">${gwaText}</span>
                </td>
                <td class="py-3.5 px-4">
                    <span class="row-remark px-2.5 py-1 rounded bg-surface-container-high border border-outline-variant font-label-code text-[11px] ${isFailed ? "text-error" : "text-primary"}">
                        ${calc.remark}
                    </span>
                </td>
                <td class="py-3.5 px-4 text-center">
                    <button type="button" onclick="toggleRowLock('${item.application_id}')" class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface-container border border-outline-variant font-label-code text-[11px] text-primary hover:bg-surface-container-high">
                        <span class="material-symbols-outlined text-[14px]">${item.is_locked ? "lock" : "lock_open"}</span>
                        <span>${lockLabel}</span>
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    applyPeriodColumnVisibility();
}

function onGradeInputChange(appId, field, rawValue) {
    const entry = currentRoster.find(r => r.application_id === appId);
    if (!entry) return;

    const trimmed = String(rawValue || "").trim();
    if (trimmed === "") {
        entry[field] = null;
    } else {
        const num = parseFloat(trimmed);
        entry[field] = (!isNaN(num) && num >= 0.0 && num <= 100.0) ? num : null;
    }

    const calc = computeGwaAndRemark(entry.prelim, entry.midterm, entry.final);
    const tr = document.querySelector(`tr[data-app-id="${appId}"]`);
    if (tr) {
        const gwaEl = tr.querySelector(".row-gwa");
        const remEl = tr.querySelector(".row-remark");
        const isFailed = calc.gwa !== null && calc.gwa < 75.0;
        if (gwaEl) {
            gwaEl.textContent = calc.gwa !== null ? `${calc.gwa.toFixed(2)}%` : "N/A";
            gwaEl.className = `row-gwa font-metric-num text-headline-sm font-bold ${isFailed ? "text-error" : "text-primary"}`;
        }
        if (remEl) {
            remEl.textContent = calc.remark;
            remEl.className = `row-remark px-2.5 py-1 rounded bg-surface-container-high border border-outline-variant font-label-code text-[11px] ${isFailed ? "text-error" : "text-primary"}`;
        }
    }
    updateRosterMetrics();
}

function toggleRowLock(appId) {
    const entry = currentRoster.find(r => r.application_id === appId);
    if (!entry) return;
    entry.is_locked = !entry.is_locked;
    renderRosterTable();
}

async function saveGradesBatch(lockAll) {
    if (!currentSubjectMeta || !currentSubjectMeta.subject_id) {
        showGradesFeedback("error", "Please select a subject first.");
        return;
    }
    if (currentRoster.length === 0) {
        showGradesFeedback("error", "There are no enrolled students in this subject to save.");
        return;
    }

    // Validate any entered inputs
    for (const row of currentRoster) {
        for (const key of ["prelim", "midterm", "final"]) {
            if (row[key] !== null && (row[key] < 0.0 || row[key] > 100.0)) {
                showGradesFeedback("error", `Invalid ${key} grade for ${row.full_name}. Percentage grades must be between 0 and 100.`);
                return;
            }
        }
    }

    const entriesPayload = currentRoster.map(r => ({
        application_id: r.application_id,
        prelim: r.prelim,
        midterm: r.midterm,
        final: r.final,
        is_locked: lockAll ? true : Boolean(r.is_locked)
    }));

    try {
        const res = await fetch(`${API_BASE}/subjects/${encodeURIComponent(currentSubjectMeta.subject_id)}/grades`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                encoded_by: localStorage.getItem("admin_user_id") || "ADMIN-001",
                lock_all: lockAll,
                entries: entriesPayload
            })
        });

        const data = await res.json();
        if (!res.ok) {
            showGradesFeedback("error", data.detail || "Failed to save grades.");
            return;
        }

        showGradesFeedback("success", data.message);
        showGradesToast(data.message);
        await loadSelectedSubjectRoster();
    } catch (err) {
        console.error(err);
        showGradesFeedback("error", "Network error while saving grades to the database.");
    }
}

window.addEventListener("DOMContentLoaded", initGradeEncodingPage);
