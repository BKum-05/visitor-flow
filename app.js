import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateEmail, updateProfile,
  setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  query, where, orderBy, limit, getDocs, serverTimestamp, addDoc, onSnapshot
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
const VISIT_PURPOSES = ["guest", "e-hailing", "delivery", "maintenance"];
const INVITE_CODE_TTL_HOURS = 24;
const LOGS_PAGE_SIZE = 10;

let app;
let auth;
let db;
let currentUser = null;
let currentRole = null;
let logsCache = [];
let parkingSlotsCache = [];
let preregStats = { total: 0, pending: 0 };
let preregCache = [];
let visitorRequestsCache = [];
let pendingRequestsCache = [];
let currentHostProfile = null;
let activeSearch = "";
let logsPageIndex = 0;
let hideBannerTimer = null;
let pendingConfirmAction = null;
let realtimeUnsubscribers = [];
let uiRevealObserver = null;
let uiMutationObserver = null;
let reportPreset = "today";

const revealSelector = [
  ".card",
  ".stat",
  ".item",
  ".summary-box",
  ".feature-card",
  ".mini-stat",
  ".home-loading",
  ".logs-pagination",
  ".auth-panel-head",
  ".auth-section",
  ".landing-auth-form",
  ".home-auth-copy",
  ".home-auth-panel",
  ".topbar",
  ".page-nav",
  ".hero-grid",
  ".grid",
  ".stats",
  ".page > section",
  "#appShell > header",
  "#appShell > nav",
  "#appShell > section"
].join(",");

const pageName = document.body.dataset.page || "home";
const selectedRoleKey = "visitorFlowSelectedRole";
const transientMessageKey = "visitorFlowTransientMessage";
const publicPages = ["index.html", "visitor.html"];
let selectedRole = sessionStorage.getItem(selectedRoleKey) || "";

const ui = {
  authCard: get("authCard"),
  appShell: get("appShell"),
  authError: get("loginError"),
  loginError: get("loginError"),
  registerError: get("registerError"),
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
  logSortField: get("logSortField"),
  logsPagination: get("logsPagination"),
  confirmModal: get("confirmModal"),
  modalTitle: get("modalTitle"),
  modalText: get("modalText"),
  modalCancel: get("modalCancel"),
  modalConfirm: get("modalConfirm"),
  profileModal: get("profileModal"),
  profileName: get("profileName"),
  profileEmail: get("profileEmail"),
  profilePhone: get("profilePhone"),
  profileUnit: get("profileUnit"),
  profileUnitWrap: get("profileUnitWrap"),
  profileError: get("profileError"),
  profileCancel: get("profileCancel"),
  profileSaveBtn: get("profileSaveBtn"),
  visitorRequestForm: get("visitorRequestForm"),
  visitorSubmitBtn: get("visitorSubmitBtn"),
  parkingAdminList: get("parkingAdminList"),
  parkingRefreshBtn: get("parkingRefreshBtn"),
  registerHostBtn: get("registerHostBtn"),
  preregCodePanel: get("preregCodePanel"),
  preregCodeValue: get("preregCodeValue"),
  pendingRequestsList: get("pendingRequestsList")
  ,
  reportFromDate: get("reportFromDate"),
  reportToDate: get("reportToDate"),
  reportPresetBar: get("reportPresetBar"),
  reportRangeLabel: get("reportRangeLabel")
};

function get(id) {
  return document.getElementById(id);
}

function setupUiObservers() {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const supportsIntersectionObserver = typeof IntersectionObserver !== "undefined";

  if (!supportsIntersectionObserver || prefersReducedMotion) {
    document.querySelectorAll(revealSelector).forEach((node) => {
      if (node.classList.contains("hidden")) return;
      node.classList.add("is-visible");
    });
    return;
  }

  uiRevealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      entry.target.classList.toggle("is-visible", entry.isIntersecting);
    });
  }, {
    root: null,
    threshold: 0.12,
    rootMargin: "0px 0px -8% 0px"
  });

  observeRevealTargets(document);

  uiMutationObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === "childList") {
        record.addedNodes.forEach((added) => {
          if (!(added instanceof Element)) return;
          observeRevealTargets(added);
        });
      }

      if (record.type === "attributes" && record.target instanceof Element) {
        observeRevealTargets(record.target);
      }
    });
  });

  uiMutationObserver.observe(document.body, {
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
    subtree: true
  });
}

function observeRevealTargets(root) {
  if (!uiRevealObserver || !root) return;

  const nodes = [];
  if (root instanceof Element && root.matches(revealSelector)) {
    nodes.push(root);
  }
  if (root instanceof Element) {
    nodes.push(...root.querySelectorAll(revealSelector));
  }
  if (root === document) {
    nodes.push(...document.querySelectorAll(revealSelector));
  }

  nodes.forEach((node) => {
    if (!(node instanceof Element)) return;
    if (node.classList.contains("hidden")) return;
    if (node.classList.contains("observe-reveal") || node.classList.contains("is-visible")) return;
    node.classList.add("observe-reveal");
    uiRevealObserver.observe(node);
  });
}

async function bootstrap() {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  const currentFile = window.location.pathname.split("/").pop() || "index.html";
  const isPublicPage = publicPages.includes(currentFile);

  setupUiObservers();
  wireEvents();
  wireInputAutoFormatters();
  wirePurposeParkingControls();
  syncAllPurposeParkingUi();
  showTransientMessage();

  try {
    // Keep auth only for the browser session to avoid long-lived auto-login.
    await setPersistence(auth, browserSessionPersistence);
  } catch (error) {
    console.warn("Could not apply auth session persistence:", error);
  }

  if (isPublicPage) {
    await refreshParkingUiOnly();
  } else {
    toggle(ui.appShell, false);
  }

  setupAuthListener();
}

function setupAuthListener() {
  onAuthStateChanged(auth, async (user) => {
    stopRealtimeListeners();
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

      try {
        await loadHostProfile(user.uid);
      } catch (error) {
        console.warn("Could not load host profile, continuing:", error);
      }
      
      updateUIState();
      applyHostProfileToForm();
      syncNavigationLinks();

      if (ui.reportFromDate && ui.reportToDate) {
        if (!ui.reportFromDate.value && !ui.reportToDate.value) {
          applyReportPreset("today");
        } else {
          markReportPresetButton(reportPreset);
          refreshReportViews();
        }
      }

      await refreshData();
      setupRealtimeListeners(currentPage);
    } catch (error) {
      console.error("Auth Error:", error);
      showAuthError("Unable to load your dashboard. Please try again.");
    }
  });
}

function setupRealtimeListeners(currentPage) {
  if (currentPage !== "admin") return;

  const pendingRequestsQuery = query(collection(db, "visitor_requests"), where("status", "==", "pending"), limit(200));
  const pendingRequestsUnsub = onSnapshot(pendingRequestsQuery, async (snapshot) => {
    pendingRequestsCache = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));

    await refreshAdminPanelsOnly();
  });

  const preregQuery = currentRole === "host"
    ? query(collection(db, "preregistrations"), where("createdBy", "==", currentUser?.uid || ""), limit(500))
    : query(collection(db, "preregistrations"), limit(500));

  const preregUnsub = onSnapshot(preregQuery, async (snapshot) => {
    preregCache = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    derivePreregStats();
    await refreshAdminPanelsOnly();
  });

  const logsUnsub = onSnapshot(query(collection(db, "visitor_logs"), limit(500)), async (snapshot) => {
    logsCache = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((a, b) => (toDate(b.checkedInAt)?.getTime() || 0) - (toDate(a.checkedInAt)?.getTime() || 0));
    await refreshAdminPanelsOnly();
  });

  realtimeUnsubscribers = [pendingRequestsUnsub, preregUnsub, logsUnsub];
}

function stopRealtimeListeners() {
  realtimeUnsubscribers.forEach((unsubscribe) => {
    try {
      if (typeof unsubscribe === "function") unsubscribe();
    } catch (error) {
      console.error(error);
    }
  });
  realtimeUnsubscribers = [];
}

async function refreshAdminPanelsOnly() {
  renderStats();
  renderLogs(filteredLogs());
  renderPendingRequests();
  renderAdminInsights();
  await loadCurrentVisitors();
  renderParkingAdminList();
}

async function onLogin() {
  const email = get("emailInput")?.value.trim() || "";
  const pass = get("passwordInput")?.value || "";

  if (pageName === "home" && !selectedRole) {
    showAuthError("Please select a role above first.", "login");
    return;
  }

  if (!email || !pass) {
    showAuthError("Enter both email and password.", "login");
    return;
  }

  try {
    setLoginLoading(true);
    showAuthError("", "all");
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    showAuthError(authErrorMessage(error), "login");
  } finally {
    setLoginLoading(false);
  }
}

async function onRegisterHostAccount() {
  const name = formatNameWords((get("registerNameInput")?.value || "").trim());
  const unitNumber = (get("registerUnitInput")?.value || "").trim();
  const phone = (get("registerPhoneInput")?.value || "").trim();
  const email = (get("registerEmailInput")?.value || "").trim();
  const password = get("registerPasswordInput")?.value || "";

  if (!name || !unitNumber || !phone || !email || !password) {
    showAuthError("Complete all host registration fields.", "register");
    return;
  }

  const button = ui.registerHostBtn;
  setButtonLoading(button, true, "Creating...");
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    const profile = {
      role: "host",
      name,
      unitNumber,
      phone,
      email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, "host", uid), profile);
    await setDoc(doc(db, "users", uid), profile, { merge: true });

    clearInputs([
      "registerNameInput",
      "registerUnitInput",
      "registerPhoneInput",
      "registerEmailInput",
      "registerPasswordInput"
    ]);

    selectedRole = "host";
    sessionStorage.setItem(selectedRoleKey, selectedRole);
    showAuthError("", "all");
    setTransientMessage("Host account created. Welcome to your dashboard.");
    window.location.href = "host.html";
  } catch (error) {
    console.error(error);
    showAuthError(authErrorMessage(error), "register");
  } finally {
    setButtonLoading(button, false);
  }
}

