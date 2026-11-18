var API_BASE = window.API_BASE || "http://127.0.0.1:8000";

let publishedPrograms = [];
let isEditingExistingCourse = false;
let currentFacultyTargetRow = null;

const STOP_WORDS = new Set(["of", "in", "and", "the", "for", "with", "to", "on", "at"]);

// No pre-loaded sample instructors; starts empty until the registrar enters instructors.
const FACULTY_POOL = [];

const DEFAULT_TEMPLATES = {
    1: [
        { title: "Introduction to Computing & Systems", category: "Core Major", units: 3, instructor: "", room: "" },
        { title: "Fundamentals of Programming 1", category: "Core Major", units: 3, instructor: "", room: "" },
        { title: "Discrete Mathematics & Logic", category: "Gen Ed Math", units: 3, instructor: "", room: "" },
        { title: "Purposive Communication", category: "General Ed", units: 3, instructor: "", room: "" },
        { title: "Understanding the Self", category: "General Ed", units: 3, instructor: "", room: "" },
        { title: "Mathematics in the Modern World", category: "Gen Ed Math", units: 3, instructor: "", room: "" },
        { title: "Computer Laboratory Workshop 1", category: "Technical Lab", units: 3, instructor: "", room: "" }
    ],
    2: [
        { title: "Intermediate Programming & OOP", category: "Core Major", units: 3, instructor: "", room: "" },
        { title: "Data Structures & Advanced Algorithms", category: "Core Major", units: 3, instructor: "", room: "" },
        { title: "Relational Database Management Systems", category: "Core Major", units: 3, instructor: "", room: "" },
        { title: "Operating Systems & Shell Scripting", category: "Core Major", units: 3, instructor: "", room: "" },
        { title: "Science, Technology, and Society", category: "General Ed", units: 3, instructor: "", room: "" },
        { title: "Information Security Fundamentals", category: "Elective", units: 3, instructor: "", room: "" },
        { title: "Web Development & Cloud Frameworks Lab", category: "Technical Lab", units: 3, instructor: "", room: "" }
    ]
};

