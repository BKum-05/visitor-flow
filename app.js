import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  query, where, orderBy, limit, getDocs, serverTimestamp, addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const roleRoutes = {
  management: "admin.html",
  host: "host.html",
  admin: "admin.html"
};

const pageAccess = {
  home: ["management", "host", "admin"],
  host: ["management", "host", "admin"],
  admin: ["management", "admin"],
  logs: ["management", "host", "admin"]
};

const PARKING_SLOT_COUNT = 14;

let app;
let auth;
let db;
let currentUser = null;
let currentRole = null;
let logsCache = [];
let parkingSlotsCache = [];
let activeSearch = "";
let hideBannerTimer = null;
let pendingConfirmAction = null;

const pageName = document.body.dataset.page || "home";
const selectedRoleKey = "visitorFlowSelectedRole";
const transientMessageKey = "visitorFlowTransientMessage";
const publicPages = ["index.html", "visitor.html"];
let selectedRole = sessionStorage.getItem(selectedRoleKey) || "";

const ui = {
  authCard: get("authCard"),
  appShell: get("appShell"),
  authError: get("authError"),
  roleGrid: get("roleGrid"),
  loginBtn: get("loginBtn"),
  userMeta: get("userMeta"),
  statsRow: get("statsRow"),
  currentList: get("currentList"),
  logsList: get("logsList"),
  summaryBox: get("summaryBox"),
  topHosts: get("topHosts"),
  globalError: get("globalError"),
  globalSuccess: get("globalSuccess"),
  searchInput: get("searchInput"),
  confirmModal: get("confirmModal"),
  modalTitle: get("modalTitle"),
  modalText: get("modalText"),
  modalCancel: get("modalCancel"),
  modalConfirm: get("modalConfirm"),
  visitorRequestForm: get("visitorRequestForm"),
  visitorSubmitBtn: get("visitorSubmitBtn"),
  parkingAdminList: get("parkingAdminList"),
  parkingRefreshBtn: get("parkingRefreshBtn")
};

function get(id) {
  return document.getElementById(id);
}

async function bootstrap() {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  wireEvents();
  showTransientMessage();
  await refreshParkingUiOnly();
  setupAuthListener();
}

function setupAuthListener() {
  onAuthStateChanged(auth, async (user) => {
    const currentFile = window.location.pathname.split("/").pop() || "index.html";
    const currentPage = resolvePageFromFile(currentFile);

    if (!user) {
      if (!publicPages.includes(currentFile)) {
        setTransientMessage("Please sign in to continue.");
        window.location.href = "index.html";
      }
      toggle(ui.authCard, true);
      toggle(ui.appShell, false);
      return;
    }

    currentUser = user;
    try {
      const role = await loadUserRole(user.uid);
      currentRole = role || selectedRole;

      if (!currentRole || !roleRoutes[currentRole]) {
        setTransientMessage("Unauthorized: no valid role is assigned to this account.");
        await signOut(auth);
        return;
      }

      const targetPage = roleRoutes[currentRole];
      if (currentPage !== "home" && !canAccessPage(currentRole, currentPage)) {
        window.location.href = targetPage;
        return;
      }

      if (currentFile === "index.html") {
        window.location.href = targetPage;
        return;
      }

      updateUIState();
      syncNavigationLinks();
      await refreshData();
    } catch (error) {
      console.error("Profile Load Error:", error);
      showAuthError("Unable to load your profile. Please try again.");
    }
  });
}

async function onLogin() {
  const email = get("emailInput")?.value.trim() || "";
  const pass = get("passwordInput")?.value || "";

  if (pageName === "home" && !selectedRole) {
    showAuthError("Please select a role above first.");
    return;
  }

  if (!email || !pass) {
    showAuthError("Enter both email and password.");
    return;
  }

  try {
    setLoginLoading(true);
    showAuthError("");
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    showAuthError(authErrorMessage(error));
  } finally {
    setLoginLoading(false);
  }
}

function updateUIState() {
  toggle(ui.authCard, false);
  toggle(ui.appShell, true);
  document.body.setAttribute("data-page", currentRole);

  if (ui.userMeta && currentUser) {
    ui.userMeta.textContent = currentUser.email || "";
  }

  const chip = get("roleChip");
  if (chip) {
    chip.textContent = currentRole.toUpperCase();
    chip.className = `chip ${currentRole}`;
  }
}

