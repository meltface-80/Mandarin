/* The page's core (app.js until v1.0.5), 9 of 33: the Library wall's controls: its filter, Focus and Sort. */
// Roon's own phone layout for this row: Focus on the left behind a chevron,
// the current Sort on the right behind a caret, and NOTHING between them.
//
// The separate direction arrow is gone. It was a third boxed control sitting
// between two others, and Roon has no equivalent — direction is a property of
// the sort, so it belongs in the sort menu, which has flipped it on a re-tap
// since v1.6.59. The row still SHOWS the direction (and the reshuffle glyph
// for Random) as part of the sort's own label, so nothing is hidden; it just
// isn't its own button any more.
// (libFilterOpen is declared with the other view flags near the top: since
// v0.6.5 showHome() and friends reach it through hideLibraryControls().)

function renderLibraryControls() {
  let bar = document.getElementById("library-controls");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "library-controls";
    // Its own row under the top bar's (v0.6.24): smaller pills, Focus on
    // the left, Sort and the magnifier on the right. Inside .topbar, which
    // lies over the scroller, so the row stays put while the grid scrolls,
    // and the bar's measured height reserves its room.
    bar.className = "library-controls sub-bar";
    const tb = document.querySelector(".topbar");
    const row = document.querySelector(".topbar-row");
    if (tb && row) row.insertAdjacentElement("afterend", bar);
    else grid.parentNode.insertBefore(bar, grid);
  }
  // The search glass stays in the top bar's row, at its right-hand end and
  // the bar's size (v0.6.5); open, the field takes that row as Home's does.
  let filt = document.getElementById("library-filter");
  if (!filt) {
    filt = document.createElement("div");
    filt.id = "library-filter";
    filt.className = "library-filter in-topbar";
    const row = document.querySelector(".topbar-row");
    const before = document.getElementById("labels-tools");
    if (row) row.insertBefore(filt, before && before.parentNode === row ? before : null);
    else bar.appendChild(filt);
  }
  // Both controls open a sheet rather than mutating the view in place, so a
  // rebuild can no longer land under the user's finger mid-interaction — but
  // applyLibView() still rebuilds this row while the sort sheet is open and
  // focus is inside it, and dropping focus to <body> then would strand a
  // keyboard user. Restoring by class is enough: there are two controls and
  // they are rebuilt in a fixed order.
  // Restored by the control's OWN class, not its first one. Every control
  // here starts with `lib-ctl`, so splitting on the first token matched
  // whichever came first in the DOM — focus on Sort came back on Focus.
  const act = document.activeElement;
  const refocus = act && (bar.contains(act) || filt.contains(act)) && act.className
    ? (String(act.className).split(" ").find(c => c !== "lib-ctl" && c) || "lib-ctl")
    : null;
  // Typing survives the rebuild applyLibView() does after every keystroke.
  // `libFilterOpen` is the truth; the live node is only consulted for where
  // the caret was.
  const typing = filt.querySelector(".lib-filter-input");
  const caret = typing ? typing.selectionStart : 0;

  bar.innerHTML = "";
  filt.innerHTML = "";
  // Focus left, Sort right in their row; the magnifier that narrows the
  // list in the bar's row above.
  bar.appendChild(buildLibFocusButton());
  bar.appendChild(buildLibSortButton());
  filt.appendChild(buildLibFilterControl(libFilterOpen));
  bar.classList.toggle("hidden", !libraryWallActive);
  filt.classList.toggle("hidden", !libraryWallActive);
  filt.classList.toggle("is-filtering", libFilterOpen);
  // Marks the bar as the Library wall's, for the phone rule that gives the
  // title's room to the controls.
  { const tb = document.querySelector(".topbar"); if (tb) tb.classList.toggle("lib-wall", libraryWallActive); }
  // Drives the layout: Sort's auto margin is released while the field is
  // open so the input, not the margin, gets the row's free space.
  bar.classList.toggle("is-filtering", libFilterOpen);
  // The open field takes the bar, title included, as Home's search does.
  { const tb = document.querySelector(".topbar");
    if (tb) tb.classList.toggle("lib-filtering", libFilterOpen && libraryWallActive); }

  if (libFilterOpen) {
    const again = filt.querySelector(".lib-filter-input");
    if (again) {
      again.focus();
      try { again.setSelectionRange(caret, caret); }
      catch (e) { /* type="search" refuses setSelectionRange on some engines */ }
    }
  } else if (refocus) {
    const again = bar.querySelector("." + refocus) || filt.querySelector("." + refocus);
    if (again) again.focus();
  }
}

// The funnel: a text filter that narrows the wall by the first letters of an
// album title OR an artist name.
//
// A user asked for an A-Z rail down the edge of the screen. That works only
// while the wall is sorted alphabetically, which is why it broke under the
// other sorts — a letter index means nothing when the order is by year or
// play count. Filtering is orthogonal to sorting, so this works under all of
// them, and it reaches artists as well as titles, which a rail cannot.
function buildLibFilterControl(open) {
  const wrap = document.createElement("div");
  wrap.className = "lib-filter-wrap";

  if (!open) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lib-filter-btn lib-ctl icon-btn" + (libView.prefix ? " is-active" : "");
    btn.setAttribute("aria-label", "Filter by name");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><circle cx="11" cy="11" r="7"/>' +
      '<line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      libFilterOpen = true;
      renderLibraryControls();
    });
    wrap.appendChild(btn);
    return wrap;
  }

  // The field as Home's search draws it: a pill with the glass, the input and
  // an ×. The × clears the text when there is any, and closes the field when
  // there is none (v0.6.5).
  const box = document.createElement("div");
  box.className = "search-box lib-filter-box";
  box.innerHTML = '<svg class="search-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const input = document.createElement("input");
  input.type = "search";
  input.className = "lib-filter-input";
  input.value = libView.prefix || "";
  input.placeholder = "Starts with…";
  input.setAttribute("aria-label", "Filter albums and artists by first letters");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("input", () => {
    libView.prefix = input.value.trim();
    applyLibView();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLibFilter();
  });
  const x = document.createElement("button");
  x.type = "button";
  x.className = "search-clear lib-filter-clear";
  x.setAttribute("aria-label", "Clear the filter");
  x.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M18 6 6 18M6 6l12 12"/></svg>';
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!input.value.trim()) { closeLibFilter(); return; }
    input.value = "";
    libView.prefix = "";
    applyLibView();
  });
  box.appendChild(input);
  box.appendChild(x);
  wrap.appendChild(box);
  return wrap;
}

