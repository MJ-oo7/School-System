var API_BASE = window.API_BASE || "http://127.0.0.1:8000";

let allApplications = [];
let currentVerifiedUser = null;

window.onload = async function () {
    const inputEl = document.getElementById("userIdInput");
    if (inputEl) {
        inputEl.addEventListener("keydown", function (e) {
            if (e.key === "Enter") verifyEnteredUserId();
        });
    }

    const btnVerify = document.getElementById("btnVerify");
    if (btnVerify) {
        btnVerify.addEventListener("click", verifyEnteredUserId);
    }

    regenerateToken();
    await loadAllApplicationsAndTable();

    const params = new URLSearchParams(window.location.search);
    const queryUserId = params.get("user_id");
    const queryAppId = params.get("app_id");

    if (queryUserId && inputEl) {
        inputEl.value = queryUserId.trim().toUpperCase();
        await verifyEnteredUserId();
    } else if (queryAppId && inputEl) {
        // Resolve application_id to its user_id
        const matchedApp = allApplications.find(a => a.application_id === queryAppId.trim().toUpperCase());
        inputEl.value = matchedApp ? matchedApp.user_id : queryAppId.trim().toUpperCase();
        await verifyEnteredUserId();
    } else if (allApplications.length > 0 && inputEl) {
        const eligible = allApplications.find(a => a.status === "approved" && !(a.user && a.user.has_portal_account))
            || allApplications.find(a => a.status === "approved")
            || allApplications[0];
        if (eligible) {
            inputEl.value = eligible.user_id;
            await verifyEnteredUserId();
        }
    }
};

function buildUniqueUsersMap() {
    const map = new Map();
    allApplications.forEach(app => {
        const uid = app.user_id;
        if (!map.has(uid)) {
            map.set(uid, {
                userId: uid,
                fullName: (app.user && app.user.full_name) ? app.user.full_name : uid,
                email: (app.user && app.user.email) ? app.user.email : "",
                hasPortalAccount: Boolean(app.user && app.user.has_portal_account),
                hasApprovedApp: false,
                apps: []
            });
        }
        const entry = map.get(uid);
        entry.apps.push(app);
        if (app.status === "approved") {
            entry.hasApprovedApp = true;
        }
    });
    return map;
}

async function loadAllApplicationsAndTable() {
    try {
        const res = await fetch(`${API_BASE}/admin/applications`);
        if (!res.ok) return;
        allApplications = await res.json();

        const clearedEl = document.getElementById("metric-cleared-count");
        if (clearedEl) {
            const approvedCount = allApplications.filter(a => a.status === "approved").length;
            clearedEl.textContent = String(approvedCount);
        }

        // Update preset labels with real User IDs from database
        const usersMap = buildUniqueUsersMap();
        const usersList = Array.from(usersMap.values());

        const approvedUserSample = usersList.find(u => u.hasApprovedApp && !u.hasPortalAccount)
            || usersList.find(u => u.hasApprovedApp);
        const unapprovedUserSample = usersList.find(u => !u.hasApprovedApp);
        const duplicateUserSample = usersList.find(u => u.hasPortalAccount);

        const pApproved = document.getElementById("preset-id-approved");
        const pUnapproved = document.getElementById("preset-id-unapproved");
        const pDuplicate = document.getElementById("preset-id-duplicate");
        if (pApproved && approvedUserSample) pApproved.textContent = approvedUserSample.userId.slice(0, 9);
        if (pUnapproved && unapprovedUserSample) pUnapproved.textContent = unapprovedUserSample.userId.slice(0, 9);
        if (pDuplicate && duplicateUserSample) pDuplicate.textContent = duplicateUserSample.userId.slice(0, 9);

        renderProvisionedTable();
    } catch (e) {
        console.error(e);
    }
}

function getInitials(name) {
    return (name || "ST")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join("");
}

function generateStudentNo(userId, courseId) {
    const suffix = (userId || "0000").slice(-4).toUpperCase();
    const coursePrefix = (courseId || "IT").replace(/[^A-Z]/gi, "").slice(0, 4).toUpperCase() || "IT";
    return `2026-${coursePrefix}-${suffix}`;
}