function wireEvents() {
  if (ui.loginBtn) ui.loginBtn.onclick = onLogin;

  const passwordInput = get("passwordInput");
  if (passwordInput) {
    passwordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") onLogin();
    });
  }

  const logoutBtn = get("logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = () => signOut(auth).then(() => {
      setTransientMessage("You have signed out.");
      window.location.href = "index.html";
    });
  }

  const refreshBtn = get("refreshBtn");
  if (refreshBtn) refreshBtn.onclick = refreshData;

  if (ui.roleGrid) {
    ui.roleGrid.querySelectorAll("[data-role]").forEach((button) => {
      button.onclick = () => {
        selectedRole = button.dataset.role || "";
        sessionStorage.setItem(selectedRoleKey, selectedRole);
        ui.roleGrid.querySelectorAll(".nav-link").forEach((entry) => entry.classList.remove("active"));
        button.classList.add("active");
      };

      if (button.dataset.role === selectedRole) button.classList.add("active");
    });
  }

  const checkInByCodeBtn = get("checkInByCodeBtn");
  if (checkInByCodeBtn) checkInByCodeBtn.onclick = checkInByCode;

  const manualCheckInBtn = get("manualCheckInBtn");
  if (manualCheckInBtn) manualCheckInBtn.onclick = manualCheckIn;

  const createPreregBtn = get("createPreregBtn");
  if (createPreregBtn) createPreregBtn.onclick = createPreregistration;

  if (ui.visitorRequestForm) {
    ui.visitorRequestForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitVisitorRequest();
    });
  }

  const searchBtn = get("searchBtn");
  if (searchBtn) searchBtn.onclick = applySearch;

  if (ui.searchInput) {
    ui.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") applySearch();
    });
  }

  const exportBtn = get("exportBtn");
  if (exportBtn) exportBtn.onclick = exportCsv;

  if (ui.parkingRefreshBtn) {
    ui.parkingRefreshBtn.onclick = async () => {
      await refreshParkingUiOnly();
      showGlobalSuccess("Parking availability refreshed.");
    };
  }

  if (ui.currentList) {
    ui.currentList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action || "";
      const id = button.dataset.id || "";
      if (action === "checkout" && id) confirmCheckout(id);
    });
  }

  if (ui.logsList) {
    ui.logsList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action || "";
      const id = button.dataset.id || "";
      if (!id) return;
      if (action === "checkout") confirmCheckout(id);
      if (action === "delete") confirmDeleteLog(id);
    });
  }

  if (ui.parkingAdminList) {
    ui.parkingAdminList.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action='save-slot-status']");
      if (!button) return;

      if (!canManageParking()) {
        showGlobalError("Only admin/management can edit parking availability.");
        return;
      }

      const slotId = button.dataset.slot || "";
      const statusSelect = ui.parkingAdminList.querySelector(`select[data-slot='${slotId}']`);
      const status = (statusSelect?.value || "").trim().toLowerCase();
      if (!slotId || !status) return;

      await saveParkingSlotStatus(slotId, status);
    });
  }

  if (ui.modalCancel) ui.modalCancel.onclick = closeConfirm;
  if (ui.modalConfirm) {
    ui.modalConfirm.onclick = async () => {
      if (!pendingConfirmAction) return;
      const action = pendingConfirmAction;
      closeConfirm();
      await action();
    };
  }

  if (ui.confirmModal) {
    ui.confirmModal.addEventListener("click", (event) => {
      if (event.target === ui.confirmModal) closeConfirm();
    });
  }
}

async function refreshData() {
  await ensureParkingSlotsSeeded();
  await loadParkingSlots();
  renderParkingSelectOptions();
  renderParkingAdminList();
  await loadLogs();
  renderStats();
  renderLogs(filteredLogs());
  renderAdminInsights();
  await loadCurrentVisitors();
}

async function refreshParkingUiOnly() {
  await ensureParkingSlotsSeeded();
  await loadParkingSlots();
  renderParkingSelectOptions();
  renderParkingAdminList();
}

async function loadParkingSlots() {
  const snapshot = await getDocs(query(collection(db, "parking_slots"), limit(PARKING_SLOT_COUNT + 20)));
  parkingSlotsCache = snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .sort((a, b) => parkingSlotOrder(a) - parkingSlotOrder(b));
}

function renderParkingSelectOptions() {
  const targets = ["hostParkingSlot", "manualParkingSlot", "visitorParkingSlot"];
  targets.forEach((id) => {
    const select = get(id);
    if (!select) return;

    const previous = select.value || "";
    const availableIds = new Set(parkingSlotsCache.map((entry) => entry.id));

    const options = [`<option value="">Auto assign</option>`];
    parkingSlotsCache.forEach((slot) => {
      const slotId = slot.id || "";
      const label = slot.label || slotId;
      const status = String(slot.status || "unknown").toLowerCase();
      const isAvailable = status === "available";
      const disabled = isAvailable ? "" : " disabled";
      const statusText = isAvailable ? "Available" : titleCase(status);
      options.push(`<option value="${escapeHtml(slotId)}"${disabled}>${escapeHtml(label)} - ${escapeHtml(statusText)}</option>`);
    });

    select.innerHTML = options.join("");
    if (previous && availableIds.has(previous)) {
      const picked = parkingSlotsCache.find((slot) => slot.id === previous);
      if (picked && String(picked.status || "").toLowerCase() === "available") {
        select.value = previous;
      }
    }
  });
}

