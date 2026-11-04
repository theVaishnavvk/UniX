import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  collection,
  getCountFromServer,
  doc,
  getDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const adminLoader = document.getElementById("adminLoader");
const adminContent = document.getElementById("adminContent");
const adminAccessError = document.getElementById("adminAccessError");

const countUsers = document.getElementById("countUsers");
const countSkills = document.getElementById("countSkills");
const countMarket = document.getElementById("countMarket");
const countLF = document.getElementById("countLF");

const usersTableBody = document.querySelector("#usersTable tbody");
const skillsTableBody = document.querySelector("#skillsTable tbody");
const marketTableBody = document.querySelector("#marketTable tbody");
const lfTableBody = document.querySelector("#lfTable tbody");

const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const adminSections = Array.from(document.querySelectorAll(".admin-section"));

const numberFormatter = new Intl.NumberFormat("en-IN");

let activeSectionId = "";
let activeSectionUnsubscribe = null;

const sectionConfigs = {
  usersSection: {
    id: "usersSection",
    collectionName: "users",
    tableBody: usersTableBody,
    emptyMessage: "No users found.",
    loadErrorMessage: "Could not load users right now.",
    colspan: 6,
    createQuery: () => query(collection(db, "users"), orderBy("createdAt", "desc")),
    renderRow: (docSnap) => {
      const data = docSnap.data() || {};

      return `
        <tr>
          <td>${escapeHTML(data.name || "N/A")}</td>
          <td>${escapeHTML(data.email || "N/A")}</td>
          <td><span class="badge badge-info">${escapeHTML(data.role || "User")}</span></td>
          <td>${formatNumber(data.points || 0)}</td>
          <td>${escapeHTML(formatDateValue(data.createdAt))}</td>
          <td class="action-btns">
            <button class="action-btn delete" onclick='deleteItem(this, "users", ${JSON.stringify(docSnap.id)})' title="Delete User" aria-label="Delete User">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }
  },
  skillsSection: {
    id: "skillsSection",
    collectionName: "requests",
    tableBody: skillsTableBody,
    emptyMessage: "No skill requests found.",
    loadErrorMessage: "Could not load skill requests right now.",
    colspan: 6,
    createQuery: () => query(collection(db, "requests"), orderBy("createdAt", "desc")),
    renderRow: (docSnap) => {
      const data = docSnap.data() || {};
      const status = String(data.status || "open").toLowerCase();
      const urgency = String(data.urgency || "low").toLowerCase();
      const requesterName = data.requesterName || data.userName || "Unknown";

      return `
        <tr>
          <td>${escapeHTML(data.title || "Untitled")}</td>
          <td>${escapeHTML(requesterName)}</td>
          <td><span class="badge ${urgency === "high" ? "badge-danger" : "badge-warning"}">${escapeHTML(urgency)}</span></td>
          <td><span class="badge ${resolveSkillStatusBadge(status)}">${escapeHTML(status.replace(/_/g, " "))}</span></td>
          <td>${formatNumber(data.points || 0)} pts</td>
          <td class="action-btns">
            <button class="action-btn delete" onclick='deleteItem(this, "requests", ${JSON.stringify(docSnap.id)})' title="Delete Request" aria-label="Delete Request">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }
  },
  marketSection: {
    id: "marketSection",
    collectionName: "marketplace",
    tableBody: marketTableBody,
    emptyMessage: "No marketplace listings found.",
    loadErrorMessage: "Could not load marketplace listings right now.",
    colspan: 6,
    createQuery: () => query(collection(db, "marketplace"), orderBy("createdAt", "desc")),
    renderRow: (docSnap) => {
      const data = docSnap.data() || {};
      const status = String(data.status || "active").toLowerCase();

      return `
        <tr>
          <td>${escapeHTML(data.title || "Untitled")}</td>
          <td>${escapeHTML(data.sellerName || data.sellerEmail || "Unknown")}</td>
          <td>Rs. ${formatNumber(data.price || 0)}</td>
          <td>${escapeHTML(data.condition || "N/A")}</td>
          <td><span class="badge ${resolveMarketplaceStatusBadge(status)}">${escapeHTML(status)}</span></td>
          <td class="action-btns">
            <button class="action-btn delete" onclick='deleteItem(this, "marketplace", ${JSON.stringify(docSnap.id)})' title="Delete Listing" aria-label="Delete Listing">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }
  },
  lfSection: {
    id: "lfSection",
    collectionName: "lostItems",
    tableBody: lfTableBody,
    emptyMessage: "No lost & found reports found.",
    loadErrorMessage: "Could not load lost & found reports right now.",
    colspan: 6,
    createQuery: () => query(collection(db, "lostItems"), orderBy("createdAt", "desc")),
    renderRow: (docSnap) => {
      const data = docSnap.data() || {};
      const status = String(data.status || "N/A").toLowerCase();

      return `
        <tr>
          <td>${escapeHTML(data.name || "Untitled")}</td>
          <td>${escapeHTML(data.userName || "Unknown")}</td>
          <td>${escapeHTML(data.location || "N/A")}</td>
          <td><span class="badge ${status === "lost" ? "badge-danger" : "badge-success"}">${escapeHTML(status)}</span></td>
          <td>${escapeHTML(formatDateValue(data.createdAt))}</td>
          <td class="action-btns">
            <button class="action-btn delete" onclick='deleteItem(this, "lostItems", ${JSON.stringify(docSnap.id)})' title="Delete Report" aria-label="Delete Report">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }
  }
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.data() || {};
    const isAdmin =
      userData.role === "Admin" ||
      userData.isAdmin === true ||
      user.email === "admin@unix.com" ||
      user.email === "vaishnav@unix.com";

    if (!isAdmin) {
      adminLoader.style.display = "none";
      adminAccessError.style.display = "block";

      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 3000);

      return;
    }

    adminLoader.style.display = "none";
    adminContent.style.display = "block";
    initAdminDashboard();
  } catch (error) {
    console.error("Admin access verification failed:", error);
    adminLoader.style.display = "none";
    adminAccessError.textContent = "Could not verify admin access right now.";
    adminAccessError.style.display = "block";
  }
});