async function verifyEnteredUserId() {
    const input = document.getElementById("userIdInput");
    let rawId = input ? input.value.trim().toUpperCase() : "";
    if (!rawId) return;

    // If officer typed an Application ID (APP-XXXX), resolve it to its User ID automatically
    if (rawId.startsWith("APP-") && allApplications.length > 0) {
        const matched = allApplications.find(a => a.application_id === rawId);
        if (matched) {
            rawId = matched.user_id;
            input.value = rawId;
        }
    }

    const stateApproved = document.getElementById("stateApproved");
    const stateUnapproved = document.getElementById("stateUnapproved");
    const stateDuplicate = document.getElementById("stateDuplicate");
    const dbStatus = document.getElementById("dbStatus");
    const collisionStatus = document.getElementById("collisionStatus");
    dismissToast();

    stateApproved.classList.add("hidden");
    stateUnapproved.classList.add("hidden");
    stateDuplicate.classList.add("hidden");
    currentVerifiedUser = null;

    try {
        const res = await fetch(`${API_BASE}/users/${encodeURIComponent(rawId)}/role`);
        if (!res.ok) {
            stateUnapproved.classList.remove("hidden");
            document.getElementById("unapproved-title").textContent = "Student User ID Not Found";
            document.getElementById("unapproved-code").textContent = "CODE: ERR_USER_NOT_FOUND";
            document.getElementById("unapproved-initials").textContent = "??";
            document.getElementById("unapproved-name-id").textContent = `Unknown User ID • ${rawId}`;
            document.getElementById("unapproved-user-prog").textContent = "No matching student record in Master Registry";
            document.getElementById("unapproved-message").innerHTML = `⚠️ Cannot Provision Account: Student User ID <strong>${rawId}</strong> does not exist in the system. Please check the User ID (e.g. USER-XXXXXXXX) and try again.`;
            dbStatus.textContent = "USER NOT FOUND";
            dbStatus.className = "font-label-code text-label-code text-error";
            collisionStatus.textContent = "INVALID USER ID";
            collisionStatus.className = "font-label-code text-label-code text-error";
            return;
        }

        const userData = await res.json();
        const fullName = userData.full_name || userData.user_id;
        const email = userData.email || "";
        const hasAccount = Boolean(userData.has_portal_account);
        const isApproved = Boolean(userData.is_approved);
        const primaryApp = userData.primary_application;
        const courseId = primaryApp ? primaryApp.course_id : "BSIT-002";
        const progName = primaryApp ? `${primaryApp.course_name} (${primaryApp.course_id})` : "No Program Application";
        const appId = primaryApp ? primaryApp.application_id : "N/A";
        const totalAppsCount = userData.total_applications || 0;
        const approvedAppsCount = userData.approved_count || 0;
        const initials = getInitials(fullName);
        const studentNo = generateStudentNo(userData.user_id, courseId);

        // 1. Check by User ID if the student ALREADY has an existing Student Portal account
        if (hasAccount) {
            stateDuplicate.classList.remove("hidden");
            document.getElementById("dup-current-name").textContent = fullName;
            document.getElementById("dup-current-app").textContent = `${totalAppsCount} Application(s) on file (${appId})`;
            document.getElementById("dup-current-user").textContent = `User ID: ${userData.user_id}`;

            document.getElementById("dup-existing-name-prog").textContent = `${fullName} • ${progName}`;
            document.getElementById("dup-existing-stdno").textContent = `Existing Student No: ${studentNo}`;
            document.getElementById("dup-existing-email").textContent = `Account: ${email} (Active)`;
            document.getElementById("dup-warning-text").innerHTML = `⚠️ <strong>Single Identity Mandate Violated</strong>: User ID <code class="font-label-code text-primary bg-surface-container px-1 py-0.5 rounded">${userData.user_id}</code> already has an active Student Portal account bound under Student No. <code class="font-label-code text-primary bg-surface-container px-1 py-0.5 rounded">${studentNo}</code> (${email}). Even if a student has multiple applications (${totalAppsCount} found), system policy strictly permits <strong>only one Student Portal account per User ID</strong>.`;

            dbStatus.textContent = "USER VERIFIED";
            dbStatus.className = "font-label-code text-label-code text-secondary";
            collisionStatus.textContent = "1 EXISTING ACCOUNT FOUND";
            collisionStatus.className = "font-label-code text-label-code text-secondary-fixed-dim";
            return;
        }

        // 2. Check if the User ID has at least one APPROVED application
        if (!isApproved) {
            const latestStatus = primaryApp ? (primaryApp.status || "").replace("_", " ").toUpperCase() : "NO APPLICATION";
            stateUnapproved.classList.remove("hidden");
            document.getElementById("unapproved-title").textContent = "Account Creation Blocked: Admission Not Approved";
            document.getElementById("unapproved-code").textContent = `STATUS: ${latestStatus}`;
            document.getElementById("unapproved-initials").textContent = initials;
            document.getElementById("unapproved-name-id").textContent = `${fullName} • ${userData.user_id}`;
            document.getElementById("unapproved-user-prog").textContent = `Latest App: ${appId} • ${progName} (${totalAppsCount} total app(s))`;
            document.getElementById("unapproved-message").innerHTML = `⚠️ Cannot Provision Account: Student <strong>${fullName}</strong> (User ID: <strong>${userData.user_id}</strong>) does not have any approved application yet (Latest application <strong>${appId}</strong> is currently <strong>'${latestStatus}'</strong>). At least one application for this User ID must be officially granted 'Approved' status by the registrar before a Student Portal account can be created.`;
            const reviewLink = document.getElementById("unapproved-review-link");
            if (reviewLink) reviewLink.href = primaryApp ? `admin.html?app_id=${encodeURIComponent(appId)}` : "admin.html";

            dbStatus.textContent = "UNAPPROVED / PENDING";
            dbStatus.className = "font-label-code text-label-code text-error";
            collisionStatus.textContent = "BLOCKED BY POLICY";
            collisionStatus.className = "font-label-code text-label-code text-error";
            return;
        }

        // 3. User ID has an APPROVED application and NO existing account -> Unlock State A
        currentVerifiedUser = {
            userId: userData.user_id,
            fullName: fullName,
            email: email,
            courseId: courseId,
            appId: appId,
            studentNo: studentNo
        };

        stateApproved.classList.remove("hidden");
        document.getElementById("approved-initials").textContent = initials;
        document.getElementById("approved-name").textContent = fullName;
        document.getElementById("approved-prog").textContent = `${progName} • ${approvedAppsCount} Approved Application(s)`;
        document.getElementById("approved-user-id").textContent = `User ID: ${userData.user_id}`;
        document.getElementById("approved-app-id").textContent = `Approved App: ${appId}`;
        document.getElementById("studentNoField").textContent = studentNo;
        document.getElementById("acctEmailInput").value = email;

        dbStatus.textContent = "VALIDATED (0.04ms)";
        dbStatus.className = "font-label-code text-label-code text-secondary";
        collisionStatus.textContent = "ZERO CONFLICT (0 ACCOUNTS)";
        collisionStatus.className = "font-label-code text-label-code text-primary-container";

    } catch (error) {
        console.error(error);
    }
}

