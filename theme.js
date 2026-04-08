const THEME_STORAGE_KEY = "unix-theme";
const DEFAULT_THEME = "dark";
const LIGHT_THEME = "light";
const THEME_SWITCH_CLASS = "theme-switching";

export function getStoredTheme() {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === LIGHT_THEME ? LIGHT_THEME : DEFAULT_THEME;
  } catch (error) {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme = DEFAULT_THEME, options = {}) {
  const { persist = true, animate = false } = options;
  const safeTheme = theme === LIGHT_THEME ? LIGHT_THEME : DEFAULT_THEME;
  const root = document.documentElement;

  root.setAttribute("data-theme", safeTheme);
  root.style.colorScheme = safeTheme === LIGHT_THEME ? "light" : "dark";

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, safeTheme);
    } catch (error) {
      // Ignore storage write failures.
    }
  }

  if (animate) {
    root.classList.remove(THEME_SWITCH_CLASS);
    void root.offsetWidth;
    root.classList.add(THEME_SWITCH_CLASS);
    window.setTimeout(() => {
      root.classList.remove(THEME_SWITCH_CLASS);
    }, 720);
  }

  syncThemeToggleState(document);
  window.dispatchEvent(new CustomEvent("unix-theme-change", { detail: { theme: safeTheme } }));
  return safeTheme;
}

export function toggleTheme() {
  const nextTheme = getStoredTheme() === LIGHT_THEME ? DEFAULT_THEME : LIGHT_THEME;
  return applyTheme(nextTheme, { persist: true, animate: true });
}

export function syncThemeToggleState(root = document) {
  const theme = getStoredTheme();
  root.querySelectorAll("[data-theme-toggle]").forEach((toggle) => {
    const isLight = theme === LIGHT_THEME;
    toggle.setAttribute("aria-pressed", String(isLight));
    toggle.setAttribute("data-active-theme", theme);
    const label = toggle.querySelector("[data-theme-toggle-label]");
    if (label) {
      label.textContent = isLight ? "Dark Mode" : "Light Mode";
    }
  });
}

export function initThemeToggle(root = document) {
  syncThemeToggleState(root);
  root.querySelectorAll("[data-theme-toggle]").forEach((toggle) => {
    if (toggle.dataset.themeToggleBound === "true") return;
    toggle.dataset.themeToggleBound = "true";
    toggle.addEventListener("click", () => {
      toggleTheme();
    });
  });
}

applyTheme(getStoredTheme(), { persist: false, animate: false });

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initThemeToggle(document);
  });
}
