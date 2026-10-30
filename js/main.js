import { initPosition } from "./position.js";
import { initPositionLock } from "./lock.js";
import { initPortfolioMap } from "./portfolio-map.js";
import { initAnalysis } from "./analysis.js";
import { initWatchlist } from "./watchlist.js";
import { initClaudeTab } from "./claude-tab.js";
import { makeTableResizable } from "./table-resize.js";

const TAB_NAMES = ["position", "journal", "analysis", "watchlist", "claude"];
// the map used to be its own tab; keep old #map links landing on the position page
const TAB_ALIASES = { map: "position" };

function resolveTab(name) {
  const real = TAB_ALIASES[name] || name;
  return TAB_NAMES.includes(real) ? real : null;
}

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  function activate(name) {
    buttons.forEach(b => {
      const active = b.dataset.tab === name;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    panels.forEach(p => p.classList.toggle("is-active", p.id === `panel-${name}`));
    location.hash = name;
  }

  buttons.forEach(b => b.addEventListener("click", () => activate(b.dataset.tab)));

  window.addEventListener("hashchange", () => {
    const name = resolveTab(location.hash.replace("#", ""));
    if (name) activate(name);
  });

  activate(resolveTab(location.hash.replace("#", "")) || "position");
}

function initTheme() {
  const toggle = document.getElementById("themeToggle");
  const stored = localStorage.getItem("igs-theme");
  if (stored) document.documentElement.setAttribute("data-theme", stored);

  toggle.addEventListener("click", () => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = document.documentElement.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("igs-theme", next);
  });
}

initTabs();
initPositionLock();
initTheme();
initPosition();
initPortfolioMap();
initAnalysis();
initWatchlist();
initClaudeTab();

makeTableResizable(document.getElementById("holdingsTable"), "igs-colwidths-holdings");
makeTableResizable(document.getElementById("claudeHoldingsTable"), "igs-colwidths-claude");
