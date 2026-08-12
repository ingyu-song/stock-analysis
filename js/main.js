import { initPosition } from "./position.js";
import { initAnalysis } from "./analysis.js";
import { initMarket } from "./market.js";
import { initClaudeTab } from "./claude-tab.js";

const TAB_NAMES = ["position", "analysis", "market", "claude"];

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
    const name = location.hash.replace("#", "");
    if (TAB_NAMES.includes(name)) activate(name);
  });

  const fromHash = location.hash.replace("#", "");
  activate(TAB_NAMES.includes(fromHash) ? fromHash : "position");
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
initTheme();
initPosition();
initAnalysis();
initMarket();
initClaudeTab();