async function loadPreset(state) {
    const input = document.getElementById("userIdInput");
    if (!input) return;

    const usersList = Array.from(buildUniqueUsersMap().values());

    if (state === "APPROVED") {
        const candidate = usersList.find(u => u.hasApprovedApp && !u.hasPortalAccount)
            || usersList.find(u => u.hasApprovedApp);
        if (candidate) {
            input.value = candidate.userId;
            await verifyEnteredUserId();
            return;
        }
    } else if (state === "UNAPPROVED") {
        const candidate = usersList.find(u => !u.hasApprovedApp);
        if (candidate) {
            input.value = candidate.userId;
            await verifyEnteredUserId();
            return;
        }
    } else if (state === "DUPLICATE") {
        const candidate = usersList.find(u => u.hasPortalAccount);
        if (candidate) {
            input.value = candidate.userId;
            await verifyEnteredUserId();
            return;
        }
    }
    await verifyEnteredUserId();
}

function regenerateToken() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%*";
    let token = "";
    for (let i = 0; i < 10; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const otpInput = document.getElementById("otpKey");
    if (otpInput) otpInput.value = token;
}

async function simulateCreation() {
    if (!currentVerifiedUser) return;

    const btn = document.getElementById("btnCreateAccount");
    const email = document.getElementById("acctEmailInput").value.trim();
    const password = document.getElementById("otpKey").value;

    if (!email || !password || password.length < 6) {
        alert("Please provide a valid login email and a password of at least 6 characters.");
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> <span>Writing to Master Directory...</span>';
    btn.classList.add("opacity-80", "pointer-events-none");

    try {
        const response = await fetch(`${API_BASE}/users/${encodeURIComponent(currentVerifiedUser.userId)}/create-student-account`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: email,
                user_password: password
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Failed to provision account.");
        }

        const data = await response.json();

        const toast = document.getElementById("toastSuccess");
        document.getElementById("toast-student-summary").innerHTML = `
            Credentials for <strong class="text-tertiary">${data.full_name} (${currentVerifiedUser.studentNo} • ${data.user_id})</strong> have been activated!
            Login Email: <strong class="text-secondary">${data.email}</strong> • Password: <strong class="text-primary-container font-label-code">${password}</strong>
        `;
        toast.classList.remove("hidden");
        toast.scrollIntoView({ behavior: "smooth", block: "nearest" });

        await loadAllApplicationsAndTable();

    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        btn.innerHTML = originalText;
        btn.classList.remove("opacity-80", "pointer-events-none");
    }
}

function dismissToast() {
    const toast = document.getElementById("toastSuccess");
    if (toast) toast.classList.add("hidden");
}

function renderProvisionedTable() {
    const tbody = document.getElementById("provisioned-table-body");
    if (!tbody) return;

    const searchInput = document.getElementById("provisioned-search");
    const progSelect = document.getElementById("provisioned-program-filter");
    const q = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const progFilter = progSelect ? progSelect.value.toLowerCase() : "all";

    const seenUsers = new Set();
    const provisionedApps = [];

    allApplications.forEach(app => {
        if (app.status === "approved" && app.user && app.user.has_portal_account && !seenUsers.has(app.user_id)) {
            seenUsers.add(app.user_id);
            provisionedApps.push(app);
        }
    });

    const filtered = provisionedApps.filter(app => {
        const fullName = ((app.user && app.user.full_name) || "").toLowerCase();
        const userId = (app.user_id || "").toLowerCase();
        const appId = (app.application_id || "").toLowerCase();
        const stdNo = generateStudentNo(app.user_id, app.course_id).toLowerCase();
        const courseId = (app.course_id || "").toLowerCase();

        if (progFilter !== "all" && !courseId.includes(progFilter)) return false;
        if (q && !(fullName.includes(q) || userId.includes(q) || appId.includes(q) || stdNo.includes(q))) return false;
        return true;
    });

    const footerCountEl = document.getElementById("provisioned-footer-count");
    if (footerCountEl) {
        footerCountEl.textContent = `Showing ${filtered.length} of ${provisionedApps.length} provisioned student portal accounts (Strictly 1 Account per User ID)`;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="py-8 px-space-md text-center text-on-surface-variant font-label-code">
                    No provisioned student portal accounts match the current filter.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map((app, index) => {
        const fullName = (app.user && app.user.full_name) ? app.user.full_name : app.user_id;
        const email = (app.user && app.user.email) ? app.user.email : "-";
        const initials = getInitials(fullName);
        const stdNo = generateStudentNo(app.user_id, app.course_id);
        const progTitle = (app.program && app.program.course_name) ? app.program.course_name : app.course_id;
        const rowBg = index % 2 === 1 ? "bg-surface-container-low/40" : "";

        return `
            <tr class="${rowBg} hover:bg-surface-container-high/60 transition-colors group">
                <td class="py-3.5 px-space-md">
                    <span class="font-label-code text-label-code text-primary bg-surface-container px-2 py-0.5 rounded">${app.application_id}</span>
                </td>
                <td class="py-3.5 px-space-md font-label-code text-label-code text-secondary">
                    ${app.user_id}
                </td>
                <td class="py-3.5 px-space-md font-label-code text-label-code text-tertiary font-semibold">
                    ${stdNo}
                </td>
                <td class="py-3.5 px-space-md">
                    <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-full bg-primary-container text-on-primary-container text-[11px] font-bold flex items-center justify-center">${initials}</div>
                        <div>
                            <span class="text-tertiary font-medium block">${fullName}</span>
                            <span class="text-[11px] font-label-code text-on-surface-variant">${email}</span>
                        </div>
                    </div>
                </td>
                <td class="py-3.5 px-space-md text-on-surface-variant">
                    ${progTitle} (${app.course_id})
                </td>
                <td class="py-3.5 px-space-md">
                    <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary-container/10 text-primary-container font-label-caps text-label-caps">
                        <span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span>
                        Active / Provisioned
                    </div>
                </td>
                <td class="py-3.5 px-space-md font-label-code text-label-code text-on-surface-variant">
                    AY 2026-2027 • REG-001
                </td>
                <td class="py-3.5 px-space-md text-right">
                    <a href="tuition.html?app_id=${encodeURIComponent(app.application_id)}" class="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-container-high text-secondary font-label-code text-label-code inline-flex items-center gap-1 transition-all" title="Open Student Tuition Ledger">
                        <span class="material-symbols-outlined text-[15px]">account_balance_wallet</span>
                        <span>Ledger</span>
                    </a>
                </td>
            </tr>
        `;
    }).join("");
}