function updateUIState() {
  toggle(ui.authCard, false);
  toggle(ui.appShell, true);
  document.body.setAttribute("data-page", currentRole);
  toggle(ui.statsRow, canViewStats());

  if (ui.userMeta && currentUser) {
    const displayName = String(currentUser.displayName || currentHostProfile?.name || "").trim();
    const email = String(currentUser.email || currentHostProfile?.email || "").trim();
    ui.userMeta.textContent = [displayName, email].filter(Boolean).join(" • ") || email;
  }

  const chip = get("roleChip");
  if (chip) {
    chip.textContent = currentRole.toUpperCase();
    chip.className = `chip ${currentRole}`;
  }
}

function canViewStats() {
  return currentRole === "admin" || currentRole === "management";
}

function wireEvents() {
  if (ui.loginBtn) ui.loginBtn.onclick = onLogin;
  if (ui.registerHostBtn) ui.registerHostBtn.onclick = onRegisterHostAccount;

  const showHostRegisterBtn = get("showHostRegisterBtn");
  if (showHostRegisterBtn) {
    showHostRegisterBtn.onclick = () => {
      toggleHomeSignInSection(false);
      toggle(get("hostRegisterPrompt"), false);
      toggle(get("hostRegisterForm"), true);
      syncHomeAuthDividers();
    };
  }

  const cancelHostRegisterBtn = get("cancelHostRegisterBtn");
  if (cancelHostRegisterBtn) {
    cancelHostRegisterBtn.onclick = () => {
      toggleHomeSignInSection(true);
      toggle(get("hostRegisterForm"), false);
      toggle(get("hostRegisterPrompt"), true);
      syncHomeAuthDividers();
    };
  }

  toggleHomeSignInSection(!showHostRegisterBtn || get("hostRegisterForm")?.classList.contains("hidden"));
  syncHomeAuthDividers();

  const passwordInput = get("passwordInput");
  if (passwordInput) {
    passwordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") onLogin();
    });
  }

  const logoutBtn = get("logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      openConfirm(
        "Sign Out",
        "Are you sure you want to sign out now?",
        async () => {
          await signOut(auth);
          setTransientMessage("You have signed out.");
          window.location.href = "index.html";
        },
        "Sign Out"
      );
    };
  }

  const editProfileBtn = get("editProfileBtn");
  if (editProfileBtn) {
    editProfileBtn.onclick = openProfileModal;
  }

  if (ui.profileCancel) ui.profileCancel.onclick = closeProfileModal;
  if (ui.profileSaveBtn) ui.profileSaveBtn.onclick = saveProfile;

  if (ui.profileModal) {
    ui.profileModal.addEventListener("click", (event) => {
      if (event.target === ui.profileModal) closeProfileModal();
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

  const copyPreregCodeBtn = get("copyPreregCodeBtn");
  if (copyPreregCodeBtn) {
    copyPreregCodeBtn.onclick = copyLatestPreregCode;
  }

  const closePreregCodeBtn = get("closePreregCodeBtn");
  if (closePreregCodeBtn) {
    closePreregCodeBtn.onclick = () => toggle(ui.preregCodePanel, false);
  }

  if (ui.visitorRequestForm) {
    ui.visitorRequestForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitVisitorRequest();
    });
  }

  const visitorInviteCodeInput = get("visitorInviteCodeInput");
  if (visitorInviteCodeInput) {
    visitorInviteCodeInput.addEventListener("change", autofillVisitorByInviteCode);
    visitorInviteCodeInput.addEventListener("blur", autofillVisitorByInviteCode);
    visitorInviteCodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        autofillVisitorByInviteCode();
      }
    });
  }

  const searchBtn = get("searchBtn");
  if (searchBtn) searchBtn.onclick = applySearch;

  if (ui.searchInput) {
    ui.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") applySearch();
    });
  }

  if (ui.logSortField) {
    ui.logSortField.addEventListener("change", () => {
      logsPageIndex = 0;
      renderLogs(filteredLogs());
    });
  }

  if (ui.reportPresetBar) {
    ui.reportPresetBar.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-report-range]");
      if (!button) return;
      const preset = String(button.dataset.reportRange || "").trim();
      applyReportPreset(preset || "today");
    });
  }

  if (ui.reportFromDate) {
    ui.reportFromDate.addEventListener("change", () => {
      reportPreset = "custom";
      refreshReportViews();
    });
  }

  if (ui.reportToDate) {
    ui.reportToDate.addEventListener("change", () => {
      reportPreset = "custom";
      refreshReportViews();
    });
  }

  const exportBtn = get("exportBtn");
  if (exportBtn) exportBtn.onclick = exportCsv;

  if (ui.parkingRefreshBtn) {
    ui.parkingRefreshBtn.onclick = async () => {
      await refreshParkingUiOnly();
      syncAllPurposeParkingUi();
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

  if (ui.logsPagination) {
    ui.logsPagination.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const list = filteredLogs();
      const totalPages = Math.max(1, Math.ceil(list.length / LOGS_PAGE_SIZE));
      const action = button.dataset.action || "";

      if (action === "logs-page-prev" && logsPageIndex > 0) {
        logsPageIndex -= 1;
      }

      if (action === "logs-page-next" && logsPageIndex < totalPages - 1) {
        logsPageIndex += 1;
      }

      renderLogs(list);
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!isLogsPagingContextActive()) return;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    const isTyping = target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    if (isTyping) return;

    const list = filteredLogs();
    const totalPages = Math.max(1, Math.ceil(list.length / LOGS_PAGE_SIZE));

    if (event.key === "ArrowLeft" && logsPageIndex > 0) {
      event.preventDefault();
      logsPageIndex -= 1;
      renderLogs(list);
    }

    if (event.key === "ArrowRight" && logsPageIndex < totalPages - 1) {
      event.preventDefault();
      logsPageIndex += 1;
      renderLogs(list);
    }
  });

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

  if (ui.pendingRequestsList) {
    ui.pendingRequestsList.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action || "";
      const requestId = button.dataset.id || "";
      if (!requestId) return;

      if (action === "approve-request") {
        await approveVisitorRequest(requestId, button);
      }
      if (action === "reject-request") {
        await rejectVisitorRequest(requestId, button);
      }
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

function isLogsPagingContextActive() {
  if (!ui.logsList || !ui.logsPagination) return false;
  if (ui.confirmModal && !ui.confirmModal.classList.contains("hidden")) return false;

  const rect = ui.logsPagination.getBoundingClientRect();
  const inViewport = rect.top < window.innerHeight && rect.bottom > 0;
  return inViewport;
}

function syncHomeAuthDividers() {
  const dividerA = get("authDividerA");
  const dividerB = get("authDividerB");
  const prompt = get("hostRegisterPrompt");
  const form = get("hostRegisterForm");
  const loginForm = get("loginForm");
  if (!dividerA || !dividerB || !prompt || !form || !loginForm) return;

  const showingPrompt = !prompt.classList.contains("hidden");
  const showingForm = !form.classList.contains("hidden");
  const showingLogin = !loginForm.classList.contains("hidden");

  toggle(dividerA, showingLogin && (showingPrompt || showingForm));
  toggle(dividerB, showingPrompt || showingForm);
}

function toggleHomeSignInSection(visible) {
  const authCard = get("authCard");
  if (!authCard) return;

  const sectionSelectors = [".auth-panel-head", ".auth-section", "#loginForm"];
  sectionSelectors.forEach((selector) => {
    const element = authCard.querySelector(selector);
    if (element) toggle(element, visible);
  });
}

function wireInputAutoFormatters() {
  wireFormatter("registerNameInput", formatNameWords);
  wireFormatter("visitorNameInput", formatNameWords);
  wireFormatter("hostVisitor", formatNameWords);
  wireFormatter("manualVisitor", formatNameWords);
  wireFormatter("profileName", formatNameWords);

  wireFormatter("visitorVehicleInput", formatCarPlate);
  wireFormatter("hostVehicle", formatCarPlate);
  wireFormatter("manualVehicle", formatCarPlate);

  wireClearAuthError("emailInput", "login");
  wireClearAuthError("passwordInput", "login");
  wireClearAuthError("registerNameInput", "register");
  wireClearAuthError("registerUnitInput", "register");
  wireClearAuthError("registerPhoneInput", "register");
  wireClearAuthError("registerEmailInput", "register");
  wireClearAuthError("registerPasswordInput", "register");
}

function wireClearAuthError(id, section) {
  const element = get(id);
  if (!element) return;

  element.addEventListener("input", () => showAuthError("", section));
}

function wireFormatter(id, formatter) {
  const element = get(id);
  if (!element) return;

  const apply = () => {
    const current = String(element.value || "");
    const next = formatter(current);
    if (next !== current) element.value = next;
  };

  element.addEventListener("input", apply);
  element.addEventListener("blur", apply);
}

function wirePurposeParkingControls() {
  const configs = [
    { purposeId: "visitorPurposeInput", parkingNeedWrapId: "visitorParkingNeedWrap", parkingNeedId: "visitorParkingNeeded", parkingSlotWrapId: "visitorParkingSlotWrap", parkingSlotId: "visitorParkingSlot" },
    { purposeId: "hostPurpose", parkingNeedWrapId: "hostParkingNeedWrap", parkingNeedId: "hostParkingNeeded", parkingSlotWrapId: "hostParkingSlotWrap", parkingSlotId: "hostParkingSlot" },
    { purposeId: "manualPurpose", parkingNeedWrapId: "manualParkingNeedWrap", parkingNeedId: "manualParkingNeeded", parkingSlotWrapId: "manualParkingSlotWrap", parkingSlotId: "manualParkingSlot" }
  ];

  configs.forEach((config) => {
    const purposeField = get(config.purposeId);
    const parkingNeedField = get(config.parkingNeedId);
    if (purposeField) {
      purposeField.addEventListener("change", () => syncPurposeParkingUi(config));
    }
    if (parkingNeedField) {
      parkingNeedField.addEventListener("change", () => syncPurposeParkingUi(config));
    }
  });
}

function syncAllPurposeParkingUi() {
  syncPurposeParkingUi({ purposeId: "visitorPurposeInput", parkingNeedWrapId: "visitorParkingNeedWrap", parkingNeedId: "visitorParkingNeeded", parkingSlotWrapId: "visitorParkingSlotWrap", parkingSlotId: "visitorParkingSlot" });
  syncPurposeParkingUi({ purposeId: "hostPurpose", parkingNeedWrapId: "hostParkingNeedWrap", parkingNeedId: "hostParkingNeeded", parkingSlotWrapId: "hostParkingSlotWrap", parkingSlotId: "hostParkingSlot" });
  syncPurposeParkingUi({ purposeId: "manualPurpose", parkingNeedWrapId: "manualParkingNeedWrap", parkingNeedId: "manualParkingNeeded", parkingSlotWrapId: "manualParkingSlotWrap", parkingSlotId: "manualParkingSlot" });
}

function syncPurposeParkingUi(config) {
  const purpose = normalizeVisitPurpose(get(config.purposeId)?.value || "");
  const needsParkingPrompt = purpose && purpose !== "guest";
  const parkingNeedWrap = get(config.parkingNeedWrapId);
  const parkingNeedField = get(config.parkingNeedId);
  const parkingSlotWrap = get(config.parkingSlotWrapId);
  const parkingSlot = get(config.parkingSlotId);

  if (parkingNeedWrap) {
    toggle(parkingNeedWrap, needsParkingPrompt);
  }

  let showParkingSlot = true;
  if (needsParkingPrompt) {
    showParkingSlot = (parkingNeedField?.value || "") === "yes";
  }

  if (parkingSlotWrap) {
    toggle(parkingSlotWrap, showParkingSlot);
  }

  if (!showParkingSlot && parkingSlot) {
    parkingSlot.value = "";
  }

  if (!needsParkingPrompt && parkingNeedField) {
    parkingNeedField.value = "";
  }
}

async function refreshData() {
  await ensureParkingSlotsSeeded();
  await loadParkingSlots();
  renderParkingSelectOptions();
  syncAllPurposeParkingUi();
  
  try {
    await loadVisitorRequests();
  } catch (error) {
    console.warn("Could not load visitor requests:", error);
  }
  
  try {
    await loadPreregistrations();
  } catch (error) {
    console.warn("Could not load preregistrations:", error);
  }
  
  try {
    await reconcileCheckedInPreregToLogs();
  } catch (error) {
    console.warn("Could not reconcile preregistrations:", error);
  }
  
  try {
    await loadLogs();
  } catch (error) {
    console.warn("Could not load logs:", error);
  }
  
  try {
    await loadPendingRequests();
  } catch (error) {
    console.warn("Could not load pending requests:", error);
  }
  
  derivePreregStats();
  renderParkingAdminList();
  renderStats();
  renderLogs(filteredLogs());
  renderPendingRequests();
  renderAdminInsights();
  
  try {
    await loadCurrentVisitors();
  } catch (error) {
    console.warn("Could not load current visitors:", error);
  }
}

async function refreshParkingUiOnly() {
  await ensureParkingSlotsSeeded();
  await loadParkingSlots();
  renderParkingSelectOptions();
  syncAllPurposeParkingUi();
  renderParkingAdminList();
}

async function loadParkingSlots() {
  const snapshot = await getDocs(query(collection(db, "parking_slots"), limit(PARKING_SLOT_COUNT + 20)));
  parkingSlotsCache = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

function renderParkingSelectOptions() {
  const sortedSlots = getSortedParkingSlots();
  const targets = ["hostParkingSlot", "manualParkingSlot", "visitorParkingSlot"];
  targets.forEach((id) => {
    const select = get(id);
    if (!select) return;

    const previous = select.value || "";
    const availableValues = new Set(sortedSlots.map((entry) => slotValue(entry)));

    const options = [`<option value="">Auto assign</option>`];
    sortedSlots.forEach((slot) => {
      const value = slotValue(slot);
      const label = slot.label || value || String(slot.id || "");
      const status = String(slot.status || "unknown").toLowerCase();
      const isAvailable = status === "available";
      const disabled = isAvailable ? "" : " disabled";
      const statusText = isAvailable ? "Available" : titleCase(status);
      options.push(`<option value="${escapeHtml(value)}"${disabled}>${escapeHtml(label)} - ${escapeHtml(statusText)}</option>`);
    });

    select.innerHTML = options.join("");
    if (previous && availableValues.has(previous)) {
      const picked = sortedSlots.find((slot) => slotValue(slot) === previous);
      if (picked && String(picked.status || "").toLowerCase() === "available") {
        select.value = previous;
      }
    }
  });
}

function renderParkingAdminList() {
  if (!ui.parkingAdminList) return;

  const sortedSlots = getSortedParkingSlots();
  if (!sortedSlots.length) {
    ui.parkingAdminList.innerHTML = '<div class="item"><div><strong>No parking slot data.</strong><p class="meta">Refresh to load slots.</p></div></div>';
    return;
  }

  ui.parkingAdminList.innerHTML = sortedSlots.map((slot) => {
    const slotId = slot.id || "";
    const slotDisplay = slot.label || slotValue(slot) || slotId;
    const status = String(slot.status || "available").toLowerCase();
    const assignedVisitCode = String(slot.assignedVisitCode || "").trim();
    const vehicleNo = resolveVehicleForVisit(assignedVisitCode);
    const statusOptions = ["available", "reserved", "occupied", "blocked"].map((choice) => {
      const selected = choice === status ? " selected" : "";
      return `<option value="${choice}"${selected}>${titleCase(choice)}</option>`;
    }).join("");

    return `
      <div class="item">
        <div>
          <strong>${escapeHtml(slotDisplay)}</strong>
          <p class="meta">Vehicle: ${escapeHtml(vehicleNo || "-")}</p>
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
  const baseRef = collection(db, "visitor_logs");
  if (currentRole === "host") {
    const uid = currentUser?.uid || "";
    const unitNumber = String(currentHostProfile?.unitNumber || "").trim();

    const fetchHostOwned = async () => {
      try {
        return await getDocs(query(baseRef, where("hostOwnerUid", "==", uid), limit(500)));
      } catch (error) {
        console.warn("hostOwnerUid query failed:", error.message);
        return { docs: [] };
      }
    };

    const fetchLegacy = async () => {
      try {
        return await getDocs(query(baseRef, where("checkedInBy", "==", uid), limit(500)));
      } catch (error) {
        console.warn("checkedInBy query failed:", error.message);
        return { docs: [] };
      }
    };

    const fetchByHostName = async () => {
      if (!unitNumber) {
        return { docs: [] };
      }
      try {
        return await getDocs(query(baseRef, where("hostName", "==", unitNumber), limit(500)));
      } catch (error) {
        console.warn("hostName query failed:", error.message);
        return { docs: [] };
      }
    };

    const [ownedSnap, legacySnap, hostNameSnap] = await Promise.all([fetchHostOwned(), fetchLegacy(), fetchByHostName()]);

    const merged = new Map();
    [...ownedSnap.docs, ...legacySnap.docs, ...hostNameSnap.docs].forEach((entry) => {
      merged.set(entry.id, { id: entry.id, ...entry.data() });
    });

    logsCache = Array.from(merged.values())
      .sort((a, b) => (toDate(b.checkedInAt)?.getTime() || 0) - (toDate(a.checkedInAt)?.getTime() || 0));
    return;
  }

  try {
    const logsQuery = query(baseRef, limit(500));
    const snapshot = await getDocs(logsQuery);
    logsCache = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((a, b) => (toDate(b.checkedInAt)?.getTime() || 0) - (toDate(a.checkedInAt)?.getTime() || 0));
  } catch (error) {
    console.warn("Admin logs query failed:", error.message);
    logsCache = [];
  }
}

async function resolveHostOwnerUidByUnit(unitOrHostName) {
  const unit = String(unitOrHostName || "").trim();
  if (!unit) return "";

  // Try host collection first
  const hostSnapshot = await getDocs(
    query(collection(db, "host"), where("unitNumber", "==", unit), limit(1))
  );
  if (hostSnapshot.docs.length > 0) {
    return hostSnapshot.docs[0].id;
  }

  // Fall back to users collection
  const usersSnapshot = await getDocs(
    query(collection(db, "users"), where("unitNumber", "==", unit), limit(1))
  );
  if (usersSnapshot.docs.length > 0) {
    return usersSnapshot.docs[0].id;
  }

  return "";
}

async function loadPreregistrations() {
  const baseRef = collection(db, "preregistrations");
  const targetQuery = currentRole === "host"
    ? query(baseRef, where("createdBy", "==", currentUser?.uid || ""), limit(500))
    : query(baseRef, limit(500));

  const snapshot = await getDocs(targetQuery);
  preregCache = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

async function loadVisitorRequests() {
  const baseRef = collection(db, "visitor_requests");
  let targetQuery;

  if (currentRole === "host") {
    const unitNumber = String(currentHostProfile?.unitNumber || "").trim();
    if (!unitNumber) {
      visitorRequestsCache = [];
      return;
    }
    targetQuery = query(
      baseRef,
      where("source", "==", "public"),
      where("hostName", "==", unitNumber),
      limit(500)
    );
  } else {
    targetQuery = query(baseRef, where("source", "==", "public"), limit(500));
  }

  const snapshot = await getDocs(targetQuery);
  visitorRequestsCache = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

async function reconcileCheckedInPreregToLogs() {
  if (!canCheckIn()) return;

  const checkedInRows = preregCache.filter((entry) => String(entry.status || "").toLowerCase() === "checked_in");
  if (!checkedInRows.length) return;

  for (const prereg of checkedInRows) {
    const visitCode = String(prereg.visitCode || prereg.id || "").trim();
    if (!visitCode) continue;

    const logRef = doc(db, "visitor_logs", visitCode);
    const logSnap = await getDoc(logRef);
    if (!logSnap.exists()) {
      await setDoc(logRef, {
        visitCode,
        visitorName: prereg.visitorName || "",
        hostName: prereg.hostName || "",
        hostOwnerUid: prereg.hostOwnerUid || "",
        purpose: prereg.purpose || "",
        idNumber: prereg.idNumber || "",
        phone: prereg.phone || "",
        vehicleNo: prereg.vehicleNo || "",
        parkingRequested: prereg.parkingRequested !== false,
        overnightParkingRequested: !!prereg.overnightParkingRequested,
        expectedTime: prereg.expectedTime || [prereg.expectedDate, prereg.expectedClock].filter(Boolean).join(" "),
        expectedDate: prereg.expectedDate || "",
        expectedClock: prereg.expectedClock || "",
        parkingSlotId: prereg.parkingSlotId || "",
        parkingSlotLabel: prereg.parkingSlotLabel || "",
        parkingStatus: prereg.parkingSlotId ? "occupied" : (prereg.parkingRequested === false ? "not_required" : "waitlist"),
        status: "inside",
        source: prereg.source || "prereg",
        bookingTimestamp: prereg.bookingTimestamp || prereg.createdAt || serverTimestamp(),
        checkedInAt: prereg.checkedInAt || serverTimestamp(),
        checkedOutAt: null,
        checkedInBy: prereg.createdBy || currentUser?.uid || ""
      });
    } else {
      const current = logSnap.data() || {};
      const updates = {};

      if ((current.status || "") !== "inside") updates.status = "inside";
      if (prereg.parkingSlotId && current.parkingStatus !== "occupied") updates.parkingStatus = "occupied";
      if (!current.parkingSlotId && prereg.parkingSlotId) updates.parkingSlotId = prereg.parkingSlotId;
      if (!current.parkingSlotLabel && prereg.parkingSlotLabel) updates.parkingSlotLabel = prereg.parkingSlotLabel;
      if (!current.hostOwnerUid && prereg.hostOwnerUid) updates.hostOwnerUid = prereg.hostOwnerUid;
      if (Object.keys(updates).length) {
        await updateDoc(logRef, updates);
      }
    }

    if (prereg.parkingSlotId) {
      await setParkingStatusByVisit(visitCode, "occupied");
    }
  }
}

function derivePreregStats() {
  preregStats = {
    total: preregCache.length,
    pending: preregCache.filter((entry) => String(entry.status || "").toLowerCase() === "pending").length
  };
}

async function loadPendingRequests() {
  if (!ui.pendingRequestsList || !canManagePendingRequests()) {
    pendingRequestsCache = [];
    return;
  }

  const baseQuery = query(collection(db, "visitor_requests"), where("status", "==", "pending"), limit(200));
  const snapshot = await getDocs(baseQuery);
  pendingRequestsCache = snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
}

function renderPendingRequests() {
  if (!ui.pendingRequestsList) return;

  if (!canManagePendingRequests()) {
    ui.pendingRequestsList.innerHTML = '<div class="item"><div><strong>Only admin/management can review requests.</strong></div></div>';
    return;
  }

  if (!pendingRequestsCache.length) {
    ui.pendingRequestsList.innerHTML = '<div class="item"><div><strong>No pending requests.</strong><p class="meta">New visitor submissions will appear here.</p></div></div>';
    return;
  }

  ui.pendingRequestsList.innerHTML = pendingRequestsCache.map((entry) => {
    const requestId = entry.id || "";
    const preferredSlot = normalizeParkingSlot(entry.preferredParkingSlot || "");
    const overnightLabel = entry.overnightParkingRequested ? "Yes" : "No";
    const parkingText = entry.parkingRequested
      ? (preferredSlot || "Auto assign from available slots")
      : "No parking required";
    return `
      <div class="item">
        <div>
          <strong>${escapeHtml(entry.visitorName || "Unknown visitor")}</strong>
          <p class="meta">Host/Unit: ${escapeHtml(entry.hostName || "-")}</p>
          <p class="meta">Purpose: ${escapeHtml(entry.purpose || "-")} | Parking Slot Plan: ${escapeHtml(parkingText)}</p>
          <p class="meta">Vehicle: ${escapeHtml(entry.vehicleNo || "-")}</p>
          <p class="meta">Overnight: ${escapeHtml(overnightLabel)}</p>
          <p class="meta">Submitted: ${formatTimestamp(entry.createdAt)}</p>
        </div>
        <div class="row right">
          <button class="btn" data-action="approve-request" data-id="${escapeHtml(requestId)}">Approve</button>
          <button class="btn btn-danger" data-action="reject-request" data-id="${escapeHtml(requestId)}">Reject</button>
        </div>
      </div>
    `;
  }).join("");
}

async function approveVisitorRequest(requestId, button) {
  if (!canManagePendingRequests()) return;
  setButtonLoading(button, true, "Approving...");

  try {
    const requestRef = doc(db, "visitor_requests", requestId);
    const requestSnap = await getDoc(requestRef);
    if (!requestSnap.exists()) {
      showGlobalError("Request not found.");
      return;
    }

    const requestData = requestSnap.data() || {};
    if (String(requestData.status || "").toLowerCase() !== "pending") {
      showGlobalError("Request is already processed.");
      return;
    }

    const visitCode = await generateUniqueVisitCode();
    const hostOwnerUid = await resolveHostOwnerUidByUnit(requestData.hostName || "");
    const parking = requestData.parkingRequested
      ? await allocateAvailableParking(visitCode, "occupied", requestData.preferredParkingSlot || "")
      : { slotId: "", slotLabel: "" };

    const expiresAt = new Date(Date.now() + INVITE_CODE_TTL_HOURS * 60 * 60 * 1000);

    await setDoc(doc(db, "preregistrations", visitCode), {
      visitCode,
      visitorName: formatNameWords(requestData.visitorName || ""),
      hostName: requestData.hostName || "",
      hostOwnerUid,
      purpose: normalizeVisitPurpose(requestData.purpose || "") || "guest",
      expectedTime: requestData.expectedTime || [requestData.expectedDate, requestData.expectedClock].filter(Boolean).join(" "),
      expectedDate: requestData.expectedDate || "",
      expectedClock: requestData.expectedClock || "",
      idNumber: requestData.idNumber || "",
      phone: requestData.phone || "",
      vehicleNo: formatCarPlate(requestData.vehicleNo || ""),
      parkingRequested: requestData.parkingRequested !== false,
      preferredParkingSlot: requestData.preferredParkingSlot || "",
      parkingSlotId: parking.slotId,
      parkingSlotLabel: parking.slotLabel,
      parkingStatus: requestData.parkingRequested
        ? (parking.slotId ? "occupied" : "waitlist")
        : "not_required",
      overnightParkingRequested: !!requestData.overnightParkingRequested,
      status: "checked_in",
      expiresAt,
      createdAt: serverTimestamp(),
      bookingTimestamp: serverTimestamp(),
      checkedInAt: serverTimestamp(),
      createdBy: currentUser?.uid || "",
      source: "visitor_request",
      requestRefId: requestId
    });

    await setDoc(doc(db, "visitor_logs", visitCode), {
      visitCode,
      visitorName: formatNameWords(requestData.visitorName || ""),
      hostName: requestData.hostName || "",
      hostOwnerUid,
      purpose: normalizeVisitPurpose(requestData.purpose || "") || "guest",
      idNumber: requestData.idNumber || "",
      phone: requestData.phone || "",
      vehicleNo: formatCarPlate(requestData.vehicleNo || ""),
      parkingRequested: requestData.parkingRequested !== false,
      overnightParkingRequested: !!requestData.overnightParkingRequested,
      expectedTime: requestData.expectedTime || [requestData.expectedDate, requestData.expectedClock].filter(Boolean).join(" "),
      expectedDate: requestData.expectedDate || "",
      expectedClock: requestData.expectedClock || "",
      parkingSlotId: parking.slotId,
      parkingSlotLabel: parking.slotLabel,
      parkingStatus: requestData.parkingRequested
        ? (parking.slotId ? "occupied" : "waitlist")
        : "not_required",
      status: "inside",
      source: "visitor_request",
      bookingTimestamp: serverTimestamp(),
      checkedInAt: serverTimestamp(),
      checkedOutAt: null,
      checkedInBy: currentUser?.uid || ""
    });

    await updateDoc(requestRef, {
      status: "approved",
      approvedAt: serverTimestamp(),
      approvedBy: currentUser?.uid || "",
      linkedVisitCode: visitCode
    });

    showGlobalSuccess(`Request approved and checked in. Visit code: ${visitCode}`);
    await refreshData();
  } catch (error) {
    console.error(error);
    showGlobalError(`Unable to approve request. ${friendlyFirestoreError(error)}`);
  } finally {
    setButtonLoading(button, false);
  }
}

async function rejectVisitorRequest(requestId, button) {
  if (!canManagePendingRequests()) return;
  setButtonLoading(button, true, "Rejecting...");

  try {
    await updateDoc(doc(db, "visitor_requests", requestId), {
      status: "rejected",
      rejectedAt: serverTimestamp(),
      rejectedBy: currentUser?.uid || ""
    });
    showGlobalSuccess("Request rejected.");
    await refreshData();
  } catch (error) {
    console.error(error);
    showGlobalError(`Unable to reject request. ${friendlyFirestoreError(error)}`);
  } finally {
    setButtonLoading(button, false);
  }
}

function filteredLogs() {
  const scopedLogs = getReportScopedLogs(logsCache);
  const term = activeSearch.trim().toLowerCase();
  const filtered = !term ? scopedLogs : scopedLogs.filter((entry) => {
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

  return sortLogs(filtered);
}

function applySearch() {
  activeSearch = ui.searchInput?.value.trim() || "";
  logsPageIndex = 0;
  renderLogs(filteredLogs());
}

function sortLogs(list) {
  const mode = ui.logSortField?.value || "checkedInDesc";
  const sorted = [...list];

  if (mode === "checkedInAsc") {
    return sorted.sort((a, b) => (toDate(a.checkedInAt)?.getTime() || 0) - (toDate(b.checkedInAt)?.getTime() || 0));
  }
  if (mode === "visitorAZ") {
    return sorted.sort((a, b) => String(a.visitorName || "").localeCompare(String(b.visitorName || "")));
  }
  if (mode === "hostAZ") {
    return sorted.sort((a, b) => String(a.hostName || "").localeCompare(String(b.hostName || "")));
  }
  if (mode === "statusAZ") {
    return sorted.sort((a, b) => String(a.status || "").localeCompare(String(b.status || "")));
  }
  if (mode === "parkingAZ") {
    return sorted.sort((a, b) => String(a.parkingSlotLabel || "").localeCompare(String(b.parkingSlotLabel || ""), undefined, { numeric: true }));
  }

  return sorted.sort((a, b) => (toDate(b.checkedInAt)?.getTime() || 0) - (toDate(a.checkedInAt)?.getTime() || 0));
}

function renderStats() {
  if (!ui.statsRow) return;
  if (!canViewStats()) {
    ui.statsRow.innerHTML = "";
    toggle(ui.statsRow, false);
    return;
  }
  toggle(ui.statsRow, true);

  const reportLogs = getReportScopedLogs(logsCache);

  const insideCount = reportLogs.filter(isInside).length;
  const checkedOut = reportLogs.filter((entry) => !isInside(entry)).length;
  const preregCount = getReportScopedPrereg(preregCache).length;
  const manualCount = reportLogs
    .filter((entry) => String(entry.source || "").toLowerCase() === "manual").length;

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

  const inside = getActiveVisitors();
  if (!inside.length) {
    ui.currentList.innerHTML = '<div class="item"><div><strong>No visitors currently inside.</strong><p class="meta">New check-ins will appear here.</p></div></div>';
    return;
  }

  ui.currentList.innerHTML = inside.map((entry) => {
    const checkoutBtn = canCheckOut() ? `<button class="btn" data-action="checkout" data-id="${entry.id}">Check Out</button>` : "";
    const overnightLabel = entry.overnightParkingRequested ? "Yes" : "No";
    return `
      <div class="item">
        <div>
          <strong>${escapeHtml(entry.visitorName || "Unknown visitor")}</strong>
          <p class="meta">Host: ${escapeHtml(entry.hostName || "-")}</p>
          <p class="meta">Vehicle: ${escapeHtml(entry.vehicleNo || "-")}</p>
          <p class="meta">Overnight: ${escapeHtml(overnightLabel)}</p>
          <p class="meta">Parking: ${escapeHtml(entry.parkingSlotLabel || "Unassigned")} (${escapeHtml(entry.parkingStatus || "-")})</p>
          <p class="meta">In: ${formatTimestamp(entry.checkedInAt)}</p>
        </div>
        <div class="row">${checkoutBtn}</div>
      </div>
    `;
  }).join("");
}

function getActiveVisitors() {
  const activeLogs = logsCache.filter(isInside);
  const activeCodes = new Set(activeLogs.map((entry) => String(entry.visitCode || entry.id || "").trim()).filter(Boolean));
  const checkedInPreregs = preregCache
    .filter((entry) => String(entry.status || "").toLowerCase() === "checked_in")
    .filter((entry) => {
      const code = String(entry.visitCode || entry.id || "").trim();
      return code && !activeCodes.has(code);
    })
    .map((entry) => ({
      id: entry.visitCode || entry.id,
      visitCode: entry.visitCode || entry.id,
      visitorName: entry.visitorName || "Unknown visitor",
      hostName: entry.hostName || "-",
      vehicleNo: entry.vehicleNo || "",
      overnightParkingRequested: !!entry.overnightParkingRequested,
      parkingSlotLabel: entry.parkingSlotLabel || "Unassigned",
      parkingStatus: entry.parkingSlotId ? "occupied" : (entry.parkingRequested === false ? "not_required" : "waitlist"),
      checkedInAt: entry.checkedInAt || entry.bookingTimestamp || entry.createdAt || null,
      source: entry.source || "prereg"
    }));

  return [...activeLogs, ...checkedInPreregs];
}

function renderLogs(list) {
  if (!ui.logsList) return;

  if (!list.length) {
    ui.logsList.innerHTML = '<div class="item"><div><strong>No records found.</strong><p class="meta">Try a different search keyword.</p></div></div>';
    if (ui.logsPagination) ui.logsPagination.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(list.length / LOGS_PAGE_SIZE));
  if (logsPageIndex >= totalPages) logsPageIndex = totalPages - 1;
  if (logsPageIndex < 0) logsPageIndex = 0;

  const start = logsPageIndex * LOGS_PAGE_SIZE;
  const end = start + LOGS_PAGE_SIZE;
  const visible = list.slice(start, end);
  const hasPrev = logsPageIndex > 0;
  const hasNext = logsPageIndex < totalPages - 1;

  ui.logsList.innerHTML = visible.map((entry) => {
    const status = isInside(entry) ? "Inside" : "Checked out";
    const overnightLabel = entry.overnightParkingRequested ? "Yes" : "No";
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
          <p class="meta">Overnight: ${escapeHtml(overnightLabel)}</p>
          <p class="meta">Parking: ${escapeHtml(entry.parkingSlotLabel || "Unassigned")} (${escapeHtml(entry.parkingStatus || "-")})</p>
          <p class="meta">Vehicle: ${escapeHtml(entry.vehicleNo || "-")} | ${escapeHtml(status)} | ${escapeHtml(entry.source || "-")}</p>
          <p class="meta">In: ${formatTimestamp(entry.checkedInAt)}${entry.checkedOutAt ? ` | Out: ${formatTimestamp(entry.checkedOutAt)}` : ""}</p>
        </div>
        <div class="row">${actions.join("")}</div>
      </div>
    `;
  }).join("");

  if (ui.logsPagination) {
    ui.logsPagination.innerHTML = `
      <div class="row logs-pager-row">
        <button class="btn" data-action="logs-page-prev" type="button" ${hasPrev ? "" : "disabled"}>Prev</button>
        <p class="meta">Page ${logsPageIndex + 1} of ${totalPages} | Showing ${start + 1}-${start + visible.length} of ${list.length}</p>
        <button class="btn" data-action="logs-page-next" type="button" ${hasNext ? "" : "disabled"}>Next</button>
      </div>
    `;
  }
}

function renderAdminInsights() {
  const reportLogs = getReportScopedLogs(logsCache);

  if (ui.summaryBox) {
    const todayCount = reportLogs.filter((entry) => isSameDay(entry.checkedInAt, new Date())).length;
    const insideCount = reportLogs.filter(isInside).length;
    const outCount = reportLogs.length - insideCount;
    const uniqueHosts = new Set(reportLogs.map((entry) => (entry.hostName || "").trim()).filter(Boolean)).size;

    ui.summaryBox.innerHTML = [
      summaryTile("Total records", reportLogs.length),
      summaryTile("Today check-ins", todayCount),
      summaryTile("Inside now", insideCount),
      summaryTile("Unique hosts", uniqueHosts),
      summaryTile("Checked out", outCount),
      summaryTile("Manual check-ins", reportLogs.filter((entry) => entry.source === "manual").length)
    ].join("");
  }

  if (ui.topHosts) {
    const counter = new Map();
    reportLogs.forEach((entry) => {
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

function formatDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateInput(value, endOfDay = false) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  return parsed;
}

function reportRangeText(start, end) {
  if (!start && !end) return "Showing all records.";
  if (start && end) {
    return `Showing ${formatDateOnly(start)} to ${formatDateOnly(end)}.`;
  }
  if (start) return `Showing from ${formatDateOnly(start)}.`;
  return `Showing up to ${formatDateOnly(end)}.`;
}

function getReportDateRange() {
  const start = parseDateInput(ui.reportFromDate?.value || "", false);
  const end = parseDateInput(ui.reportToDate?.value || "", true);
  if (start && end && start.getTime() > end.getTime()) {
    return { start: end, end: start };
  }
  return { start, end };
}

function inReportRange(value, start, end) {
  const stamp = toDate(value);
  if (!stamp) return false;
  const time = stamp.getTime();
  if (start && time < start.getTime()) return false;
  if (end && time > end.getTime()) return false;
  return true;
}

function getReportScopedLogs(list) {
  if (!ui.reportFromDate && !ui.reportToDate) return [...list];

  const { start, end } = getReportDateRange();
  if (!start && !end) return [...list];
  return list.filter((entry) => inReportRange(entry.checkedInAt, start, end));
}

function getReportScopedPrereg(list) {
  if (!ui.reportFromDate && !ui.reportToDate) return [...list];
  if (!(currentRole === "admin" || currentRole === "management")) return [...list];

  const { start, end } = getReportDateRange();
  if (!start && !end) return [...list];
  return list.filter((entry) => {
    const sourceDate = entry.createdAt || entry.bookingTimestamp || entry.expectedDate || null;
    return inReportRange(sourceDate, start, end);
  });
}

function getReportScopedRequests(list) {
  if (!ui.reportFromDate && !ui.reportToDate) return [...list];
  if (!(currentRole === "admin" || currentRole === "management")) return [...list];

  const { start, end } = getReportDateRange();
  if (!start && !end) return [...list];
  return list.filter((entry) => inReportRange(entry.createdAt || entry.bookingTimestamp, start, end));
}

function markReportPresetButton(preset) {
  if (!ui.reportPresetBar) return;
  ui.reportPresetBar.querySelectorAll("button[data-report-range]").forEach((button) => {
    button.classList.toggle("active", String(button.dataset.reportRange || "") === preset);
  });
}

function refreshReportViews() {
  logsPageIndex = 0;
  if (ui.reportRangeLabel) {
    const { start, end } = getReportDateRange();
    ui.reportRangeLabel.textContent = reportRangeText(start, end);
  }
  renderStats();
  renderLogs(filteredLogs());
  renderAdminInsights();
}

function applyReportPreset(preset) {
  if (!ui.reportFromDate || !ui.reportToDate) return;

  reportPreset = preset;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === "today") {
    ui.reportFromDate.value = formatDateInputValue(todayStart);
    ui.reportToDate.value = formatDateInputValue(todayStart);
  } else if (preset === "yesterday") {
    const yesterday = new Date(todayStart);
    yesterday.setDate(yesterday.getDate() - 1);
    ui.reportFromDate.value = formatDateInputValue(yesterday);
    ui.reportToDate.value = formatDateInputValue(yesterday);
  } else if (preset === "last7") {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 6);
    ui.reportFromDate.value = formatDateInputValue(start);
    ui.reportToDate.value = formatDateInputValue(todayStart);
  } else if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    ui.reportFromDate.value = formatDateInputValue(start);
    ui.reportToDate.value = formatDateInputValue(todayStart);
  } else if (preset === "all") {
    ui.reportFromDate.value = "";
    ui.reportToDate.value = "";
  }

  markReportPresetButton(preset);
  refreshReportViews();
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
    if (isInviteExpired(prereg)) {
      showGlobalError("This invitation code has expired.");
      return;
    }

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
      hostOwnerUid: prereg.hostOwnerUid || "",
      purpose: prereg.purpose || "",
      idNumber: prereg.idNumber || "",
      phone: prereg.phone || "",
      vehicleNo: prereg.vehicleNo || "",
      parkingRequested: prereg.parkingRequested !== false,
      overnightParkingRequested: !!prereg.overnightParkingRequested,
      expectedTime: prereg.expectedTime || [prereg.expectedDate, prereg.expectedClock].filter(Boolean).join(" "),
      expectedDate: prereg.expectedDate || "",
      expectedClock: prereg.expectedClock || "",
      parkingSlotId,
      parkingSlotLabel,
      parkingStatus: parkingSlotId ? "occupied" : "waitlist",
      status: "inside",
      source: "prereg",
      bookingTimestamp: prereg.bookingTimestamp || prereg.createdAt || serverTimestamp(),
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
    showGlobalError(`Unable to check in by code. ${friendlyFirestoreError(error)}`);
  } finally {
    setButtonLoading(button, false);
  }
}

async function manualCheckIn() {
  if (!canCheckIn()) return;

  const button = get("manualCheckInBtn");
  if (button?.disabled) return;

  const visitorName = formatNameWords((get("manualVisitor")?.value || "").trim());
  const hostName = (get("manualHost")?.value || "").trim();
  const purpose = normalizeVisitPurpose(get("manualPurpose")?.value || "");
  const parkingNeeded = (get("manualParkingNeeded")?.value || "").trim().toLowerCase();
  const idNumber = (get("manualId")?.value || "").trim();
  const phone = (get("manualPhone")?.value || "").trim();
  const vehicleNo = formatCarPlate((get("manualVehicle")?.value || "").trim());
  const preferredParkingSlot = normalizeParkingSlot(get("manualParkingSlot")?.value || "");
  const parkingRequested = shouldRequestParking(purpose, parkingNeeded);

  if (!visitorName || !hostName || !purpose || !vehicleNo) {
    showGlobalError("Visitor name, unit number, purpose, and vehicle number are required.");
    return;
  }

  if (purpose !== "guest" && !["yes", "no"].includes(parkingNeeded)) {
    showGlobalError("Please select whether a parking slot is needed.");
    return;
  }

  setButtonLoading(button, true, "Checking In...");
  try {
    const visitCode = await generateUniqueVisitCode();
    const hostOwnerUid = await resolveHostOwnerUidByUnit(hostName);
    const parking = parkingRequested
      ? await allocateAvailableParking(visitCode, "occupied", preferredParkingSlot)
      : { slotId: "", slotLabel: "" };
    await setDoc(doc(db, "visitor_logs", visitCode), {
      visitCode,
      visitorName,
      hostName,
      hostOwnerUid,
      purpose,
      idNumber,
      phone,
      vehicleNo,
      parkingRequested,
      preferredParkingSlot,
      parkingSlotId: parking.slotId,
      parkingSlotLabel: parking.slotLabel,
      parkingStatus: parkingRequested ? (parking.slotId ? "occupied" : "waitlist") : "not_required",
      status: "inside",
      source: "manual",
      checkedInAt: serverTimestamp(),
      bookingTimestamp: serverTimestamp(),
      checkedOutAt: null,
      checkedInBy: currentUser?.uid || ""
    });

    clearInputs(["manualVisitor", "manualHost", "manualParkingNeeded", "manualId", "manualPhone", "manualVehicle", "manualParkingSlot"]);
    const manualPurpose = get("manualPurpose");
    if (manualPurpose) manualPurpose.value = "guest";
    syncAllPurposeParkingUi();
    showGlobalSuccess(`Manual check-in created. Visit code: ${visitCode}`);
    await refreshData();
  } catch (error) {
    console.error(error);
    showGlobalError(`Unable to complete manual check-in. ${friendlyFirestoreError(error)}`);
  } finally {
    setButtonLoading(button, false);
  }
}

async function createPreregistration() {
  if (!canCreatePrereg()) return;

  const button = get("createPreregBtn");
  if (button?.disabled) return;

  const visitorName = formatNameWords((get("hostVisitor")?.value || "").trim());
  const hostName = (get("hostName")?.value || "").trim();
  const purpose = normalizeVisitPurpose(get("hostPurpose")?.value || "");
  const parkingNeeded = (get("hostParkingNeeded")?.value || "").trim().toLowerCase();
  const expectedDate = (get("hostExpectedDate")?.value || "").trim();
  const expectedClock = (get("hostExpectedTime")?.value || "").trim();
  const expectedTime = [expectedDate, expectedClock].filter(Boolean).join(" ");
  const idNumber = (get("hostId")?.value || "").trim();
  const phone = (get("hostPhone")?.value || "").trim() || String(currentHostProfile?.phone || "").trim();
  const vehicleNo = formatCarPlate((get("hostVehicle")?.value || "").trim());
  const preferredParkingSlot = normalizeParkingSlot(get("hostParkingSlot")?.value || "");
  const overnightParkingRequested = !!get("hostOvernightParking")?.checked;
  const parkingRequested = shouldRequestParking(purpose, parkingNeeded);

  if (!visitorName || !hostName || !purpose || !vehicleNo) {
    showGlobalError("Visitor name, unit number, purpose, and vehicle number are required.");
    return;
  }

  if (purpose !== "guest" && !["yes", "no"].includes(parkingNeeded)) {
    showGlobalError("Please select whether a parking slot is needed.");
    return;
  }

  setButtonLoading(button, true, "Generating...");
  try {
    const visitCode = await generateUniqueVisitCode();
    const parking = parkingRequested
      ? await allocateAvailableParking(visitCode, "reserved", preferredParkingSlot)
      : { slotId: "", slotLabel: "" };
    const expiresAt = new Date(Date.now() + INVITE_CODE_TTL_HOURS * 60 * 60 * 1000);
    await setDoc(doc(db, "preregistrations", visitCode), {
      visitCode,
      visitorName,
      hostName,
      hostOwnerUid: currentRole === "host" ? (currentUser?.uid || "") : "",
      purpose,
      expectedTime,
      expectedDate,
      expectedClock,
      idNumber,
      phone,
      vehicleNo,
      parkingRequested,
      preferredParkingSlot,
      parkingSlotId: parking.slotId,
      parkingSlotLabel: parking.slotLabel,
      parkingStatus: parkingRequested ? (parking.slotId ? "reserved" : "waitlist") : "not_required",
      overnightParkingRequested,
      source: "host_prereg",
      status: "pending",
      expiresAt,
      createdAt: serverTimestamp(),
      bookingTimestamp: serverTimestamp(),
      createdBy: currentUser?.uid || ""
    });

    clearInputs(["hostVisitor", "hostParkingNeeded", "hostExpectedDate", "hostExpectedTime", "hostId", "hostPhone", "hostVehicle", "hostParkingSlot"]);
    const hostPurpose = get("hostPurpose");
    if (hostPurpose) hostPurpose.value = "guest";
    const overnightParking = get("hostOvernightParking");
    if (overnightParking) overnightParking.checked = false;
    applyHostProfileToForm();
    syncAllPurposeParkingUi();
    showLatestPreregCode(visitCode);
    showGlobalSuccess(`Pre-registration created. Share code: ${visitCode}`);
    await refreshData();
  } catch (error) {
    console.error(error);
    showGlobalError(`Unable to create pre-registration. ${friendlyFirestoreError(error)}`);
  } finally {
    setButtonLoading(button, false);
  }
}

async function submitVisitorRequest() {
  const button = ui.visitorSubmitBtn;
  if (button?.disabled) return;

  const inviteCode = (get("visitorInviteCodeInput")?.value || "").trim().toUpperCase();
  const visitorName = formatNameWords((get("visitorNameInput")?.value || "").trim());
  const hostName = (get("visitorHostInput")?.value || "").trim();
  const purpose = normalizeVisitPurpose(get("visitorPurposeInput")?.value || "");
  const parkingNeeded = (get("visitorParkingNeeded")?.value || "").trim().toLowerCase();
  const phone = (get("visitorPhoneInput")?.value || "").trim();
  const expectedDate = (get("visitorDateInput")?.value || "").trim();
  const expectedClock = (get("visitorTimeInput")?.value || "").trim();
  const expectedTime = [expectedDate, expectedClock].filter(Boolean).join(" ");
  const idNumber = (get("visitorIdInput")?.value || "").trim();
  const vehicleNo = formatCarPlate((get("visitorVehicleInput")?.value || "").trim());
  const preferredParkingSlot = normalizeParkingSlot(get("visitorParkingSlot")?.value || "");
  const parkingRequested = shouldRequestParking(purpose, parkingNeeded);

  if (!visitorName || !hostName || !purpose || !vehicleNo) {
    showGlobalError("Visitor name, host/unit, purpose, and vehicle number are required.");
    return;
  }

  if (purpose !== "guest" && !["yes", "no"].includes(parkingNeeded)) {
    showGlobalError("Please select whether a parking slot is needed.");
    return;
  }

  setButtonLoading(button, true, "Submitting...");
  try {
    await addDoc(collection(db, "visitor_requests"), {
      inviteCode,
      visitorName,
      hostName,
      purpose,
      phone,
      expectedDate,
      expectedClock,
      expectedTime,
      idNumber,
      vehicleNo,
      parkingRequested,
      preferredParkingSlot: parkingRequested ? preferredParkingSlot : "",
      status: "pending",
      source: "public",
      createdAt: serverTimestamp(),
      bookingTimestamp: serverTimestamp()
    });

    clearInputs([
      "visitorInviteCodeInput",
      "visitorNameInput",
      "visitorHostInput",
      "visitorParkingNeeded",
      "visitorPhoneInput",
      "visitorDateInput",
      "visitorTimeInput",
      "visitorIdInput",
      "visitorVehicleInput",
      "visitorParkingSlot"
    ]);
    const visitorPurpose = get("visitorPurposeInput");
    if (visitorPurpose) visitorPurpose.value = "guest";
    syncAllPurposeParkingUi();
    showGlobalSuccess("Request submitted. Please wait for host/admin confirmation.");
  } catch (error) {
    console.error(error);
    showGlobalError("Unable to submit request. Please try again.");
  } finally {
    setButtonLoading(button, false);
  }
}

async function autofillVisitorByInviteCode() {
  const input = get("visitorInviteCodeInput");
  if (!input) return;

  const inviteCode = String(input.value || "").trim().toUpperCase();
  input.value = inviteCode;
  if (!inviteCode) return;

  try {
    const preregSnap = await getDoc(doc(db, "preregistrations", inviteCode));
    if (!preregSnap.exists()) {
      showGlobalError("Invitation code not found. Please check and try again.");
      return;
    }

    const prereg = preregSnap.data() || {};
    if (isInviteExpired(prereg)) {
      showGlobalError("This invitation code has expired.");
      return;
    }

    const status = String(prereg.status || "").toLowerCase();
    if (status && status !== "pending") {
      showGlobalError("This invitation code is no longer active.");
      return;
    }

    setValueIfExists("visitorNameInput", prereg.visitorName || "");
    setValueIfExists("visitorHostInput", prereg.hostName || "");

    const purpose = normalizeVisitPurpose(prereg.purpose || "") || "guest";
    setValueIfExists("visitorPurposeInput", purpose);

    const parkingRequested = prereg.parkingRequested !== false;
    if (purpose !== "guest") {
      setValueIfExists("visitorParkingNeeded", parkingRequested ? "yes" : "no");
    } else {
      setValueIfExists("visitorParkingNeeded", "");
    }

    syncAllPurposeParkingUi();

    const preferredParkingSlot = normalizeParkingSlot(prereg.preferredParkingSlot || prereg.parkingSlotId || "");
    if (preferredParkingSlot) {
      setValueIfExists("visitorParkingSlot", preferredParkingSlot);
    }

    setValueIfExists("visitorDateInput", prereg.expectedDate || "");
    setValueIfExists("visitorTimeInput", prereg.expectedClock || "");
    setValueIfExists("visitorIdInput", prereg.idNumber || "");
    setValueIfExists("visitorPhoneInput", prereg.phone || "");
    setValueIfExists("visitorVehicleInput", prereg.vehicleNo || "");

    showGlobalSuccess("Invitation code matched. Form auto-filled.");
  } catch (error) {
    console.error(error);
    showGlobalError(`Unable to auto-fill by invitation code. ${friendlyFirestoreError(error)}`);
  }
}

function setValueIfExists(id, value) {
  const element = get(id);
  if (!element) return;
  element.value = value;
}

function resolveVehicleForVisit(visitCode) {
  const code = String(visitCode || "").trim();
  if (!code) return "";

  const fromLogs = logsCache.find((entry) => String(entry.visitCode || entry.id || "").trim() === code);
  if (fromLogs?.vehicleNo) return fromLogs.vehicleNo;

  const fromPrereg = preregCache.find((entry) => String(entry.visitCode || entry.id || "").trim() === code);
  if (fromPrereg?.vehicleNo) return fromPrereg.vehicleNo;

  return "";
}

function isInviteExpired(prereg) {
  const expiry = toDate(prereg?.expiresAt);
  if (expiry) return expiry.getTime() < Date.now();

  const created = toDate(prereg?.createdAt);
  if (!created) return false;
  return (created.getTime() + INVITE_CODE_TTL_HOURS * 60 * 60 * 1000) < Date.now();
}

function formatNameWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trimStart()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function formatCarPlate(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trimStart();
}

function confirmCheckout(id) {
  openConfirm(
    "Check Out Visitor",
    "This marks the visitor as checked out.",
    async () => {
      try {
        const logRef = doc(db, "visitor_logs", id);
        const logSnap = await getDoc(logRef);
        const visitCode = logSnap.exists() ? (logSnap.data().visitCode || id) : id;

        if (logSnap.exists()) {
          await updateDoc(logRef, {
            checkedOutAt: serverTimestamp(),
            status: "checked_out",
            parkingStatus: "released",
            checkedOutBy: currentUser?.uid || ""
          });
        }

        const preregRef = doc(db, "preregistrations", visitCode);
        const preregSnap = await getDoc(preregRef);
        const preregData = preregSnap.exists() ? (preregSnap.data() || {}) : {};

        if (!logSnap.exists()) {
          await setDoc(logRef, {
            visitCode,
            visitorName: preregData.visitorName || "",
            hostName: preregData.hostName || "",
            purpose: preregData.purpose || "",
            idNumber: preregData.idNumber || "",
            phone: preregData.phone || "",
            vehicleNo: preregData.vehicleNo || "",
            parkingRequested: preregData.parkingRequested !== false,
            overnightParkingRequested: !!preregData.overnightParkingRequested,
            expectedTime: preregData.expectedTime || [preregData.expectedDate, preregData.expectedClock].filter(Boolean).join(" "),
            expectedDate: preregData.expectedDate || "",
            expectedClock: preregData.expectedClock || "",
            parkingSlotId: preregData.parkingSlotId || "",
            parkingSlotLabel: preregData.parkingSlotLabel || "",
            parkingStatus: "released",
            status: "checked_out",
            source: preregData.source || "prereg",
            bookingTimestamp: preregData.bookingTimestamp || preregData.createdAt || serverTimestamp(),
            checkedInAt: preregData.checkedInAt || preregData.bookingTimestamp || preregData.createdAt || serverTimestamp(),
            checkedOutAt: serverTimestamp(),
            checkedOutBy: currentUser?.uid || ""
          });
        }

        if (preregSnap.exists()) {
          await updateDoc(preregRef, {
            status: "checked_out",
            checkedOutAt: serverTimestamp(),
            parkingStatus: "released"
          });
        }

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

async function loadEditableProfile(uid) {
  if (!uid) return {};

  const merged = {};
  try {
    const usersSnapshot = await getDoc(doc(db, "users", uid));
    if (usersSnapshot.exists()) {
      Object.assign(merged, usersSnapshot.data() || {});
    }
  } catch (error) {
    console.warn("Could not read users profile:", error.message || error);
  }

  const scopedCollection = currentRole === "host"
    ? "host"
    : (currentRole === "admin" || currentRole === "management" ? "admin" : "");

  if (scopedCollection) {
    try {
      const scopedSnapshot = await getDoc(doc(db, scopedCollection, uid));
      if (scopedSnapshot.exists()) {
        Object.assign(merged, scopedSnapshot.data() || {});
      }
    } catch (error) {
      console.warn(`Could not read ${scopedCollection} profile:`, error.message || error);
    }
  }

  return merged;
}

async function openProfileModal() {
  if (!ui.profileModal) return;

  if (ui.profileSaveBtn) {
    ui.profileSaveBtn.disabled = true;
    ui.profileSaveBtn.textContent = "Loading...";
  }

  const profile = await loadEditableProfile(currentUser?.uid || "");
  const profileName = String(profile.name || currentHostProfile?.name || currentUser?.displayName || "").trim();
  const profileEmail = String(profile.email || currentUser?.email || "").trim();
  const profilePhone = String(profile.phone || currentHostProfile?.phone || "").trim();
  const profileUnit = String(profile.unitNumber || currentHostProfile?.unitNumber || "").trim();

  if (ui.profileName) ui.profileName.value = profileName;
  if (ui.profileEmail) ui.profileEmail.value = profileEmail;
  if (ui.profilePhone) ui.profilePhone.value = profilePhone;
  
  if (ui.profileUnitWrap && currentRole === "host") {
    ui.profileUnitWrap.style.display = "block";
    if (ui.profileUnit) ui.profileUnit.value = profileUnit;
  } else if (ui.profileUnitWrap) {
    ui.profileUnitWrap.style.display = "none";
  }
  
  if (ui.profileError) {
    ui.profileError.textContent = "";
    ui.profileError.classList.add("hidden");
    ui.profileError.classList.remove("success-text");
    ui.profileError.classList.add("error-text");
  }
  
  toggle(ui.profileModal, true);
  ui.profileModal.setAttribute("aria-hidden", "false");

  if (ui.profileSaveBtn) {
    ui.profileSaveBtn.disabled = false;
    ui.profileSaveBtn.textContent = "Save Changes";
  }
}

function closeProfileModal() {
  if (!ui.profileModal) return;
  toggle(ui.profileModal, false);
  ui.profileModal.setAttribute("aria-hidden", "true");
}

async function saveProfile() {
  if (!currentUser) return;
  
  const profileName = (ui.profileName?.value || "").trim();
  const profileEmail = (ui.profileEmail?.value || "").trim().toLowerCase();
  const profilePhone = (ui.profilePhone?.value || "").trim();
  const profileUnit = currentRole === "host" ? (ui.profileUnit?.value || "").trim() : "";
  
  if (!profileName) {
    showProfileError("Full name is required.");
    return;
  }
  
  if (currentRole === "host" && !profileUnit) {
    showProfileError("Unit number is required.");
    return;
  }

  if (!profileEmail) {
    showProfileError("Email is required.");
    return;
  }

  if (!/^\S+@\S+\.\S+$/.test(profileEmail)) {
    showProfileError("Please enter a valid email address.");
    return;
  }

  if (profilePhone && !/^[0-9+\-\s()]{6,20}$/.test(profilePhone)) {
    showProfileError("Phone format looks invalid.");
    return;
  }
  
  ui.profileSaveBtn.disabled = true;
  ui.profileSaveBtn.textContent = "Saving...";
  try {
    const currentEmail = String(currentUser.email || "").trim().toLowerCase();
    if (profileEmail !== currentEmail) {
      await updateEmail(currentUser, profileEmail);
    }

    const currentDisplayName = String(currentUser.displayName || "").trim();
    if (profileName && profileName !== currentDisplayName) {
      await updateProfile(currentUser, { displayName: profileName });
    }

    const updates = {
      name: profileName,
      email: profileEmail,
      phone: profilePhone,
      updatedAt: serverTimestamp()
    };
    
    if (currentRole === "host") {
      updates.unitNumber = profileUnit;
    }

    const roleForUsers = currentRole === "management" ? "admin" : currentRole;
    const usersUpdates = { ...updates, role: roleForUsers };
    await setDoc(doc(db, "users", currentUser.uid), usersUpdates, { merge: true });

    const scopedCollection = currentRole === "host"
      ? "host"
      : (currentRole === "admin" || currentRole === "management" ? "admin" : "");

    if (scopedCollection) {
      await setDoc(doc(db, scopedCollection, currentUser.uid), updates, { merge: true });
    }

    if (currentRole === "host") {
      await loadHostProfile(currentUser.uid);
      applyHostProfileToForm();
    } else {
      currentHostProfile = { ...(currentHostProfile || {}), ...updates };
    }

    currentUser = auth.currentUser || currentUser;

    updateUIState();
    await refreshData();
    showProfileSuccess("Profile updated successfully!");
    showGlobalSuccess("Profile updated successfully!");
    setTimeout(() => {
      closeProfileModal();
    }, 900);
  } catch (error) {
    console.error(error);
    if ((error?.code || "") === "auth/requires-recent-login") {
      showProfileError("For security, please sign out and sign in again before changing email.");
    } else {
      showProfileError(`Unable to save profile. ${friendlyFirestoreError(error)}`);
    }
  } finally {
    ui.profileSaveBtn.disabled = false;
    ui.profileSaveBtn.textContent = "Save Changes";
  }
}

function showProfileError(message) {
  if (!ui.profileError) return;
  ui.profileError.textContent = message;
  ui.profileError.classList.remove("success-text");
  ui.profileError.classList.add("error-text");
  ui.profileError.classList.remove("hidden");
}

function showProfileSuccess(message) {
  if (!ui.profileError) return;
  ui.profileError.textContent = message;
  ui.profileError.classList.remove("error-text");
  ui.profileError.classList.add("success-text");
  ui.profileError.classList.remove("hidden");
}

function showAuthError(message, section = "login") {
  if (section === "all") {
    if (ui.loginError) {
      ui.loginError.textContent = message;
      toggle(ui.loginError, !!message);
    }
    if (ui.registerError) {
      ui.registerError.textContent = message;
      toggle(ui.registerError, !!message);
    }
    return;
  }

  const target = section === "register" ? ui.registerError : ui.loginError;
  if (!target) return;
  target.textContent = message;
  toggle(target, !!message);
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
    if (isError) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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

async function loadHostProfile(uid) {
  currentHostProfile = null;
  if (!uid) return;

  try {
    const hostSnapshot = await getDoc(doc(db, "host", uid));
    if (hostSnapshot.exists()) {
      currentHostProfile = hostSnapshot.data() || null;
      return;
    }
  } catch (error) {
    console.warn("Could not read from host collection:", error.message);
  }

  try {
    const usersSnapshot = await getDoc(doc(db, "users", uid));
    if (usersSnapshot.exists()) {
      const data = usersSnapshot.data() || {};
      if (String(data.role || "").toLowerCase() === "host" || data.unitNumber) {
        currentHostProfile = data;
      }
    }
  } catch (error) {
    console.warn("Could not read from users collection:", error.message);
  }
}

function applyHostProfileToForm() {
  const unitInput = get("hostName");
  const phoneInput = get("hostPhone");
  if (!unitInput || !currentHostProfile) return;

  const unitNumber = String(currentHostProfile.unitNumber || "").trim();
  if (unitNumber) {
    unitInput.value = unitNumber;
    unitInput.readOnly = true;
  }

  if (phoneInput && !String(phoneInput.value || "").trim()) {
    const phone = String(currentHostProfile.phone || "").trim();
    if (phone) phoneInput.value = phone;
  }
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

  if ((ui.loginError || ui.authError) && pageName === "home") {
    showAuthError(message, "login");
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
  if (code === "auth/email-already-in-use") {
    return "This email is already registered. Please sign in instead.";
  }
  if (code === "auth/weak-password") {
    return "Use a stronger password (at least 6 characters).";
  }
  return "Login failed. Please try again.";
}

function normalizeVisitPurpose(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (VISIT_PURPOSES.includes(normalized)) return normalized;
  return "";
}

function shouldRequestParking(purpose, parkingNeeded) {
  if (purpose === "guest") return true;
  return parkingNeeded === "yes";
}

function showLatestPreregCode(visitCode) {
  if (!ui.preregCodePanel || !ui.preregCodeValue) return;
  ui.preregCodeValue.textContent = visitCode || "-";
  toggle(ui.preregCodePanel, true);
}

async function copyLatestPreregCode() {
  const code = String(ui.preregCodeValue?.textContent || "").trim();
  if (!code || code === "-") {
    showGlobalError("No invite code to copy yet.");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      const input = document.createElement("input");
      input.value = code;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    showGlobalSuccess(`Invite code copied: ${code}`);
  } catch (error) {
    console.error(error);
    showGlobalError("Unable to copy invite code. Please copy it manually.");
  }
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

function canManagePendingRequests() {
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

  const dateText = formatDateOnly(value);
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");

  return `${dateText} ${hour}:${minute}`;
}

function formatDateOnly(input) {
  const value = toDate(input);
  if (!value) return "-";

  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = value.getFullYear();

  return `${day}/${month}/${year}`;
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

  // Avoid index-sensitive orderBy queries by sorting available docs client-side.
  const snapshot = await getDocs(
    query(
      collection(db, "parking_slots"),
      where("status", "==", "available"),
      limit(PARKING_SLOT_COUNT + 20)
    )
  );

  const picked = snapshot.docs
    .map((entry) => ({ id: entry.id, ref: entry.ref, ...entry.data() }))
    .sort((a, b) => parkingSlotOrder(a) - parkingSlotOrder(b))[0];

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
    slotLabel: picked.label || picked.id
  };
}

function friendlyFirestoreError(error) {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("permission-denied")) {
    return "Permission denied by Firestore rules for this account.";
  }
  if (code.includes("failed-precondition")) {
    return "Firestore index/precondition not met. Please refresh and try again.";
  }
  if (code.includes("unavailable")) {
    return "Firebase service is temporarily unavailable.";
  }
  return "Please check browser console for details.";
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
  if (/^P\d{1,3}$/.test(raw)) return `P${raw.slice(1).padStart(2, "0")}`;
  if (/^\d{1,2}$/.test(raw)) {
    const slotNo = Number(raw);
    if (slotNo >= 1 && slotNo <= PARKING_SLOT_COUNT) return parkingSlotId(slotNo);
  }
  return "";
}

function parkingSlotOrder(slot) {
  const fromNumber = Number(slot?.slotNo);
  if (Number.isFinite(fromNumber) && fromNumber > 0) return fromNumber;

  const label = String(slot?.slotId || slot?.label || slot?.value || slot?.id || "").toUpperCase();
  const match = label.match(/(\d{1,3})/);
  if (match) return Number(match[1]);

  return Number.MAX_SAFE_INTEGER;
}

function slotValue(slot) {
  const direct = normalizeParkingSlot(slot?.value || slot?.slotId || slot?.label || "");
  if (direct) return direct;

  const fromNo = Number(slot?.slotNo);
  if (Number.isFinite(fromNo) && fromNo > 0) return parkingSlotId(fromNo);

  const fromId = normalizeParkingSlot(slot?.id || "");
  return fromId || String(slot?.id || "");
}

function getSortedParkingSlots() {
  return [...parkingSlotsCache].sort((a, b) => {
    const delta = parkingSlotOrder(a) - parkingSlotOrder(b);
    if (delta !== 0) return delta;
    return slotValue(a).localeCompare(slotValue(b), undefined, { numeric: true, sensitivity: "base" });
  });
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
  if (!element) return;
  element.classList.toggle("hidden", !visible);
  if (visible) observeRevealTargets(element);
}

bootstrap();