function renderParkingAdminList() {
  if (!ui.parkingAdminList) return;

  if (!parkingSlotsCache.length) {
    ui.parkingAdminList.innerHTML = '<div class="item"><div><strong>No parking slot data.</strong><p class="meta">Refresh to load slots.</p></div></div>';
    return;
  }

  ui.parkingAdminList.innerHTML = parkingSlotsCache.map((slot) => {
    const slotId = slot.id || "";
    const status = String(slot.status || "available").toLowerCase();
    const assignedVisitCode = String(slot.assignedVisitCode || "").trim();
    const statusOptions = ["available", "reserved", "occupied", "blocked"].map((choice) => {
      const selected = choice === status ? " selected" : "";
      return `<option value="${choice}"${selected}>${titleCase(choice)}</option>`;
    }).join("");

    return `
      <div class="item">
        <div>
          <strong>${escapeHtml(slot.label || slotId)}</strong>
          <p class="meta">Assigned: ${escapeHtml(assignedVisitCode || "-")}</p>
        </div>
        <div class="row stretch">
          <select data-slot="${escapeHtml(slotId)}" aria-label="Parking status ${escapeHtml(slotId)}">${statusOptions}</select>
          <button class="btn" data-action="save-slot-status" data-slot="${escapeHtml(slotId)}">Save</button>
        </div>
      </div>
    `;
  }).join("");
}

async function saveParkingSlotStatus(slotId, status) {
  const button = ui.parkingAdminList?.querySelector(`button[data-action='save-slot-status'][data-slot='${slotId}']`);
  setButtonLoading(button, true, "Saving...");

  try {
    const updates = {
      status,
      updatedAt: serverTimestamp()
    };

    if (status === "available") {
      updates.assignedVisitCode = "";
      updates.releasedAt = serverTimestamp();
    }

    await updateDoc(doc(db, "parking_slots", slotId), updates);
    await refreshParkingUiOnly();
    showGlobalSuccess(`Parking slot ${slotId} updated to ${status}.`);
  } catch (error) {
    console.error(error);
    showGlobalError("Unable to update parking slot status.");
  } finally {
    setButtonLoading(button, false);
  }
}