// Tap away closes AND clears, the same contract the topbar search follows.
// A filter left applied behind a closed funnel is a wall that looks broken.
function closeLibFilter() {
  if (!libFilterOpen) return;
  libFilterOpen = false;
  const had = !!libView.prefix;
  libView.prefix = "";
  if (had) applyLibView();
  else renderLibraryControls();
}
document.addEventListener("click", (e) => {
  if (!libFilterOpen) return;
  if (e.target.closest && e.target.closest(".lib-filter-wrap")) return;
  closeLibFilter();
});

// `› Focus`, with the number of active facets when there are any. The count
// is the only state this control carries — what those facets ARE is the
// sheet's job, and spelling them out here would wrap onto three lines on a
// phone the moment more than one is on.
function buildLibFocusButton() { return buildFocusCtl(libFocusCount(), () => openLibFocusSheet(null)); }
// The control itself, for any wall with a Focus (the Library's; Music on
// device's since v0.7.4): `n` active filters, `onClick` opens its sheet.
function buildFocusCtl(n, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lib-ctl lib-ctl-focus" + (n ? " is-active" : "");

  const chev = document.createElement("span");
  chev.className = "lib-ctl-chevron";
  chev.setAttribute("aria-hidden", "true");
  chev.textContent = "›";
  b.appendChild(chev);

  const text = document.createElement("span");
  text.className = "lib-ctl-text";
  text.textContent = "Focus";
  b.appendChild(text);

  if (n) {
    const badge = document.createElement("span");
    badge.className = "lib-ctl-badge";
    badge.textContent = String(n);
    b.appendChild(badge);
  }
  b.setAttribute("aria-label", n
    ? "Focus — " + n + (n === 1 ? " filter active" : " filters active")
    : "Focus");
  // Wrapped, not passed by reference: the listener hands its callback an
  // event, which would arrive as editTarget and be treated as a playlist to
  // save over.
  b.addEventListener("click", () => onClick());
  return b;
}

// `Album name ↑ ⌄`. The arrow is a LABEL here, not a control — it says which
// way the current sort runs, and tapping anywhere on the button opens the
// sheet where it can be changed.
function buildLibSortButton() {
  // Random has no direction to show, so the slot carries the reshuffle glyph
  // instead — the same symbol the sort sheet's Random row re-taps to.
  return buildSortCtl(libSortLabel(), libSortHasDir(libView.sort) ? (libView.dir === "desc" ? "↓" : "↑") : "⟳",
    libSortHasDir(libView.sort) ? "Sort — " + libSortLabel() + ", " + libDirLabel() : "Sort — " + libSortLabel(),
    openLibSortSheet);
}
function buildSortCtl(label, arrowText, aria, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lib-ctl lib-ctl-sort";

  const text = document.createElement("span");
  text.className = "lib-ctl-text";
  text.textContent = label;
  b.appendChild(text);

  const arrow = document.createElement("span");
  arrow.className = "lib-ctl-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = arrowText;
  b.appendChild(arrow);

  const caret = document.createElement("span");
  caret.className = "lib-ctl-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "⌄";
  b.appendChild(caret);

  b.setAttribute("aria-label", aria);
  b.addEventListener("click", () => onClick());
  return b;
}

// One sheet builder for both — same bottom-sheet language as the filter and
// settings sheets, built as live nodes (never restored from an HTML string).
// `onClose` fires on EVERY dismissal path — X, backdrop, and the footer
// buttons — so a caller that mutated shared state on open can undo it.
// A name for something: the page's own dialog (the WebView has no prompt box).
const askName = (message, initial) =>
  window.__promptDialog ? window.__promptDialog(message, initial) : Promise.resolve(window.prompt(message, initial));
function openLibSheet(title, buildBody, footer, onClose) {
  const back = document.createElement("div");
  back.className = "lib-sheet-backdrop";
  const sheet = document.createElement("div");
  sheet.className = "lib-sheet";
  const head = document.createElement("div");
  head.className = "lib-sheet-head";
  const h = document.createElement("h3"); h.textContent = title;
  const x = document.createElement("button");
  x.type = "button"; x.className = "icon-btn"; x.setAttribute("aria-label", "Close");
  x.textContent = "✕";
  head.appendChild(h); head.appendChild(x);
  const body = document.createElement("div");
  body.className = "lib-sheet-body";
  sheet.appendChild(head); sheet.appendChild(body);
  const close = () => { back.remove(); if (onClose) onClose(); };
  buildBody(body, close);
  if (footer) {
    const f = document.createElement("div");
    f.className = "lib-sheet-foot";
    footer(f, close);
    sheet.appendChild(f);
  }
  x.addEventListener("click", close);
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.appendChild(sheet);
  document.body.appendChild(back);
}
