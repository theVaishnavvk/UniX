import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { initThemeToggle } from "./theme.js";

const NAVBAR_PROFILE_CACHE_KEY = "unix-navbar-profile";

async function initNavbar() {
  const navbarContainer = document.getElementById("navbar-container");
  if (!navbarContainer) return;

  const pathStr = window.location.pathname;
  let depth = 0;
  if (pathStr.includes("/pages/tutoring/")) depth = 2;
  else if (pathStr.includes("/pages/")) depth = 1;

  const rootPrefix = depth === 2 ? "../../" : (depth === 1 ? "../" : "");

  const fallbackPaths = Array.from(new Set([
    `${rootPrefix}navbar.html`,
    "/navbar.html"
  ]));

  try {
    let html = "";
    let loaded = false;

    for (const path of fallbackPaths) {
      if(!path) continue;
      try {
        const response = await fetch(path);
        if (!response.ok) continue;
        html = await response.text();
        loaded = true;
        break;
      } catch (fetchError) {
        // Try next fallback
      }
    }

    if (!loaded || !html.trim()) {
      throw new Error("Navbar markup could not be loaded from known paths.");
    }

    renderNavbar(html, depth);
    initThemeToggle(navbarContainer);
    setupNavLogic(depth, rootPrefix);

  } catch (error) {
    console.error("Error loading navbar:", error);
  }
}