async function loadLogs() {
  const logsQuery = query(collection(db, "visitor_logs"), orderBy("checkedInAt", "desc"), limit(200));
  const snapshot = await getDocs(logsQuery);
  logsCache = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

function filteredLogs() {
  const term = activeSearch.trim().toLowerCase();
  if (!term) return logsCache;

  return logsCache.filter((entry) => {
    const bucket = [
      entry.visitCode,
      entry.visitorName,
      entry.hostName,
      entry.purpose,
      entry.parkingSlotLabel,
      entry.parkingStatus,
      entry.phone,
      entry.idNumber,
      entry.vehicleNo,
      entry.source,
      entry.status
    ].filter(Boolean).join(" ").toLowerCase();
    return bucket.includes(term);
  });
}

function applySearch() {
  activeSearch = ui.searchInput?.value.trim() || "";
  renderLogs(filteredLogs());
}

function renderStats() {
  if (!ui.statsRow) return;

  const insideCount = logsCache.filter(isInside).length;
  const checkedOut = logsCache.filter((entry) => !isInside(entry)).length;
  const preregCount = logsCache.filter((entry) => entry.source === "prereg").length;
  const manualCount = logsCache.filter((entry) => entry.source === "manual").length;

  ui.statsRow.innerHTML = [
    statCard("Inside now", insideCount),
    statCard("Checked out", checkedOut),
    statCard("Pre-registered", preregCount),
    statCard("Manual", manualCount)
  ].join("");
}

function statCard(label, value) {
  return `<article class="stat"><p>${escapeHtml(label)}</p><h3>${value}</h3></article>`;
}

async function loadCurrentVisitors() {
  if (!ui.currentList) return;

  const inside = logsCache.filter(isInside);
  if (!inside.length) {
    ui.currentList.innerHTML = '<div class="item"><div><strong>No visitors currently inside.</strong><p class="meta">New check-ins will appear here.</p></div></div>';
    return;
  }

  ui.currentList.innerHTML = inside.map((entry) => {
    const checkoutBtn = canCheckOut() ? `<button class="btn" data-action="checkout" data-id="${entry.id}">Check Out</button>` : "";
    return `
      <div class="item">
        <div>
          <strong>${escapeHtml(entry.visitorName || "Unknown visitor")}</strong>
          <p class="meta">Host: ${escapeHtml(entry.hostName || "-")}</p>
          <p class="meta">Code: ${escapeHtml(entry.visitCode || entry.id)}</p>
          <p class="meta">Parking: ${escapeHtml(entry.parkingSlotLabel || "Unassigned")} (${escapeHtml(entry.parkingStatus || "-")})</p>
          <p class="meta">In: ${formatTimestamp(entry.checkedInAt)}</p>
        </div>
        <div class="row">${checkoutBtn}</div>
      </div>
    `;
  }).join("");
}

function renderLogs(list) {
  if (!ui.logsList) return;

  if (!list.length) {
    ui.logsList.innerHTML = '<div class="item"><div><strong>No records found.</strong><p class="meta">Try a different search keyword.</p></div></div>';
    return;
  }

  ui.logsList.innerHTML = list.map((entry) => {
    const status = isInside(entry) ? "Inside" : "Checked out";
    const actions = [];

    if (isInside(entry) && canCheckOut()) {
      actions.push(`<button class="btn" data-action="checkout" data-id="${entry.id}">Check Out</button>`);
    }
    if (currentRole === "admin") {
      actions.push(`<button class="btn btn-danger" data-action="delete" data-id="${entry.id}">Delete</button>`);
    }

    return `
      <div class="item">
        <div>
          <strong>${escapeHtml(entry.visitorName || "Unknown visitor")}</strong>
          <p class="meta">Host: ${escapeHtml(entry.hostName || "-")}</p>
          <p class="meta">Purpose: ${escapeHtml(entry.purpose || "-")}</p>
          <p class="meta">Parking: ${escapeHtml(entry.parkingSlotLabel || "Unassigned")} (${escapeHtml(entry.parkingStatus || "-")})</p>
          <p class="meta">Code: ${escapeHtml(entry.visitCode || entry.id)} | ${escapeHtml(status)} | ${escapeHtml(entry.source || "-")}</p>
          <p class="meta">In: ${formatTimestamp(entry.checkedInAt)}${entry.checkedOutAt ? ` | Out: ${formatTimestamp(entry.checkedOutAt)}` : ""}</p>
        </div>
        <div class="row">${actions.join("")}</div>
      </div>
    `;
  }).join("");
}

function renderAdminInsights() {
  if (ui.summaryBox) {
    const todayCount = logsCache.filter((entry) => isSameDay(entry.checkedInAt, new Date())).length;
    const insideCount = logsCache.filter(isInside).length;
    const outCount = logsCache.length - insideCount;
    const uniqueHosts = new Set(logsCache.map((entry) => (entry.hostName || "").trim()).filter(Boolean)).size;

    ui.summaryBox.innerHTML = [
      summaryTile("Total records", logsCache.length),
      summaryTile("Today check-ins", todayCount),
      summaryTile("Inside now", insideCount),
      summaryTile("Unique hosts", uniqueHosts),
      summaryTile("Checked out", outCount),
      summaryTile("Manual check-ins", logsCache.filter((entry) => entry.source === "manual").length)
    ].join("");
  }

  if (ui.topHosts) {
    const counter = new Map();
    logsCache.forEach((entry) => {
      const host = (entry.hostName || "").trim();
      if (!host) return;
      counter.set(host, (counter.get(host) || 0) + 1);
    });

    const top = Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (!top.length) {
      ui.topHosts.innerHTML = '<div class="item"><div><strong>No host activity yet.</strong></div></div>';
      return;
    }

    ui.topHosts.innerHTML = top.map(([host, count]) => (
      `<div class="item"><div><strong>${escapeHtml(host)}</strong><p class="meta">${count} visits</p></div></div>`
    )).join("");
  }
}

function summaryTile(label, value) {
  return `<div class="summary-box"><div class="label">${escapeHtml(label)}</div><div class="value">${value}</div></div>`;
}

async function checkInByCode() {
  if (!canCheckIn()) return;

  const button = get("checkInByCodeBtn");
  if (button?.disabled) return;

  const codeInput = get("preregCodeInput");
  const visitCode = (codeInput?.value || "").trim().toUpperCase();
  if (!visitCode) {
    showGlobalError("Enter a pre-registration code.");
    return;
  }

  setButtonLoading(button, true, "Checking In...");
  try {
    const preregRef = doc(db, "preregistrations", visitCode);
    const preregSnap = await getDoc(preregRef);
    if (!preregSnap.exists()) {
      showGlobalError("Pre-registration code not found.");
      return;
    }

    const prereg = preregSnap.data();
    if (prereg.status === "checked_in") {
      showGlobalError("This code has already been used for check-in.");
      return;
    }

    const logRef = doc(db, "visitor_logs", visitCode);
    const existingLog = await getDoc(logRef);
    if (existingLog.exists()) {
      showGlobalError("This code is already linked to a past check-in.");
      return;
    }

    let parkingSlotId = prereg.parkingSlotId || "";
    let parkingSlotLabel = prereg.parkingSlotLabel || "";
    if (!parkingSlotId) {
      const allocation = await allocateAvailableParking(visitCode, "occupied");
      parkingSlotId = allocation.slotId;
      parkingSlotLabel = allocation.slotLabel;
    } else {
      await setParkingStatusByVisit(visitCode, "occupied");
    }

    await setDoc(logRef, {
      visitCode,
      visitorName: prereg.visitorName || "",
      hostName: prereg.hostName || "",
      purpose: prereg.purpose || "",
      idNumber: prereg.idNumber || "",
      phone: prereg.phone || "",
      vehicleNo: prereg.vehicleNo || "",
      expectedTime: prereg.expectedTime || [prereg.expectedDate, prereg.expectedClock].filter(Boolean).join(" "),
      expectedDate: prereg.expectedDate || "",
      expectedClock: prereg.expectedClock || "",
      parkingSlotId,
      parkingSlotLabel,
      parkingStatus: parkingSlotId ? "occupied" : "waitlist",
      status: "inside",
      source: "prereg",
      checkedInAt: serverTimestamp(),
      checkedOutAt: null,
      checkedInBy: currentUser?.uid || ""
    });

    await updateDoc(preregRef, {
      status: "checked_in",
      checkedInAt: serverTimestamp(),
      parkingSlotId,
      parkingSlotLabel,
      parkingStatus: parkingSlotId ? "occupied" : "waitlist"
    });

    if (codeInput) codeInput.value = "";
    showGlobalSuccess(`Checked in ${prereg.visitorName || "visitor"} with code ${visitCode}.`);
    await refreshData();
  } catch (error) {
    console.error(error);
    showGlobalError("Unable to check in by code.");
  } finally {
    setButtonLoading(button, false);
  }
}

async function manualCheckIn() {
  if (!canCheckIn()) return;

  const button = get("manualCheckInBtn");
  if (button?.disabled) return;

  const visitorName = (get("manualVisitor")?.value || "").trim();
  const hostName = (get("manualHost")?.value || "").trim();
  const purpose = (get("manualPurpose")?.value || "").trim();
  const idNumber = (get("manualId")?.value || "").trim();
  const phone = (get("manualPhone")?.value || "").trim();
  const vehicleNo = (get("manualVehicle")?.value || "").trim();
  const preferredParkingSlot = normalizeParkingSlot(get("manualParkingSlot")?.value || "");

  if (!visitorName || !hostName || !purpose) {
    showGlobalError("Visitor name, unit number, and purpose are required.");
    return;
  }

  setButtonLoading(button, true, "Checking In...");
  try {
    const visitCode = await generateUniqueVisitCode();
    const parking = await allocateAvailableParking(visitCode, "occupied", preferredParkingSlot);
    await setDoc(doc(db, "visitor_logs", visitCode), {
      visitCode,
      visitorName,
      hostName,
      purpose,
      idNumber,
      phone,
      vehicleNo,
      preferredParkingSlot,
      parkingSlotId: parking.slotId,
      parkingSlotLabel: parking.slotLabel,
      parkingStatus: parking.slotId ? "occupied" : "waitlist",
      status: "inside",
      source: "manual",
      checkedInAt: serverTimestamp(),
      checkedOutAt: null,
      checkedInBy: currentUser?.uid || ""
    });

    clearInputs(["manualVisitor", "manualHost", "manualPurpose", "manualId", "manualPhone", "manualVehicle"]);
    showGlobalSuccess(`Manual check-in created. Visit code: ${visitCode}`);
    await refreshData();
  } catch (error) {
    console.error(error);
    showGlobalError("Unable to complete manual check-in.");
  } finally {
    setButtonLoading(button, false);
  }
}

async function createPreregistration() {
  if (!canCreatePrereg()) return;

  const button = get("createPreregBtn");
  if (button?.disabled) return;

  const visitorName = (get("hostVisitor")?.value || "").trim();
  const hostName = (get("hostName")?.value || "").trim();
  const purpose = (get("hostPurpose")?.value || "").trim();
  const expectedDate = (get("hostExpectedDate")?.value || "").trim();
  const expectedClock = (get("hostExpectedTime")?.value || "").trim();
  const expectedTime = [expectedDate, expectedClock].filter(Boolean).join(" ");
  const idNumber = (get("hostId")?.value || "").trim();
  const phone = (get("hostPhone")?.value || "").trim();
  const vehicleNo = (get("hostVehicle")?.value || "").trim();
  const preferredParkingSlot = normalizeParkingSlot(get("hostParkingSlot")?.value || "");

  if (!visitorName || !hostName || !purpose) {
    showGlobalError("Visitor name, unit number, and purpose are required.");
    return;
  }

  setButtonLoading(button, true, "Generating...");
  try {
    const visitCode = await generateUniqueVisitCode();
    const parking = await allocateAvailableParking(visitCode, "reserved", preferredParkingSlot);
    await setDoc(doc(db, "preregistrations", visitCode), {
      visitCode,
      visitorName,
      hostName,
      purpose,
      expectedTime,
      expectedDate,
      expectedClock,
      idNumber,
      phone,
      vehicleNo,
      preferredParkingSlot,
      parkingSlotId: parking.slotId,
      parkingSlotLabel: parking.slotLabel,
      parkingStatus: parking.slotId ? "reserved" : "waitlist",
      status: "pending",
      createdAt: serverTimestamp(),
      createdBy: currentUser?.uid || ""
    });

    clearInputs(["hostVisitor", "hostName", "hostPurpose", "hostExpectedDate", "hostExpectedTime", "hostId", "hostPhone", "hostVehicle"]);
    showGlobalSuccess(`Pre-registration created. Share code: ${visitCode}`);
  } catch (error) {
    console.error(error);
    showGlobalError("Unable to create pre-registration.");
  } finally {
    setButtonLoading(button, false);
  }
}

async function submitVisitorRequest() {
  const button = ui.visitorSubmitBtn;
  if (button?.disabled) return;

  const visitorName = (get("visitorNameInput")?.value || "").trim();
  const hostName = (get("visitorHostInput")?.value || "").trim();
  const purpose = (get("visitorPurposeInput")?.value || "").trim();
  const phone = (get("visitorPhoneInput")?.value || "").trim();
  const expectedDate = (get("visitorDateInput")?.value || "").trim();
  const expectedClock = (get("visitorTimeInput")?.value || "").trim();
  const expectedTime = [expectedDate, expectedClock].filter(Boolean).join(" ");
  const idNumber = (get("visitorIdInput")?.value || "").trim();
  const vehicleNo = (get("visitorVehicleInput")?.value || "").trim();
  const preferredParkingSlot = normalizeParkingSlot(get("visitorParkingSlot")?.value || "");

  if (!visitorName || !hostName || !purpose || !phone) {
    showGlobalError("Visitor name, host/unit, purpose, and phone are required.");
    return;
  }

  setButtonLoading(button, true, "Submitting...");
  try {
    await addDoc(collection(db, "visitor_requests"), {
      visitorName,
      hostName,
      purpose,
      phone,
      expectedDate,
      expectedClock,
      expectedTime,
      idNumber,
      vehicleNo,
      preferredParkingSlot,
      status: "pending",
      source: "public",
      createdAt: serverTimestamp()
    });

    clearInputs([
      "visitorNameInput",
      "visitorHostInput",
      "visitorPurposeInput",
      "visitorPhoneInput",
      "visitorDateInput",
      "visitorTimeInput",
      "visitorIdInput",
      "visitorVehicleInput",
      "visitorParkingSlot"
    ]);
    showGlobalSuccess("Request submitted. Please wait for host/admin confirmation.");
  } catch (error) {
    console.error(error);
    showGlobalError("Unable to submit request. Please try again.");
  } finally {
    setButtonLoading(button, false);
  }
}

function confirmCheckout(id) {
  openConfirm(
    "Check Out Visitor",
    "This marks the visitor as checked out.",
    async () => {
      try {
        const logSnap = await getDoc(doc(db, "visitor_logs", id));
        const visitCode = logSnap.exists() ? (logSnap.data().visitCode || id) : id;
        await updateDoc(doc(db, "visitor_logs", id), {
          checkedOutAt: serverTimestamp(),
          status: "checked_out",
          parkingStatus: "released",
          checkedOutBy: currentUser?.uid || ""
        });
        await releaseParkingByVisit(visitCode);
        showGlobalSuccess("Visitor checked out successfully.");
        await refreshData();
      } catch (error) {
        console.error(error);
        showGlobalError("Unable to check out visitor.");
      }
    },
    "Confirm"
  );
}

function confirmDeleteLog(id) {
  if (currentRole !== "admin") {
    showGlobalError("Only admins can delete records.");
    return;
  }

  openConfirm(
    "Delete Record",
    "This action cannot be undone.",
    async () => {
      try {
        const logSnap = await getDoc(doc(db, "visitor_logs", id));
        const visitCode = logSnap.exists() ? (logSnap.data().visitCode || id) : id;
        await releaseParkingByVisit(visitCode);
        await deleteDoc(doc(db, "visitor_logs", id));
        showGlobalSuccess("Record deleted.");
        await refreshData();
      } catch (error) {
        console.error(error);
        showGlobalError("Unable to delete record.");
      }
    },
    "Delete"
  );
}

function exportCsv() {
  if (!logsCache.length) {
    showGlobalError("No records available to export.");
    return;
  }

  const headers = [
    "visitCode",
    "visitorName",
    "hostName",
    "purpose",
    "source",
    "status",
    "parkingSlotLabel",
    "parkingStatus",
    "checkedInAt",
    "checkedOutAt",
    "idNumber",
    "phone",
    "vehicleNo"
  ];

  const lines = [headers.join(",")];
  logsCache.forEach((entry) => {
    const row = [
      entry.visitCode || entry.id,
      entry.visitorName || "",
      entry.hostName || "",
      entry.purpose || "",
      entry.source || "",
      entry.status || "",
      entry.parkingSlotLabel || "",
      entry.parkingStatus || "",
      formatTimestamp(entry.checkedInAt),
      formatTimestamp(entry.checkedOutAt),
      entry.idNumber || "",
      entry.phone || "",
      entry.vehicleNo || ""
    ].map(csvEscape);
    lines.push(row.join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `visitor-logs-${stamp}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  showGlobalSuccess("CSV export started.");
}

function openConfirm(title, text, action, confirmLabel = "Confirm") {
  if (!ui.confirmModal) {
    action();
    return;
  }

  pendingConfirmAction = action;
  if (ui.modalTitle) ui.modalTitle.textContent = title;
  if (ui.modalText) ui.modalText.textContent = text;
  if (ui.modalConfirm) ui.modalConfirm.textContent = confirmLabel;
  toggle(ui.confirmModal, true);
  ui.confirmModal.setAttribute("aria-hidden", "false");
}

function closeConfirm() {
  if (!ui.confirmModal) return;
  pendingConfirmAction = null;
  toggle(ui.confirmModal, false);
  ui.confirmModal.setAttribute("aria-hidden", "true");
}

function showAuthError(message) {
  if (!ui.authError) return;
  ui.authError.textContent = message;
  toggle(ui.authError, !!message);
}

function showGlobalError(message) {
  showBanner(ui.globalError, message, true);
}

function showGlobalSuccess(message) {
  showBanner(ui.globalSuccess, message, false);
}

function clearGlobalMessage() {
  showBanner(ui.globalError, "", true);
  showBanner(ui.globalSuccess, "", false);
}

function showBanner(target, message, isError) {
  if (!target) return;

  if (hideBannerTimer) {
    clearTimeout(hideBannerTimer);
    hideBannerTimer = null;
  }

  target.textContent = message;
  toggle(target, !!message);

  const other = isError ? ui.globalSuccess : ui.globalError;
  if (other) {
    other.textContent = "";
    toggle(other, false);
  }

  if (message) {
    hideBannerTimer = setTimeout(() => {
      target.textContent = "";
      toggle(target, false);
    }, 5000);
  }
}

async function loadUserRole(uid) {
  const usersSnapshot = await getDoc(doc(db, "users", uid));
  if (usersSnapshot.exists()) {
    const role = String(usersSnapshot.data().role || "").toLowerCase();
    if (role) return role;
  }

  // Compatibility mode: some projects store staff in separate collections.
  const adminSnapshot = await getDoc(doc(db, "admin", uid));
  if (adminSnapshot.exists()) return "admin";

  const hostSnapshot = await getDoc(doc(db, "host", uid));
  if (hostSnapshot.exists()) return "host";

  return null;
}

function resolvePageFromFile(fileName) {
  const raw = (fileName || "index.html").toLowerCase();
  if (raw === "index.html") return "home";
  return raw.replace(".html", "");
}

function canAccessPage(role, page) {
  const allowedRoles = pageAccess[page] || [];
  return allowedRoles.includes(role);
}

function syncNavigationLinks() {
  document.querySelectorAll(".page-nav .nav-link").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const file = href.split("/").pop() || "";
    const page = resolvePageFromFile(file);
    const allowed = page === "home" || canAccessPage(currentRole, page);
    link.classList.toggle("hidden", !allowed);
  });
}

function setLoginLoading(isLoading) {
  if (!ui.loginBtn) return;
  if (!ui.loginBtn.dataset.defaultLabel) {
    ui.loginBtn.dataset.defaultLabel = ui.loginBtn.textContent.trim() || "Sign In";
  }
  ui.loginBtn.disabled = isLoading;
  ui.loginBtn.textContent = isLoading ? "Signing in..." : ui.loginBtn.dataset.defaultLabel;
}

function setButtonLoading(button, isLoading, loadingLabel = "Working...") {
  if (!button) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent.trim() || "Submit";
  }
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingLabel : button.dataset.defaultLabel;
}

function setTransientMessage(message) {
  if (!message) return;
  sessionStorage.setItem(transientMessageKey, message);
}

function showTransientMessage() {
  const message = sessionStorage.getItem(transientMessageKey);
  if (!message) return;
  sessionStorage.removeItem(transientMessageKey);

  if (ui.authError && pageName === "home") {
    showAuthError(message);
    return;
  }

  showGlobalError(message);
}

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Login failed: Invalid email or password.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many login attempts. Wait a moment and try again.";
  }
  if (code === "auth/invalid-email") {
    return "Please enter a valid email address.";
  }
  return "Login failed. Please try again.";
}

function canCheckIn() {
  return currentRole === "management" || currentRole === "admin";
}

function canCreatePrereg() {
  return currentRole === "host" || currentRole === "admin";
}

function canCheckOut() {
  return currentRole === "management" || currentRole === "admin";
}

function canManageParking() {
  return currentRole === "management" || currentRole === "admin";
}

function isInside(entry) {
  const status = (entry.status || "").toLowerCase();
  return status === "inside" || (!entry.checkedOutAt && status !== "checked_out");
}

function isSameDay(input, dateObj) {
  const date = toDate(input);
  if (!date) return false;
  return date.toDateString() === dateObj.toDateString();
}

function toDate(input) {
  if (!input) return null;
  if (typeof input.toDate === "function") return input.toDate();
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  if (typeof input === "string") {
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatTimestamp(input) {
  const value = toDate(input);
  if (!value) return "-";
  return value.toLocaleString();
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!text.includes(",") && !text.includes("\"") && !text.includes("\n")) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function titleCase(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function clearInputs(ids) {
  ids.forEach((id) => {
    const element = get(id);
    if (element) element.value = "";
  });
}

async function ensureParkingSlotsSeeded() {
  const snapshot = await getDocs(query(collection(db, "parking_slots"), limit(PARKING_SLOT_COUNT + 5)));
  if (snapshot.size >= PARKING_SLOT_COUNT) return;

  const existing = new Set(snapshot.docs.map((entry) => entry.id));
  const writes = [];

  for (let slotNo = 1; slotNo <= PARKING_SLOT_COUNT; slotNo += 1) {
    const slotId = parkingSlotId(slotNo);
    if (existing.has(slotId)) continue;

    writes.push(setDoc(doc(db, "parking_slots", slotId), {
      slotNo,
      label: slotId,
      status: "available",
      assignedVisitCode: "",
      updatedAt: serverTimestamp()
    }));
  }

  await Promise.all(writes);
}

async function allocateAvailableParking(visitCode, nextStatus = "reserved", preferredSlotId = "") {
  const preferred = normalizeParkingSlot(preferredSlotId);

  if (preferred) {
    const preferredRef = doc(db, "parking_slots", preferred);
    const preferredSnap = await getDoc(preferredRef);
    if (preferredSnap.exists()) {
      const preferredData = preferredSnap.data() || {};
      if ((preferredData.status || "") === "available") {
        await updateDoc(preferredRef, {
          status: nextStatus,
          assignedVisitCode: visitCode,
          updatedAt: serverTimestamp()
        });

        return {
          slotId: preferred,
          slotLabel: preferredData.label || preferred
        };
      }
    }
  }

  const snapshot = await getDocs(
    query(
      collection(db, "parking_slots"),
      where("status", "==", "available"),
      orderBy("slotNo", "asc"),
      limit(1)
    )
  );

  const picked = snapshot.docs[0];
  if (!picked) {
    return { slotId: "", slotLabel: "" };
  }

  await updateDoc(picked.ref, {
    status: nextStatus,
    assignedVisitCode: visitCode,
    updatedAt: serverTimestamp()
  });

  return {
    slotId: picked.id,
    slotLabel: picked.data().label || picked.id
  };
}

async function setParkingStatusByVisit(visitCode, status) {
  if (!visitCode) return;

  const snapshot = await getDocs(
    query(collection(db, "parking_slots"), where("assignedVisitCode", "==", visitCode), limit(1))
  );
  const target = snapshot.docs[0];
  if (!target) return;

  await updateDoc(target.ref, {
    status,
    updatedAt: serverTimestamp()
  });
}

async function releaseParkingByVisit(visitCode) {
  if (!visitCode) return;

  const snapshot = await getDocs(
    query(collection(db, "parking_slots"), where("assignedVisitCode", "==", visitCode), limit(1))
  );
  const target = snapshot.docs[0];
  if (!target) return;

  await updateDoc(target.ref, {
    status: "available",
    assignedVisitCode: "",
    releasedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function parkingSlotId(slotNo) {
  return `P${String(slotNo).padStart(2, "0")}`;
}

function normalizeParkingSlot(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (/^P\d{2}$/.test(raw)) return raw;
  if (/^\d{1,2}$/.test(raw)) {
    const slotNo = Number(raw);
    if (slotNo >= 1 && slotNo <= PARKING_SLOT_COUNT) return parkingSlotId(slotNo);
  }
  return "";
}

function parkingSlotOrder(slot) {
  const fromNumber = Number(slot?.slotNo);
  if (Number.isFinite(fromNumber) && fromNumber > 0) return fromNumber;

  const label = String(slot?.label || slot?.id || "").toUpperCase();
  const match = label.match(/(\d{1,3})/);
  if (match) return Number(match[1]);

  return Number.MAX_SAFE_INTEGER;
}

async function generateUniqueVisitCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const prereg = await getDoc(doc(db, "preregistrations", code));
    if (prereg.exists()) continue;
    const log = await getDoc(doc(db, "visitor_logs", code));
    if (log.exists()) continue;
    return code;
  }
  throw new Error("Unable to allocate unique code");
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "VF-";
  for (let index = 0; index < 6; index += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function toggle(element, visible) {
  if (element) element.classList.toggle("hidden", !visible);
}

bootstrap();
