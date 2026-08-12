const MIN_WIDTH = 32;

function loadWidths(key) {
  try {
    const arr = JSON.parse(localStorage.getItem(key));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function saveWidths(key, widths) {
  localStorage.setItem(key, JSON.stringify(widths));
}

export function makeTableResizable(table, storageKey) {
  if (!table) return;
  const colgroup = table.querySelector("colgroup");
  const cols = colgroup ? Array.from(colgroup.children) : [];
  const ths = Array.from(table.querySelectorAll("thead th"));
  if (!cols.length || cols.length !== ths.length) return;

  // remember each column's HTML-specified width before any saved override,
  // so double-click can reset back to it
  cols.forEach(col => { col.dataset.defaultWidth = col.style.width; });

  const saved = loadWidths(storageKey);
  if (saved && saved.length === cols.length) {
    cols.forEach((col, i) => { col.style.width = `${saved[i]}px`; });
  }

  ths.forEach((th, i) => {
    if (i === ths.length - 1) return; // no handle after the last column

    const handle = document.createElement("div");
    handle.className = "col-resize-handle";
    th.appendChild(handle);

    let startX = 0;
    let startWidth = 0;

    function onMove(e) {
      const dx = e.clientX - startX;
      cols[i].style.width = `${Math.max(MIN_WIDTH, startWidth + dx)}px`;
    }
    function onUp() {
      handle.classList.remove("is-resizing");
      document.body.classList.remove("is-col-resizing");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveWidths(storageKey, cols.map(c => Math.round(c.getBoundingClientRect().width)));
    }
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = cols[i].getBoundingClientRect().width;
      handle.classList.add("is-resizing");
      document.body.classList.add("is-col-resizing");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    handle.addEventListener("dblclick", () => {
      // reset this column to its original HTML-specified width
      cols[i].style.width = cols[i].dataset.defaultWidth || cols[i].style.width;
      saveWidths(storageKey, cols.map(c => Math.round(c.getBoundingClientRect().width)));
    });
  });
}