function generateRandomHex(len = 6) {
    const chars = "0123456789ABCDEF";
    let out = "";
    for (let i = 0; i < len; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}

function generateSubjectId() {
    return `SUB-${generateRandomHex(8)}`;
}

function showCoursesToast(message) {
    const toast = document.getElementById("toast-notification");
    const toastText = document.getElementById("toast-text");
    if (!toast || !toastText) return;
    toastText.textContent = message;
    toast.classList.remove("opacity-0", "pointer-events-none");
    toast.classList.add("opacity-100");
    setTimeout(() => {
        toast.classList.remove("opacity-100");
        toast.classList.add("opacity-0", "pointer-events-none");
    }, 2800);
}

function deriveCoursePrefix(courseTitle) {
    const words = (courseTitle || "").match(/[A-Za-z]+/g) || [];
    const significant = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
    if (significant.length >= 2) {
        return significant.slice(0, 6).map(w => w[0].toUpperCase()).join("");
    }
    if (significant.length === 1) {
        return significant[0].slice(0, 4).toUpperCase();
    }
    return "CRS";
}

function generateCourseIdFromTitle(courseTitle, forceNewRandom = false) {
    const prefix = deriveCoursePrefix(courseTitle);
    const existingIds = new Set(publishedPrograms.map(p => String(p.course_id || "").toUpperCase()));

    if (!forceNewRandom) {
        for (let idx = 1; idx <= 999; idx++) {
            const candidate = `${prefix}-${String(idx).padStart(3, "0")}`;
            if (!existingIds.has(candidate)) {
                return candidate;
            }
        }
    }
    return `${prefix}-${generateRandomHex(4)}`;
}

function getCoursePrefixFromCodeInput() {
    const codeInput = document.getElementById("input-course-code");
    const raw = (codeInput ? codeInput.value : "CRS").trim().toUpperCase();
    const prefix = raw.split(/[-_]/)[0] || "SUB";
    return prefix.slice(0, 6);
}

function generateSubjectCode(semester, rowIndex) {
    const prefix = getCoursePrefixFromCodeInput();
    const semDigit = Number(semester) === 2 ? 2 : 1;
    return `${prefix}-${semDigit}${String(rowIndex).padStart(2, "0")}`;
}

function updatePackageBadge() {
    const prefix = getCoursePrefixFromCodeInput();
    const sem = document.getElementById("select-semester")?.value || "1";
    const badge = document.getElementById("package-id-badge");
    if (badge) {
        badge.textContent = `PKG-2026-${prefix}-S${sem}`;
    }
    const semBadge = document.getElementById("active-semester-badge");
    if (semBadge) {
        semBadge.textContent = sem === "2" ? "2nd Sem" : "1st Sem";
    }
    const headerTerm = document.getElementById("header-term-pill");
    if (headerTerm) {
        headerTerm.textContent = `AY 2026-2027 • ${sem === "2" ? "2nd Sem" : "1st Sem"}`;
    }
}

function regenerateCourseId(forceRandom = false) {
    const titleInput = document.getElementById("input-course-title");
    const codeInput = document.getElementById("input-course-code");
    if (!codeInput) return;

    isEditingExistingCourse = false;
    const title = titleInput ? titleInput.value : "";
    codeInput.value = generateCourseIdFromTitle(title, forceRandom);
    updateBuilderModeBanner();
    updatePackageBadge();
    syncAutoGeneratedSubjectCodes(false);
}

function updateBuilderModeBanner() {
    const modeLabel = document.getElementById("builder-mode-label");
    const headingTitle = document.getElementById("builder-heading-title");
    const btnPublishText = document.getElementById("btn-publish-text");
    const sem = document.getElementById("select-semester")?.value || "1";
    const semText = sem === "2" ? "2nd Semester" : "1st Semester";
    const code = document.getElementById("input-course-code")?.value || "";

    if (isEditingExistingCourse) {
        if (modeLabel) modeLabel.textContent = `Curriculum Revision Mode • ${code}`;
        if (headingTitle) headingTitle.textContent = `Configure ${semText} Curriculum & Instructors for ${code}`;
        if (btnPublishText) btnPublishText.textContent = `Save & Publish ${semText} (21u)`;
    } else {
        if (modeLabel) modeLabel.textContent = "Staging Environment • Auto-ID Active";
        if (headingTitle) headingTitle.textContent = `Publish New Degree Course Curriculum (${semText})`;
        if (btnPublishText) btnPublishText.textContent = `Publish Academic Program & Lock`;
    }
}

function syncAutoGeneratedSubjectCodes(forceAll = false) {
    const tableBody = document.getElementById("subject-rows-container");
    if (!tableBody) return;
    const sem = document.getElementById("select-semester")?.value || "1";
    const rows = tableBody.querySelectorAll("tr");

    rows.forEach((row, idx) => {
        const isAuto = row.getAttribute("data-auto-code") !== "false";
        const codeInput = row.querySelector(".subject-code-input");
        if (codeInput && (forceAll || isAuto)) {
            codeInput.value = generateSubjectCode(sem, idx + 1);
            row.setAttribute("data-auto-code", "true");
        }
    });
}

function escapeAttr(val) {
    return String(val || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function createSubjectRowElement({
    index,
    subjectId,
    subjectCode,
    subjectName,
    category = "Core Major",
    units = 3,
    instructorName = "N/A",
    room = "N/A",
    isAutoCode = true
}) {
    const sem = document.getElementById("select-semester")?.value || "1";
    const finalSubjectId = subjectId || generateSubjectId();
    const finalCode = subjectCode || generateSubjectCode(sem, index);
    const isLab = category === "Technical Lab";
    const lecUnits = isLab ? 0 : units;
    const labUnits = isLab ? units : 0;

    const tr = document.createElement("tr");
    tr.className = "hover:bg-surface-container/60 transition-colors group";
    tr.setAttribute("data-subject-id", finalSubjectId);
    tr.setAttribute("data-units", String(units));
    tr.setAttribute("data-lec", String(lecUnits));
    tr.setAttribute("data-lab", String(labUnits));
    tr.setAttribute("data-auto-code", isAutoCode ? "true" : "false");

    tr.innerHTML = `
        <td class="py-3 px-4 font-label-code text-label-code">
            <div class="flex flex-col">
                <span class="row-num text-primary font-bold">${String(index).padStart(2, "0")}</span>
                <span class="row-subject-id text-[10px] text-on-surface-variant" title="Self-Generated Subject ID">${finalSubjectId}</span>
            </div>
        </td>
        <td class="py-3 px-4">
            <div class="flex items-center gap-1">
                <input type="text"
                    class="subject-code-input w-28 font-label-code text-label-code font-bold px-2.5 py-1.5 rounded uppercase"
                    value="${escapeAttr(finalCode)}"
                    title="Auto-generated Subject Code (Editable)">
                <button type="button" class="btn-regen-code text-on-surface-variant hover:text-primary p-1 rounded transition-colors" title="Regenerate Subject Code">
                    <span class="material-symbols-outlined text-[15px]">autorenew</span>
                </button>
            </div>
        </td>
        <td class="py-3 px-4">
            <input type="text"
                class="subject-name-input w-full font-body-sm text-body-sm font-medium px-2.5 py-1.5 rounded"
                value="${escapeAttr(subjectName || "Curricular Subject Module")}"
                placeholder="Enter subject title...">
        </td>
        <td class="py-3 px-4">
            <select class="subject-category-select w-full font-label-code text-[11px] px-2 py-1.5 rounded cursor-pointer">
                <option value="Core Major" ${category === "Core Major" ? "selected" : ""}>Core Major</option>
                <option value="General Ed" ${category === "General Ed" ? "selected" : ""}>General Ed</option>
                <option value="Gen Ed Math" ${category === "Gen Ed Math" ? "selected" : ""}>Gen Ed Math</option>
                <option value="Elective" ${category === "Elective" ? "selected" : ""}>Elective</option>
                <option value="Technical Lab" ${category === "Technical Lab" ? "selected" : ""}>Technical Lab</option>
            </select>
        </td>
        <td class="py-3 px-4 text-center">
            <div class="inline-flex items-center bg-surface-container rounded-lg p-1 gap-1 border border-outline-variant">
                <button class="unit-dec w-6 h-6 flex items-center justify-center rounded bg-surface-container-high hover:bg-surface-bright text-primary transition-colors" type="button" title="Decrease units">
                    <span class="material-symbols-outlined text-[15px]">remove</span>
                </button>
                <span class="unit-val w-8 text-center font-metric-num text-label-code font-bold text-primary">${units}</span>
                <button class="unit-inc w-6 h-6 flex items-center justify-center rounded bg-surface-container-high hover:bg-surface-bright text-primary transition-colors" type="button" title="Increase units">
                    <span class="material-symbols-outlined text-[15px]">add</span>
                </button>
            </div>
        </td>
        <td class="py-3 px-4">
            <div class="flex items-center gap-1.5">
                <input type="text"
                    class="subject-instructor-input w-full px-2.5 py-1.5 rounded font-body-sm text-body-sm"
                    value="${escapeAttr(instructorName === "N/A" ? "" : instructorName)}"
                    placeholder="Instructor name (default: N/A)">
                <button type="button" class="btn-pick-faculty px-2 py-1.5 rounded bg-surface-container-high hover:bg-surface-bright text-primary border border-outline-variant shrink-0 flex items-center" title="Open Faculty Selector Modal">
                    <span class="material-symbols-outlined text-[16px]">person_search</span>
                </button>
            </div>
        </td>
        <td class="py-3 px-4">
            <input type="text"
                class="subject-room-input w-28 px-2.5 py-1.5 rounded font-label-code text-label-code"
                value="${escapeAttr(room === "N/A" ? "" : room)}"
                placeholder="Room (N/A)">
        </td>
        <td class="py-3 px-4 text-right">
            <button class="btn-delete-subject text-on-surface-variant hover:text-error p-1.5 rounded transition-colors" title="Delete subject" type="button">
                <span class="material-symbols-outlined text-[18px]">delete</span>
            </button>
        </td>
    `;

    attachRowEvents(tr);
    return tr;
}

function updateRowHoursDisplay(row) {
    const units = parseInt(row.getAttribute("data-units")) || 0;
    const categorySelect = row.querySelector(".subject-category-select");
    const isLab = categorySelect && categorySelect.value === "Technical Lab";

    row.setAttribute("data-lec", String(isLab ? 0 : units));
    row.setAttribute("data-lab", String(isLab ? units : 0));

    const valSpan = row.querySelector(".unit-val");
    if (valSpan) valSpan.textContent = String(units);
}

function attachRowEvents(row) {
    const btnDec = row.querySelector(".unit-dec");
    const btnInc = row.querySelector(".unit-inc");
    const deleteBtn = row.querySelector(".btn-delete-subject");
    const codeInput = row.querySelector(".subject-code-input");
    const regenCodeBtn = row.querySelector(".btn-regen-code");
    const categorySelect = row.querySelector(".subject-category-select");
    const pickFacultyBtn = row.querySelector(".btn-pick-faculty");
    const instructorInput = row.querySelector(".subject-instructor-input");

    if (codeInput) {
        codeInput.addEventListener("input", () => {
            row.setAttribute("data-auto-code", "false");
        });
    }

    if (regenCodeBtn) {
        regenCodeBtn.addEventListener("click", () => {
            const tableBody = document.getElementById("subject-rows-container");
            const rows = Array.from(tableBody.querySelectorAll("tr"));
            const idx = rows.indexOf(row) + 1;
            const sem = document.getElementById("select-semester")?.value || "1";
            if (codeInput) {
                codeInput.value = generateSubjectCode(sem, idx);
                row.setAttribute("data-auto-code", "true");
            }
        });
    }

    if (categorySelect) {
        categorySelect.addEventListener("change", () => {
            updateRowHoursDisplay(row);
            calculateTally();
        });
    }

    if (pickFacultyBtn) {
        pickFacultyBtn.addEventListener("click", () => {
            openFacultyModal(row);
        });
    }

    if (instructorInput) {
        instructorInput.addEventListener("input", () => {
            calculateTally();
        });
    }

    if (btnDec) {
        btnDec.addEventListener("click", () => {
            let curr = parseInt(row.getAttribute("data-units")) || 0;
            if (curr > 1) {
                curr -= 1;
                row.setAttribute("data-units", String(curr));
                updateRowHoursDisplay(row);
                calculateTally();
            }
        });
    }

    if (btnInc) {
        btnInc.addEventListener("click", () => {
            let curr = parseInt(row.getAttribute("data-units")) || 0;
            if (curr < 9) {
                curr += 1;
                row.setAttribute("data-units", String(curr));
                updateRowHoursDisplay(row);
                calculateTally();
            }
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
            const tableBody = document.getElementById("subject-rows-container");
            if (tableBody && tableBody.querySelectorAll("tr").length > 1) {
                row.remove();
                renumberRows();
                calculateTally();
            }
        });
    }
}

function renumberRows() {
    const tableBody = document.getElementById("subject-rows-container");
    if (!tableBody) return;
    const sem = document.getElementById("select-semester")?.value || "1";
    const rows = tableBody.querySelectorAll("tr");

    rows.forEach((r, idx) => {
        const numCell = r.querySelector(".row-num");
        if (numCell) {
            numCell.textContent = String(idx + 1).padStart(2, "0");
        }
        if (r.getAttribute("data-auto-code") !== "false") {
            const codeInput = r.querySelector(".subject-code-input");
            if (codeInput) {
                codeInput.value = generateSubjectCode(sem, idx + 1);
            }
        }
    });
}

function calculateTally() {
    const tableBody = document.getElementById("subject-rows-container");
    if (!tableBody) return;

    const totalDisplay = document.getElementById("counter-total");
    const tallyUnitsDisplay = document.getElementById("tally-units");
    const tallySubjectsDisplay = document.getElementById("tally-subjects");
    const tallyRemainingDisplay = document.getElementById("tally-remaining");
    const tallyStatusText = document.getElementById("tally-status-text");
    const badge = document.getElementById("load-status-badge");
    const barLecture = document.getElementById("bar-lecture");
    const barLab = document.getElementById("bar-lab");
    const valLecture = document.getElementById("val-lecture");
    const valLab = document.getElementById("val-lab");
    const valDelta = document.getElementById("val-delta");
    const btnPublish = document.getElementById("btn-publish-program");
    const facultyRatioEl = document.getElementById("faculty-ratio-display");
    const facultyPctEl = document.getElementById("faculty-percent-display");

    const rows = tableBody.querySelectorAll("tr");
    let totalUnits = 0;
    let totalLec = 0;
    let totalLab = 0;
    let staffedCount = 0;
    const count = rows.length;

    rows.forEach(row => {
        const u = parseFloat(row.getAttribute("data-units")) || 0;
        const lec = parseFloat(row.getAttribute("data-lec")) || 0;
        const lab = parseFloat(row.getAttribute("data-lab")) || 0;
        totalUnits += u;
        totalLec += lec;
        totalLab += lab;

        const instr = (row.querySelector(".subject-instructor-input")?.value || "").trim();
        if (instr && instr.toUpperCase() !== "N/A") {
            staffedCount += 1;
        }
    });

    if (totalDisplay) totalDisplay.textContent = totalUnits.toFixed(1);
    if (tallyUnitsDisplay) tallyUnitsDisplay.textContent = `${totalUnits.toFixed(1)} Academic Units`;
    if (tallySubjectsDisplay) tallySubjectsDisplay.textContent = String(count);

    if (facultyRatioEl) facultyRatioEl.textContent = `${staffedCount} / ${count}`;
    if (facultyPctEl) facultyPctEl.textContent = `${count > 0 ? Math.round((staffedCount / count) * 100) : 0}%`;

    const delta = 21.0 - totalUnits;
    if (valDelta) {
        valDelta.textContent = `${delta >= 0 ? delta.toFixed(1) : Math.abs(delta).toFixed(1)} Units ${
            delta > 0 ? "Remaining" : delta < 0 ? "Over Limit" : "Balanced"
        }`;
    }
    if (tallyRemainingDisplay) {
        tallyRemainingDisplay.textContent = `${delta >= 0 ? delta.toFixed(1) : "0.0"}`;
    }
    if (valLecture) valLecture.textContent = totalLec.toFixed(1);
    if (valLab) valLab.textContent = totalLab.toFixed(1);

    const maxCap = Math.max(21.0, totalUnits);
    const lecPercent = maxCap > 0 ? (totalLec / maxCap) * 100 : 0;
    const labPercent = maxCap > 0 ? (totalLab / maxCap) * 100 : 0;
    if (barLecture) barLecture.style.width = `${Math.min(100, lecPercent)}%`;
    if (barLab) barLab.style.width = `${Math.min(100, labPercent)}%`;

    if (totalUnits === 21.0) {
        if (badge) badge.textContent = "VALIDATED • READY TO PUBLISH";
        if (tallyStatusText) {
            tallyStatusText.innerHTML = '<span class="material-symbols-outlined text-[18px]">task_alt</span><span>Unit requirement strictly met: Exactly 21.0 units allocated.</span>';
        }
        if (btnPublish) {
            btnPublish.disabled = false;
            btnPublish.classList.remove("opacity-40", "cursor-not-allowed");
        }
    } else if (totalUnits > 21.0) {
        if (badge) badge.textContent = "EXCEEDS MAXIMUM 21 UNITS";
        if (tallyStatusText) {
            tallyStatusText.innerHTML = '<span class="material-symbols-outlined text-[18px] text-error">error</span><span class="text-error">Overload error: Curriculum cannot exceed 21 units.</span>';
        }
        if (btnPublish) {
            btnPublish.disabled = true;
            btnPublish.classList.add("opacity-40", "cursor-not-allowed");
        }
    } else {
        if (badge) badge.textContent = `DEFICIT: ${(21.0 - totalUnits).toFixed(1)} UNITS NEEDED`;
        if (tallyStatusText) {
            tallyStatusText.innerHTML = '<span class="material-symbols-outlined text-[18px]">warning</span><span>Short of load limit: Need exactly 21 units to publish.</span>';
        }
        if (btnPublish) {
            btnPublish.disabled = true;
            btnPublish.classList.add("opacity-40", "cursor-not-allowed");
        }
    }
}

/* =====================================================
   FACULTY ASSIGNMENT MODAL
   ===================================================== */
function getSavedInstructorsList() {
    const seen = new Map();
    FACULTY_POOL.forEach(f => {
        const key = (f.name || "").trim().toLowerCase();
        if (key && key !== "n/a" && !seen.has(key)) {
            seen.set(key, f);
        }
    });
    if (Array.isArray(publishedPrograms)) {
        publishedPrograms.forEach(prog => {
            (prog.subjects || []).forEach(sub => {
                const name = (sub.instructor_name || "").trim();
                if (!name || name.toUpperCase() === "N/A") return;
                const key = name.toLowerCase();
                if (!seen.has(key)) {
                    const words = name.split(/\s+/).filter(Boolean);
                    const initials = words.slice(0, 2).map(w => w[0].toUpperCase()).join("") || "IN";
                    const room = (sub.room || "").trim();
                    const courseCode = prog.course_id || prog.code || "";
                    const subjCode = sub.subject_code || sub.code || "Subject";
                    seen.set(key, {
                        name,
                        dept: courseCode ? `${courseCode} • ${subjCode}` : "Assigned Faculty",
                        defaultRoom: room && room.toUpperCase() !== "N/A" ? room : "N/A",
                        initials
                    });
                }
            });
        });
    }
    return Array.from(seen.values());
}

function renderFacultyPresetList() {
    const list = document.getElementById("faculty-preset-list");
    if (!list) return;
    const instructors = getSavedInstructorsList();
    if (instructors.length === 0) {
        list.innerHTML = `
            <div class="p-space-md rounded-lg bg-surface-container-lowest border border-dashed border-outline-variant text-center">
                <span class="font-body-sm text-body-sm text-on-surface-variant block">No instructors in the directory yet.</span>
                <span class="font-label-code text-[11px] text-on-surface-variant">Type an instructor name above and click Assign, or leave blank for N/A.</span>
            </div>
        `;
        return;
    }
    list.innerHTML = instructors.map(f => {
        const escapedName = f.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const escapedRoom = f.defaultRoom.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        return `
            <div onclick="selectFacultyPreset('${escapedName}', '${escapedRoom}')" class="p-space-sm rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant cursor-pointer flex items-center justify-between transition-colors">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-full bg-surface-container-highest border border-outline-variant flex items-center justify-center font-label-code font-bold text-primary">${f.initials}</div>
                    <div>
                        <div class="font-body-sm text-body-sm font-semibold text-primary">${f.name}</div>
                        <div class="font-label-code text-[11px] text-on-surface-variant">${f.dept}</div>
                    </div>
                </div>
                <span class="font-label-code text-[11px] px-2 py-0.5 rounded bg-surface-container-lowest text-primary border border-outline-variant">${f.defaultRoom}</span>
            </div>
        `;
    }).join("");
}

function openFacultyModal(row) {
    currentFacultyTargetRow = row;
    const modal = document.getElementById("faculty-modal");
    const indicator = document.getElementById("modal-subject-indicator");
    const customInstrInput = document.getElementById("modal-custom-instructor");
    const customRoomInput = document.getElementById("modal-custom-room");

    const code = row.querySelector(".subject-code-input")?.value || "";
    const title = row.querySelector(".subject-name-input")?.value || "";
    const currInstr = row.querySelector(".subject-instructor-input")?.value || "";
    const currRoom = row.querySelector(".subject-room-input")?.value || "";

    if (indicator) indicator.textContent = `${code} — ${title}`;
    if (customInstrInput) customInstrInput.value = currInstr;
    if (customRoomInput) customRoomInput.value = currRoom;

    renderFacultyPresetList();
    if (modal) modal.classList.remove("hidden");
}

function closeFacultyModal() {
    const modal = document.getElementById("faculty-modal");
    if (modal) modal.classList.add("hidden");
    currentFacultyTargetRow = null;
}

function selectFacultyPreset(name, room) {
    if (!currentFacultyTargetRow) return;
    const instrInput = currentFacultyTargetRow.querySelector(".subject-instructor-input");
    const roomInput = currentFacultyTargetRow.querySelector(".subject-room-input");
    if (instrInput) instrInput.value = name;
    if (roomInput && (!roomInput.value.trim() || roomInput.value === "N/A")) {
        roomInput.value = room;
    }
    const code = currentFacultyTargetRow.querySelector(".subject-code-input")?.value || "Subject";
    closeFacultyModal();
    calculateTally();
    showCoursesToast(`Assigned ${name} to ${code}`);
}

function applyCustomFaculty() {
    if (!currentFacultyTargetRow) return;
    const name = (document.getElementById("modal-custom-instructor")?.value || "").trim();
    const room = (document.getElementById("modal-custom-room")?.value || "").trim();
    const instrInput = currentFacultyTargetRow.querySelector(".subject-instructor-input");
    const roomInput = currentFacultyTargetRow.querySelector(".subject-room-input");

    if (instrInput) instrInput.value = name;
    if (roomInput && room) roomInput.value = room;

    const code = currentFacultyTargetRow.querySelector(".subject-code-input")?.value || "Subject";
    closeFacultyModal();
    calculateTally();
    showCoursesToast(`Updated instructor for ${code}`);
}

function autoAssignSampleInstructors() {
    showCoursesToast("Instructor directory is empty. Assign instructors manually or leave blank for N/A.");
}

function loadDefaultTemplateForSemester(sem) {
    const tableBody = document.getElementById("subject-rows-container");
    if (!tableBody) return;
    tableBody.innerHTML = "";

    const template = DEFAULT_TEMPLATES[Number(sem) === 2 ? 2 : 1];
    template.forEach((item, idx) => {
        const row = createSubjectRowElement({
            index: idx + 1,
            subjectId: generateSubjectId(),
            subjectCode: generateSubjectCode(sem, idx + 1),
            subjectName: item.title,
            category: item.category,
            units: item.units,
            instructorName: item.instructor,
            room: item.room,
            isAutoCode: true
        });
        tableBody.appendChild(row);
    });
    calculateTally();
}

function handleSemesterChange() {
    const sem = Number(document.getElementById("select-semester")?.value || 1);
    const currentCode = (document.getElementById("input-course-code")?.value || "").trim().toUpperCase();

    const existingProg = publishedPrograms.find(p => String(p.course_id).toUpperCase() === currentCode);
    if (existingProg && Array.isArray(existingProg.subjects)) {
        const semSubjects = existingProg.subjects.filter(s => Number(s.semester) === sem);
        if (semSubjects.length > 0) {
            isEditingExistingCourse = true;
            updatePackageBadge();
            updateBuilderModeBanner();
            populateBuilderRowsFromSubjects(semSubjects);
            return;
        }
        // Switching to a different semester must self-generate a distinct Course ID
        isEditingExistingCourse = false;
        const titleInput = document.getElementById("input-course-title");
        const codeInput = document.getElementById("input-course-code");
        if (codeInput) {
            codeInput.value = generateCourseIdFromTitle(titleInput ? titleInput.value : "", false);
            showCoursesToast(`Self-generated new Course ID ${codeInput.value} for ${sem === 2 ? "2nd" : "1st"} Semester.`);
        }
    }

    updatePackageBadge();
    updateBuilderModeBanner();
    loadDefaultTemplateForSemester(sem);
}

function populateBuilderRowsFromSubjects(subjectsList) {
    const tableBody = document.getElementById("subject-rows-container");
    if (!tableBody) return;
    tableBody.innerHTML = "";

    subjectsList.forEach((s, idx) => {
        const isLab = /lab/i.test(s.subject_name) || /lab/i.test(s.subject_code);
        const row = createSubjectRowElement({
            index: idx + 1,
            subjectId: s.subject_id || generateSubjectId(),
            subjectCode: s.subject_code,
            subjectName: s.subject_name,
            category: isLab ? "Technical Lab" : "Core Major",
            units: Number(s.units) || 3,
            instructorName: s.instructor_name || "N/A",
            room: s.room || "N/A",
            isAutoCode: false
        });
        tableBody.appendChild(row);
    });
    calculateTally();
}

function startNewCourseDraft() {
    isEditingExistingCourse = false;
    const titleInput = document.getElementById("input-course-title");
    const semSelect = document.getElementById("select-semester");
    if (titleInput) titleInput.value = "Bachelor of Science in Information Systems";
    if (semSelect) semSelect.value = "1";
    regenerateCourseId(false);
    loadDefaultTemplateForSemester(1);
    hidePublishFeedback();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function showPublishFeedback(type, message) {
    const box = document.getElementById("publish-feedback");
    if (!box) return;
    box.classList.remove("hidden");
    if (type === "success") {
        box.className = "mt-space-sm p-3 rounded-lg bg-surface-container border border-outline-variant text-primary font-label-code text-label-code flex items-center justify-between gap-2";
        box.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-[20px]">verified</span>
                <span>${message}</span>
            </div>
            <button type="button" onclick="hidePublishFeedback()" class="text-on-surface-variant hover:text-primary">
                <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
        `;
    } else {
        box.className = "mt-space-sm p-3 rounded-lg bg-error-container/25 border border-error text-error font-label-code text-label-code flex items-center justify-between gap-2";
        box.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-[20px]">error</span>
                <span>${message}</span>
            </div>
            <button type="button" onclick="hidePublishFeedback()" class="text-on-surface-variant hover:text-primary">
                <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
        `;
    }
}

function hidePublishFeedback() {
    const box = document.getElementById("publish-feedback");
    if (box) box.classList.add("hidden");
}

async function publishCurrentCurriculum() {
    const courseIdInput = document.getElementById("input-course-code");
    const courseTitleInput = document.getElementById("input-course-title");
    const semSelect = document.getElementById("select-semester");
    const tableBody = document.getElementById("subject-rows-container");

    const courseTitle = (courseTitleInput?.value || "").trim();
    if (!courseTitle) {
        showPublishFeedback("error", "Please enter a Course / Degree Program Title before publishing.");
        return;
    }

    const semester = Number(semSelect?.value || 1);
    let courseId = (courseIdInput?.value || "").trim().toUpperCase();
    const existingProg = publishedPrograms.find(p => String(p.course_id).toUpperCase() === courseId);
    if (!courseId || (!isEditingExistingCourse && existingProg)) {
        courseId = generateCourseIdFromTitle(courseTitle, false);
        if (courseIdInput) courseIdInput.value = courseId;
    } else if (existingProg && Array.isArray(existingProg.subjects)) {
        const hasOtherSemester = existingProg.subjects.some(s => Number(s.semester) !== semester);
        if (hasOtherSemester) {
            isEditingExistingCourse = false;
            courseId = generateCourseIdFromTitle(courseTitle, false);
            if (courseIdInput) courseIdInput.value = courseId;
        }
    }
    const rows = Array.from(tableBody.querySelectorAll("tr"));

    const subjectsPayload = [];
    let totalUnits = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const subjId = row.getAttribute("data-subject-id") || generateSubjectId();
        const codeVal = (row.querySelector(".subject-code-input")?.value || "").trim().toUpperCase() || generateSubjectCode(semester, i + 1);
        const nameVal = (row.querySelector(".subject-name-input")?.value || "").trim();
        const instrVal = (row.querySelector(".subject-instructor-input")?.value || "").trim() || "N/A";
        const roomVal = (row.querySelector(".subject-room-input")?.value || "").trim() || "N/A";
        const unitsVal = parseInt(row.getAttribute("data-units")) || 0;

        if (!nameVal) {
            showPublishFeedback("error", `Row #${i + 1} is missing a Descriptive Subject Title.`);
            return;
        }

        totalUnits += unitsVal;
        subjectsPayload.push({
            subject_id: subjId,
            subject_code: codeVal,
            subject_name: nameVal,
            units: unitsVal,
            semester: semester,
            instructor_name: instrVal,
            room: roomVal
        });
    }

    if (totalUnits !== 21) {
        showPublishFeedback("error", `Mandatory 21-Unit Load Rule: Total units must be exactly 21.0 units (currently ${totalUnits.toFixed(1)} units).`);
        return;
    }

    const btnPublish = document.getElementById("btn-publish-program");
    if (btnPublish) btnPublish.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/programs/publish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                course_id: courseId,
                course_name: courseTitle,
                academic_year: "2026-2027",
                semester: semester,
                is_active: true,
                subjects: subjectsPayload
            })
        });

        const data = await response.json();
        if (!response.ok) {
            showPublishFeedback("error", data.detail || "Failed to publish course curriculum.");
            if (btnPublish) btnPublish.disabled = false;
            return;
        }

        isEditingExistingCourse = true;
        if (courseIdInput) courseIdInput.value = data.course_id;
        updateBuilderModeBanner();
        showPublishFeedback(
            "success",
            `Published ${data.course_id} (${data.course_name}) — ${semester === 2 ? "2nd Semester" : "1st Semester"} curriculum & instructor roster saved (21.0 units).`
        );
        showCoursesToast(`Published ${data.course_id} with 21.0 units and instructors.`);

        await loadPublishedCourses();
    } catch (err) {
        console.error(err);
        showPublishFeedback("error", "Network error while communicating with the backend server.");
    } finally {
        calculateTally();
    }
}

