// Stock Analysis tab: list the reports published on IGS Research.
// Both sites live on ingyu-song.github.io, so the feed is same-origin; a new report there shows up here on its own.
const FEED = "https://ingyu-song.github.io/igs-research/reports.json";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function card(r) {
  const tags = [r.sector, r.size].filter(Boolean).map(t => `<span class="report-tag">${esc(t)}</span>`).join("");
  const opinion = r.opinion ? `<span class="report-opinion">${esc(r.opinion)}</span>` : "";
  return `
    <a class="card report-card" href="${esc(r.url)}" target="_blank" rel="noopener">
      <div class="report-top">
        <span class="report-type">${esc(r.type)}</span>
        <span class="report-meta">${opinion}<span class="report-date">${esc(r.date)}</span></span>
      </div>
      <h2 class="report-title">${esc(r.title)}</h2>
      ${r.subtitle ? `<p class="report-sub">${esc(r.subtitle)}</p>` : ""}
      ${r.summary ? `<p class="report-summary">${esc(r.summary)}</p>` : ""}
      ${tags ? `<div class="report-tags">${tags}</div>` : ""}
    </a>`;
}

export async function initReports() {
  const root = document.getElementById("reportList");
  if (!root) return;
  try {
    const res = await fetch(FEED, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const reports = await res.json();
    root.innerHTML = reports.length
      ? reports.map(card).join("")
      : `<p class="panel-sub">No reports yet.</p>`;
  } catch {
    root.innerHTML = `<p class="panel-sub">Couldn't load the report list. Open <a href="https://ingyu-song.github.io/igs-research/#sector" target="_blank" rel="noopener">IGS Research</a> instead.</p>`;
  }
}
