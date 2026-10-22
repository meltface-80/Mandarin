/* The page's core (app.js until v1.0.5), 30 of 33: the refresh button, and the filter sheet. */
// ----- Boot -----
refreshBtn.addEventListener("click", loadRandom);

// ----- Filter sheet (All / Genre / Tag) -----
(() => {
  const overlay      = document.getElementById("filter-overlay");
  const toggleBtn    = document.getElementById("filter-toggle");
  const allBtn       = document.getElementById("filter-all");
  const allCheck     = overlay && overlay.querySelector('.filter-check[data-for="all"]');
  const genresToggle = document.getElementById("filter-genres-toggle");
  const genresList   = document.getElementById("filter-genres-list");
  const tagsToggle   = document.getElementById("filter-tags-toggle");
  const tagsList     = document.getElementById("filter-tags-list");
  const decadesToggle = document.getElementById("filter-decades-toggle");
  const decadesList   = document.getElementById("filter-decades-list");
  if (!overlay || !toggleBtn) return;

  function markActive() {
    toggleBtn.classList.toggle("is-active", !!activeFilter);
    if (allCheck) allCheck.classList.toggle("hidden", !!activeFilter);
    for (const el of overlay.querySelectorAll(".filter-item")) {
      const t = el.dataset.ftype, v = el.dataset.fvalue;
      el.classList.toggle("is-current",
        !!activeFilter && activeFilter.type === t && activeFilter.value === v);
    }
  }

  function applyFilter(f) {
    activeFilter = f;
    try {
      if (f) localStorage.setItem("rra-filter", JSON.stringify(f));
      else   localStorage.removeItem("rra-filter");
    } catch (e) { /* localStorage optional (private browsing) */ }
    if (window.__exitLabels) window.__exitLabels();
    if (window.__exitArtists) window.__exitArtists();
    markActive();
    close();
    if (!f && nativeWallOpened("random")) return;   // the Android app's own random wall (item 52)
    if (window.__showWall) window.__showWall();   // reveal the album grid (leave Home)
    updateCountReadout(null);
    loadRandom();
  }
  window.__applyFilter = applyFilter;   // used by the Home "Browse by genre" cards

  function renderList(container, type, rows) {
    container.innerHTML = "";
    if (!rows.length) {
      const d = document.createElement("div");
      d.className = "filter-empty";
      d.textContent = type === "genre" ? "No genres found"
                    : (type === "tag" ? "No tags found"
                    : "No decades yet — release years fill in as the label scan runs.");
      container.appendChild(d);
      return;
    }
    for (const row of rows) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "filter-item";
      b.dataset.ftype = type;
      b.dataset.fvalue = row.title;
      const t = document.createElement("span");
      t.className = "filter-item-title";
      t.textContent = row.title;
      b.appendChild(t);
      if (row.subtitle) {
        const sub = document.createElement("span");
        sub.className = "filter-item-sub";
        sub.textContent = row.subtitle;
        b.appendChild(sub);
      }
      b.addEventListener("click", () => applyFilter({ type, value: row.title }));
      container.appendChild(b);
    }
    markActive();
  }

  const loaded = { genre: false, tag: false, decade: false };
  async function ensureList(type) {
    if (loaded[type]) return;
    const container = type === "genre" ? genresList : (type === "tag" ? tagsList : decadesList);
    container.innerHTML = '<div class="filter-empty">Loading\u2026</div>';
    try {
      const url = type === "genre" ? "/api/filters/genres"
                : (type === "tag" ? "/api/filters/tags" : "/api/filters/decades");
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      const rows = type === "genre" ? j.genres : (type === "tag" ? j.tags : j.decades);
      renderList(container, type, rows || []);
      loaded[type] = true;
    } catch (e) {
      container.innerHTML = "";
      const d = document.createElement("div");
      d.className = "filter-empty";
      d.textContent = "Couldn't load: " + e.message;
      container.appendChild(d);
    }
  }

  function wireSection(toggle, list, type) {
    toggle.addEventListener("click", async () => {
      const willOpen = list.classList.contains("hidden");
      list.classList.toggle("hidden", !willOpen);
      toggle.setAttribute("aria-expanded", String(willOpen));
      toggle.classList.toggle("is-open", willOpen);
      if (willOpen) await ensureList(type);
    });
  }
  wireSection(genresToggle, genresList, "genre");
  wireSection(tagsToggle,   tagsList,   "tag");
  wireSection(decadesToggle, decadesList, "decade");

  function open()  { overlay.classList.remove("hidden"); markActive(); }
  function close() { overlay.classList.add("hidden"); }

  toggleBtn.addEventListener("click", open);
  allBtn.addEventListener("click", () => applyFilter(null));
  overlay.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("[data-filter-close]")) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });

  markActive();
})();