async function loadPublishedCourses() {
    try {
        const response = await fetch(`${API_BASE}/programs/all`);
        if (!response.ok) return;
        publishedPrograms = await response.json();
        renderPublishedCoursesTable();
    } catch (err) {
        console.error("Error loading programs:", err);
    }
}

function renderSemesterComplianceBadge(subjects, semNumber) {
    const semSubjects = (subjects || []).filter(s => Number(s.semester) === semNumber);
    const totalUnits = semSubjects.reduce((acc, s) => acc + (Number(s.units) || 0), 0);

    if (semSubjects.length === 0) {
        return `
            <div class="flex flex-col">
                <span class="font-label-code text-label-code text-on-surface-variant">Not Configured</span>
                <span class="text-[11px] text-outline font-label-code">0 Subjects</span>
            </div>
        `;
    }

    const staffed = semSubjects.filter(s => s.instructor_name && s.instructor_name !== "N/A").length;
    return `
        <div class="flex flex-col gap-0.5">
            <span class="px-2.5 py-0.5 rounded-full bg-surface-container-high border border-outline-variant text-primary font-label-code text-[11px] font-bold w-max">
                ${totalUnits.toFixed(1)} Units • ${staffed}/${semSubjects.length} Staffed
            </span>
        </div>
    `;
}