function initAdminDashboard() {
  setupTabs();
  const defaultSectionId = tabButtons.find((button) => button.classList.contains("active"))?.dataset.target || "usersSection";

  window.requestAnimationFrame(() => {
    loadStats();
    activateSection(defaultSectionId);
  });
}

function setupTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activateSection(button.dataset.target);
    });
  });
}

function activateSection(sectionId) {
  const config = sectionConfigs[sectionId];
  if (!config) return;

  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.target === sectionId);
  });

  adminSections.forEach((section) => {
    section.classList.toggle("active", section.id === sectionId);
  });

  if (activeSectionId === sectionId) {
    return;
  }

  activeSectionId = sectionId;
  subscribeToSection(config);
}

async function loadStats() {
  const targets = [
    { element: countUsers, collectionName: "users" },
    { element: countSkills, collectionName: "requests" },
    { element: countMarket, collectionName: "marketplace" },
    { element: countLF, collectionName: "lostItems" }
  ];

  targets.forEach(({ element }) => {
    element.textContent = "...";
  });

  try {
    const countSnapshots = await Promise.all(
      targets.map(({ collectionName }) => getCountFromServer(collection(db, collectionName)))
    );

    countSnapshots.forEach((snapshot, index) => {
      targets[index].element.textContent = formatNumber(snapshot.data().count || 0);
    });
  } catch (error) {
    console.error("Admin stats load failed:", error);
    targets.forEach(({ element }) => {
      element.textContent = "--";
    });
  }
}

function subscribeToSection(config) {
  if (!config.tableBody) return;

  if (typeof activeSectionUnsubscribe === "function") {
    activeSectionUnsubscribe();
    activeSectionUnsubscribe = null;
  }

  renderTableMessage(config.tableBody, config.colspan, "Loading...");

  activeSectionUnsubscribe = onSnapshot(
    config.createQuery(),
    (snapshot) => {
      if (activeSectionId !== config.id) return;

      if (snapshot.empty) {
        renderTableMessage(config.tableBody, config.colspan, config.emptyMessage);
        return;
      }

      config.tableBody.innerHTML = snapshot.docs.map((docSnap) => config.renderRow(docSnap)).join("");
    },
    (error) => {
      console.error(`Failed to load ${config.collectionName}:`, error);
      renderTableMessage(config.tableBody, config.colspan, config.loadErrorMessage);
    }
  );
}

function renderTableMessage(tableBody, colspan, message) {
  tableBody.innerHTML = `<tr><td colspan="${colspan}" class="no-data">${escapeHTML(message)}</td></tr>`;
}

function resolveSkillStatusBadge(status) {
  if (status === "open") return "badge-success";
  if (status === "in_progress") return "badge-warning";
  return "badge-info";
}

function resolveMarketplaceStatusBadge(status) {
  if (status === "sold" || status === "inactive") return "badge-danger";
  if (status === "reserved" || status === "pending") return "badge-warning";
  return "badge-success";
}

function formatDateValue(value) {
  if (value && typeof value.toDate === "function") {
    return value.toDate().toLocaleDateString();
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString();
    }
  }

  return "N/A";
}

function formatNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return numberFormatter.format(numericValue);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.deleteItem = async function deleteItem(button, collectionName, documentId) {
  if (!collectionName || !documentId) return;

  if (!confirm(`Are you sure you want to delete this from ${collectionName}?`)) {
    return;
  }

  const buttonElement = button instanceof HTMLButtonElement ? button : null;
  const originalButtonHTML = buttonElement ? buttonElement.innerHTML : "";

  try {
    if (buttonElement) {
      buttonElement.disabled = true;
      buttonElement.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    }

    await deleteDoc(doc(db, collectionName, documentId));

    if (collectionName === "users") {
      await deleteDoc(doc(db, "publicUsers", documentId));
    }

    loadStats();
  } catch (error) {
    console.error("Error deleting document:", error);
    alert(`Delete failed: ${error.message}`);
  } finally {
    if (buttonElement && buttonElement.isConnected) {
      buttonElement.disabled = false;
      buttonElement.innerHTML = originalButtonHTML;
    }
  }
};