document.addEventListener("DOMContentLoaded", initNavbar);

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeSources(sources = []) {
  return (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
}

function readNavbarProfileCache(uid = "") {
  const safeUid = normalizeText(uid, "");
  if (!safeUid || typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(NAVBAR_PROFILE_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || normalizeText(parsed.uid, "") !== safeUid) {
      return null;
    }

    return {
      uid: safeUid,
      name: normalizeText(parsed.name, ""),
      photoURL: normalizeText(parsed.photoURL, ""),
      points: Number.isFinite(Number(parsed.points)) ? Number(parsed.points) : null
    };
  } catch (error) {
    console.warn("Navbar profile cache read skipped:", error);
    return null;
  }
}

function writeNavbarProfileCache(uid, name, avatarUrl = "", points = null) {
  const safeUid = normalizeText(uid, "");
  if (!safeUid || typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const existingCache = readNavbarProfileCache(safeUid);
    const safePoints = Number(points);
    window.localStorage.setItem(NAVBAR_PROFILE_CACHE_KEY, JSON.stringify({
      uid: safeUid,
      name: normalizeText(name, "User"),
      photoURL: normalizeText(avatarUrl, ""),
      points: Number.isFinite(safePoints)
        ? safePoints
        : (Number.isFinite(Number(existingCache?.points)) ? Number(existingCache.points) : 0)
    }));
  } catch (error) {
    console.warn("Navbar profile cache write skipped:", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveDisplayName(userData = {}, authUser = null, fallbackSources = []) {
  const candidates = [];
  const sources = [userData, ...normalizeSources(fallbackSources)];

  for (const source of sources) {
    candidates.push(
      source?.name,
      source?.displayName,
      source?.username,
      source?.fullName,
      source?.userName
    );
  }

  candidates.push(authUser?.displayName);

  for (const value of candidates) {
    const normalized = normalizeText(value, "");
    if (normalized) return normalized;
  }

  const email = [
    ...sources.map((source) => normalizeText(source?.email, "")),
    normalizeText(authUser?.email, "")
  ].find(Boolean) || "";

  return email.includes("@") ? email.split("@")[0] : "User";
}

function resolveAvatarUrl(userData = {}, authUser = null, fallbackSources = []) {
  const candidates = [];
  const sources = [userData, ...normalizeSources(fallbackSources)];

  for (const source of sources) {
    candidates.push(
      source?.photoURL,
      source?.avatarUrl,
      source?.profileImage,
      source?.profilePhoto,
      source?.imageUrl
    );
  }

  candidates.push(authUser?.photoURL);

  for (const value of candidates) {
    const normalized = normalizeText(value, "");
    if (normalized) return normalized;
  }

  return "";
}

function resolvePointsValue(...sources) {
  for (const source of sources) {
    const numericValue = Number(source?.points);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return 0;
}

function renderNavbarProfile(name, avatarUrl = "") {
  const navNameEl = document.getElementById("usernameValue");
  if (navNameEl) {
    navNameEl.textContent = normalizeText(name, "User");
  }

  const navAvatarEl = document.getElementById("navProfileAvatar");
  if (!navAvatarEl) return;

  const safeName = normalizeText(name, "User");
  const safeAvatarUrl = normalizeText(avatarUrl, "");
  navAvatarEl.classList.toggle("has-photo", Boolean(safeAvatarUrl));
  navAvatarEl.innerHTML = safeAvatarUrl
    ? `<img src="${escapeHtml(safeAvatarUrl)}" alt="${escapeHtml(safeName)}">`
    : safeName.charAt(0).toUpperCase();
}

function renderNavbarPoints(points = 0) {
  const navPointsEl = document.getElementById("navPointsValue");
  if (!navPointsEl) return;
  const safePoints = Number(points);
  navPointsEl.textContent = Number.isFinite(safePoints) ? String(safePoints) : "0";
}

async function syncPublicProfileMirror(uid, userData = {}) {
  const safeUid = normalizeText(uid, "");
  if (!safeUid) return;

  const publicRef = doc(db, "publicUsers", safeUid);
  const publicSnap = await getDoc(publicRef);
  if (!publicSnap.exists()) return;

  const publicData = publicSnap.data() || {};
  const payload = {
    name: resolveDisplayName(userData),
    photoURL: resolveAvatarUrl(userData) || null,
    tagline: normalizeText(userData?.tagline, "") || null,
    role: normalizeText(userData?.role, "") || null
  };

  const isUnchanged =
    normalizeText(publicData?.name, "") === normalizeText(payload.name, "") &&
    normalizeText(publicData?.photoURL, "") === normalizeText(payload.photoURL, "") &&
    normalizeText(publicData?.tagline, "") === normalizeText(payload.tagline, "") &&
    normalizeText(publicData?.role, "") === normalizeText(payload.role, "");

  if (isUnchanged) return;

  await setDoc(publicRef, payload, { merge: true });
}

function renderNavbar(html, depth) {
  const navbarContainer = document.getElementById("navbar-container");
  let finalHtml = html;

  if (depth === 0) { // Root level
    finalHtml = finalHtml.replace(/href="([^"]+\.html)"/g, (match, p1) => {
      if (p1 === "index.html" || p1 === "home.html" || p1 === "login.html" || p1 === "signup.html") {
        return `href="${p1}"`;
      }
      return `href="pages/${p1}"`;
    });
  } else if (depth === 2) { // 2 levels deep (/pages/tutoring/)
    finalHtml = finalHtml.replace(/href="([^"]+\.html)"/g, (match, p1) => {
      if (p1 === "index.html" || p1 === "home.html" || p1 === "login.html" || p1 === "signup.html") {
        return `href="../../${p1}"`;
      }
      return `href="../${p1}"`; 
    });
  } else { // 1 level deep (/pages/)
    finalHtml = finalHtml.replace(/href="([^"]+\.html)"/g, (match, p1) => {
      if (p1 === "index.html" || p1 === "home.html" || p1 === "login.html" || p1 === "signup.html") {
        return `href="../${p1}"`;
      }
      return `href="${p1}"`;
    });
  }

  navbarContainer.innerHTML = finalHtml;
}