function renderPublishedCoursesTable() {
    const tbody = document.getElementById("published-courses-tbody");
    const countLabel = document.getElementById("catalog-count-label");
    const searchVal = (document.getElementById("course-search-input")?.value || "").trim().toLowerCase();

    if (!tbody) return;

    const filtered = publishedPrograms.filter(p => {
        if (!searchVal) return true;
        return (
            String(p.course_id || "").toLowerCase().includes(searchVal) ||
            String(p.course_name || "").toLowerCase().includes(searchVal)
        );
    });

    if (countLabel) {
        countLabel.textContent = `Showing ${filtered.length} of ${publishedPrograms.length} Institutional Programs`;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-8 text-center font-label-code text-label-code text-on-surface-variant">
                    No published courses found. Publish a 21-unit curriculum above to get started.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(prog => {
        const subjects = prog.subjects || [];
        const hasSem1 = subjects.some(s => Number(s.semester) === 1);
        const hasSem2 = subjects.some(s => Number(s.semester) === 2);
        const sem1Badge = renderSemesterComplianceBadge(subjects, 1);
        const sem2Badge = renderSemesterComplianceBadge(subjects, 2);
        const escapedId = String(prog.course_id).replace(/'/g, "\\'");
        const isActive = prog.is_active !== false;

        const statusBadge = isActive
            ? `<span class="bg-surface-container-high border border-outline-variant text-primary font-label-code text-[11px] px-2.5 py-1 rounded-full">Active &amp; Open</span>`
            : `<span class="bg-surface-container border border-outline-variant text-on-surface-variant font-label-code text-[11px] px-2.5 py-1 rounded-full">Inactive • Closed</span>`;

        const editButtons = [];
        if (hasSem1 || !hasSem2) {
            editButtons.push(`<button onclick="editCourseSemester('${escapedId}', 1)" class="text-on-surface-variant hover:text-primary" type="button">Edit 1st Sem</button>`);
        }
        if (hasSem2) {
            editButtons.push(`<button onclick="editCourseSemester('${escapedId}', 2)" class="text-on-surface-variant hover:text-primary" type="button">Edit 2nd Sem</button>`);
        }

        return `
            <tr class="hover:bg-surface-container/60 transition-colors ${isActive ? "" : "opacity-75"}">
                <td class="py-4 px-4">
                    <span class="font-label-code text-label-code text-primary bg-surface-container px-2.5 py-1 rounded border border-outline-variant font-bold">${prog.course_id}</span>
                </td>
                <td class="py-4 px-4">
                    <div class="font-headline-sm text-body-md font-bold text-primary">${prog.course_name}</div>
                    <div class="font-body-sm text-body-sm text-on-surface-variant">Academic Year ${prog.academic_year}</div>
                </td>
                <td class="py-4 px-4">${sem1Badge}</td>
                <td class="py-4 px-4">${sem2Badge}</td>
                <td class="py-4 px-4">${statusBadge}</td>
                <td class="py-4 px-4 text-right">
                    <div class="flex flex-wrap items-center justify-end gap-2 font-label-code text-label-code">
                        <button onclick="inspectCourseCurriculum('${escapedId}')" class="text-primary hover:underline" type="button">Inspect</button>
                        <span class="text-outline-variant">•</span>
                        ${editButtons.join('<span class="text-outline-variant">•</span>')}
                        <span class="text-outline-variant">•</span>
                        <button onclick="toggleCourseActiveStatus('${escapedId}')" class="text-on-surface-variant hover:text-primary" type="button">${isActive ? "Deactivate" : "Activate"}</button>
                        <span class="text-outline-variant">•</span>
                        <button onclick="deletePublishedCourse('${escapedId}')" class="text-error hover:underline inline-flex items-center gap-0.5" type="button">
                            <span class="material-symbols-outlined text-[15px]">delete</span>Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

async function toggleCourseActiveStatus(courseId) {
    try {
        const response = await fetch(`${API_BASE}/programs/${encodeURIComponent(courseId)}/toggle-active`, {
            method: "PATCH"
        });
        const data = await response.json();
        if (!response.ok) {
            showPublishFeedback("error", data.detail || `Failed to update status for '${courseId}'.`);
            return;
        }
        await loadPublishedCourses();
        const stateLabel = data.is_active ? "ACTIVE" : "INACTIVE";
        showPublishFeedback("success", `Course '${data.course_id}' set to ${stateLabel}.`);
    } catch (err) {
        console.error(err);
    }
}

async function deletePublishedCourse(courseId) {
    const prog = publishedPrograms.find(p => p.course_id === courseId);
    const subjCount = prog && Array.isArray(prog.subjects) ? prog.subjects.length : 0;
    const courseLabel = prog ? `${prog.course_id} (${prog.course_name})` : courseId;

    const confirmed = window.confirm(
        `Are you sure you want to permanently delete ${courseLabel} and all ${subjCount} associated subject(s) from the database?`
    );
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_BASE}/programs/${encodeURIComponent(courseId)}`, {
            method: "DELETE"
        });
        const data = await response.json();
        if (!response.ok) {
            const msg = data.detail || `Failed to delete course '${courseId}'.`;
            showPublishFeedback("error", msg);
            window.alert(msg);
            return;
        }

        const panel = document.getElementById("course-inspector-panel");
        if (panel) panel.classList.add("hidden");

        const currentCode = (document.getElementById("input-course-code")?.value || "").trim().toUpperCase();
        await loadPublishedCourses();

        if (isEditingExistingCourse && currentCode === String(courseId).toUpperCase()) {
            isEditingExistingCourse = false;
            regenerateCourseId(false);
        }

        showPublishFeedback("success", data.message || `Course '${courseId}' deleted.`);
    } catch (err) {
        console.error(err);
    }
}

function editCourseSemester(courseId, semester) {
    const prog = publishedPrograms.find(p => p.course_id === courseId);
    if (!prog) return;

    isEditingExistingCourse = true;
    const codeInput = document.getElementById("input-course-code");
    const titleInput = document.getElementById("input-course-title");
    const semSelect = document.getElementById("select-semester");

    if (codeInput) codeInput.value = prog.course_id;
    if (titleInput) titleInput.value = prog.course_name;
    if (semSelect) semSelect.value = String(semester);

    updatePackageBadge();
    updateBuilderModeBanner();

    const semSubjects = (prog.subjects || []).filter(s => Number(s.semester) === Number(semester));
    if (semSubjects.length > 0) {
        populateBuilderRowsFromSubjects(semSubjects);
    } else {
        loadDefaultTemplateForSemester(semester);
    }

    showPublishFeedback(
        "success",
        `Loaded ${prog.course_id} (${prog.course_name}) — ${semester === 2 ? "2nd Semester" : "1st Semester"} into the builder.`
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function inspectCourseCurriculum(courseId) {
    const prog = publishedPrograms.find(p => p.course_id === courseId);
    const panel = document.getElementById("course-inspector-panel");
    if (!prog || !panel) return;

    const sem1 = (prog.subjects || []).filter(s => Number(s.semester) === 1);
    const sem2 = (prog.subjects || []).filter(s => Number(s.semester) === 2);

    const renderSemList = (list, semLabel) => {
        const units = list.reduce((acc, s) => acc + (Number(s.units) || 0), 0);
        if (list.length === 0) {
            return `
                <div class="bg-surface-container rounded-xl p-space-md border border-outline-variant">
                    <div class="flex items-center justify-between border-b border-outline-variant pb-2 mb-2">
                        <span class="font-headline-sm text-primary font-bold">${semLabel}</span>
                        <span class="font-label-code text-label-code text-on-surface-variant">0.0 Units</span>
                    </div>
                    <p class="font-body-sm text-body-sm text-on-surface-variant py-3">No subjects configured yet.</p>
                </div>
            `;
        }
        return `
            <div class="bg-surface-container rounded-xl p-space-md border border-outline-variant space-y-2">
                <div class="flex items-center justify-between border-b border-outline-variant pb-2">
                    <span class="font-headline-sm text-primary font-bold">${semLabel}</span>
                    <span class="font-label-code text-label-code text-primary font-bold">${units.toFixed(1)} Units (${list.length} Subjects)</span>
                </div>
                <div class="divide-y divide-surface-container-high">
                    ${list.map(s => {
                        const currInstr = (s.instructor_name && s.instructor_name !== "N/A") ? s.instructor_name : "";
                        const currRoom = (s.room && s.room !== "N/A") ? s.room : "";
                        const escapedCourse = String(prog.course_id).replace(/'/g, "\\'");
                        return `
                        <div class="py-3 flex flex-col gap-2">
                            <div class="flex items-center justify-between gap-2">
                                <div class="flex items-center gap-2">
                                    <span class="font-label-code text-label-code text-primary font-bold">${s.subject_code}</span>
                                    <span class="font-body-sm text-body-sm text-on-surface font-medium">${s.subject_name}</span>
                                </div>
                                <span class="font-label-code text-[11px] text-primary bg-surface-container-high px-2 py-0.5 rounded border border-outline-variant shrink-0">${s.units}u</span>
                            </div>
                            <div class="flex flex-wrap sm:flex-nowrap items-center gap-2">
                                <input type="text" id="inspect-instr-${s.subject_id}" value="${escapeAttr(currInstr)}" placeholder="Instructor name (default: N/A)" class="flex-1 min-w-[180px] px-2.5 py-1.5 rounded font-body-sm text-body-sm">
                                <input type="text" id="inspect-room-${s.subject_id}" value="${escapeAttr(currRoom)}" placeholder="Room (N/A)" class="w-28 px-2.5 py-1.5 rounded font-label-code text-label-code">
                                <button type="button" onclick="saveInspectedSubjectInstructor('${s.subject_id}', '${escapedCourse}')" class="px-3 py-1.5 rounded bg-primary text-on-primary font-label-code text-[11px] font-bold shrink-0">Save</button>
                            </div>
                            <span class="font-label-code text-[10px] text-on-surface-variant">
                                Saved in DB: Instructor = <strong class="text-primary">${s.instructor_name || "N/A"}</strong> • Room = ${s.room || "N/A"}
                            </span>
                        </div>
                        `;
                    }).join("")}
                </div>
            </div>
        `;
    };

    panel.classList.remove("hidden");
    panel.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant pb-2">
            <div>
                <span class="font-label-caps text-label-caps text-on-surface-variant uppercase">Curriculum &amp; Instructor Inspector (Direct DB Update)</span>
                <h4 class="font-headline-md text-primary font-bold">${prog.course_id} — ${prog.course_name}</h4>
            </div>
            <button type="button" onclick="document.getElementById('course-inspector-panel').classList.add('hidden')" class="px-3 py-1 rounded bg-surface-container-high border border-outline-variant text-primary font-label-code text-label-code">
                Close
            </button>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
            ${renderSemList(sem1, "1st Semester Curriculum")}
            ${renderSemList(sem2, "2nd Semester Curriculum")}
        </div>
    `;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveInspectedSubjectInstructor(subjectId, courseId) {
    const instrEl = document.getElementById(`inspect-instr-${subjectId}`);
    const roomEl = document.getElementById(`inspect-room-${subjectId}`);
    const instructorVal = (instrEl ? instrEl.value : "").trim() || "N/A";
    const roomVal = (roomEl ? roomEl.value : "").trim() || "N/A";

    try {
        const res = await fetch(`${API_BASE}/subjects/${encodeURIComponent(subjectId)}/instructor`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                instructor_name: instructorVal,
                room: roomVal
            })
        });
        const data = await res.json();
        if (!res.ok) {
            showCoursesToast(data.detail || "Failed to update instructor.");
            return;
        }
        await loadPublishedCourses();
        inspectCourseCurriculum(courseId);
        showCoursesToast(`Saved ${data.subject_code} instructor as "${data.instructor_name}".`);
    } catch (err) {
        console.error(err);
        showCoursesToast("Network error while saving instructor.");
    }
}

window.addEventListener("DOMContentLoaded", async () => {
    const titleInput = document.getElementById("input-course-title");
    const codeInput = document.getElementById("input-course-code");
    const btnAdd = document.getElementById("btn-add-subject");
    const btnAutoBalance = document.getElementById("btn-auto-balance");
    const btnAutoCodes = document.getElementById("btn-auto-codes");
    const btnReset = document.getElementById("btn-reset");
    const btnPublish = document.getElementById("btn-publish-program");

    await loadPublishedCourses();

    regenerateCourseId(false);
    loadDefaultTemplateForSemester(1);

    if (titleInput) {
        titleInput.addEventListener("input", () => {
            if (!isEditingExistingCourse) {
                if (codeInput) {
                    codeInput.value = generateCourseIdFromTitle(titleInput.value, false);
                }
                updatePackageBadge();
                syncAutoGeneratedSubjectCodes(false);
            }
        });
    }

    if (btnAdd) {
        btnAdd.addEventListener("click", () => {
            const tableBody = document.getElementById("subject-rows-container");
            if (!tableBody) return;
            const sem = document.getElementById("select-semester")?.value || "1";
            const nextIndex = tableBody.querySelectorAll("tr").length + 1;
            const newRow = createSubjectRowElement({
                index: nextIndex,
                subjectId: generateSubjectId(),
                subjectCode: generateSubjectCode(sem, nextIndex),
                subjectName: `Curricular Elective Specialization ${nextIndex}`,
                category: "Elective",
                units: 3,
                instructorName: "N/A",
                room: "N/A",
                isAutoCode: true
            });
            tableBody.appendChild(newRow);
            calculateTally();
        });
    }

    if (btnAutoCodes) {
        btnAutoCodes.addEventListener("click", () => {
            syncAutoGeneratedSubjectCodes(true);
        });
    }

    if (btnAutoBalance) {
        btnAutoBalance.addEventListener("click", () => {
            const tableBody = document.getElementById("subject-rows-container");
            if (!tableBody) return;
            const sem = document.getElementById("select-semester")?.value || "1";

            let rows = Array.from(tableBody.querySelectorAll("tr"));
            while (rows.length < 7) {
                const idx = rows.length + 1;
                const templateItem = DEFAULT_TEMPLATES[Number(sem) === 2 ? 2 : 1][(idx - 1) % 7];
                const extraRow = createSubjectRowElement({
                    index: idx,
                    subjectId: generateSubjectId(),
                    subjectCode: generateSubjectCode(sem, idx),
                    subjectName: templateItem.title,
                    category: templateItem.category,
                    units: 3,
                    instructorName: templateItem.instructor,
                    room: templateItem.room,
                    isAutoCode: true
                });
                tableBody.appendChild(extraRow);
                rows = Array.from(tableBody.querySelectorAll("tr"));
            }
            while (rows.length > 7) {
                rows.pop().remove();
            }

            rows.forEach(r => {
                r.setAttribute("data-units", "3");
                updateRowHoursDisplay(r);
            });
            renumberRows();
            calculateTally();
        });
    }

    if (btnReset) {
        btnReset.addEventListener("click", () => {
            const sem = document.getElementById("select-semester")?.value || "1";
            loadDefaultTemplateForSemester(sem);
            hidePublishFeedback();
        });
    }

    if (btnPublish) {
        btnPublish.addEventListener("click", publishCurrentCurriculum);
    }
});