function setupNavLogic(depth, rootPrefix) {
  setupMobileMenu();

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut(auth);
      window.location.href = `${rootPrefix}index.html`;
    });
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (
        depth > 0 &&
        !window.location.pathname.includes("login.html") &&
        !window.location.pathname.includes("signup.html") &&
        !window.location.pathname.includes("about.html")
      ) {
        window.location.href = `${rootPrefix}login.html`;
      }
      return;
    }

    const cachedProfile = readNavbarProfileCache(user.uid);
    const optimisticName = resolveDisplayName({}, user, [cachedProfile]);
    const optimisticAvatarUrl = resolveAvatarUrl({}, user, [cachedProfile]);
    const optimisticPoints = resolvePointsValue(cachedProfile);
    renderNavbarProfile(optimisticName, optimisticAvatarUrl);
    renderNavbarPoints(optimisticPoints);

    try {
      const usernameValue = document.getElementById("usernameValue");
      const adminNavLink = document.getElementById("adminNavLink");

      const userRef = doc(db, "users", user.uid);
      const publicUserRef = doc(db, "publicUsers", user.uid);
      const [userSnap, publicSnap] = await Promise.allSettled([
        getDoc(userRef),
        getDoc(publicUserRef)
      ]);

      const privateData =
        userSnap.status === "fulfilled" && userSnap.value.exists()
          ? (userSnap.value.data() || {})
          : null;
      const publicData =
        publicSnap.status === "fulfilled" && publicSnap.value.exists()
          ? (publicSnap.value.data() || {})
          : null;
      const resolvedName = resolveDisplayName(privateData || {}, user, [publicData, cachedProfile]);
      const resolvedAvatarUrl = resolveAvatarUrl(privateData || {}, user, [publicData, cachedProfile]);
      const resolvedPoints = resolvePointsValue(privateData, publicData, cachedProfile);

      if (usernameValue) usernameValue.textContent = resolvedName;
      renderNavbarPoints(resolvedPoints);
      renderNavbarProfile(resolvedName, resolvedAvatarUrl);
      writeNavbarProfileCache(user.uid, resolvedName, resolvedAvatarUrl, resolvedPoints);

      if (
        privateData &&
        (
          normalizeText(privateData?.name, "") ||
          normalizeText(privateData?.photoURL, "") ||
          normalizeText(privateData?.tagline, "") ||
          normalizeText(privateData?.role, "")
        )
      ) {
        try {
          await syncPublicProfileMirror(user.uid, privateData);
        } catch (syncError) {
          console.warn("Navbar public profile sync skipped:", syncError);
        }
      }

      const resolvedRole = normalizeText(privateData?.role, "") || normalizeText(publicData?.role, "");
      const resolvedIsAdmin = privateData?.isAdmin === true || publicData?.isAdmin === true;

      if (adminNavLink && (resolvedRole === "Admin" || resolvedIsAdmin || user.email === "admin@unix.com" || user.email === "vaishnav@unix.com")) {
        adminNavLink.style.display = "flex";
      }
    } catch (error) {
      console.warn("Navbar user info load failed:", error);
    }

    // Highlight active link
    const currentPage = window.location.pathname.split("/").filter(Boolean).pop() || "index.html";
    document.querySelectorAll(".nav-links a").forEach(link => {
      const href = link.getAttribute("href");
      if (href && href.includes(currentPage)) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      } else {
        link.classList.remove("active");
      }
    });

    // Sub-dropdown Parent Highlights
    if(depth === 2 || window.location.pathname.includes("tutoring")) {
      const tutoringDropdown = document.querySelector('.nav-dropdown-btn');
      if(tutoringDropdown) {
          tutoringDropdown.classList.add('active');
          tutoringDropdown.style.color = "var(--color-primary)";
      }
    }
  });
}

function setupMobileMenu() {
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("navMenu");
  if (!navToggle || !navMenu) return;

  const navIcon = navToggle.querySelector("i");

  const setMenuState = (isOpen) => {
    navMenu.classList.toggle("open", isOpen);
    navToggle.setAttribute("aria-expanded", String(isOpen));
    navToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");

    if (navIcon) {
      navIcon.classList.toggle("fa-bars", !isOpen);
      navIcon.classList.toggle("fa-xmark", isOpen);
    }
  };

  setMenuState(false);

  navToggle.addEventListener("click", () => {
    setMenuState(!navMenu.classList.contains("open"));
  });

  navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setMenuState(false));
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 960 && navMenu.classList.contains("open")) {
      setMenuState(false);
    }
  });
}
