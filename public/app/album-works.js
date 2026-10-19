/* The page's core, beside 26 of 33 (bug list item 49): an album's track rows drawn, and a classical album set out as works and movements. */
// ----- The head of a classical album -------------------------------------
// The server names the album's composers, its conductor and who performs it
// (/api/album, item 48). Then the composers stand where the artists do, each
// a link to their page, and under them who performs it, the conductor named
// as such; the artists' line stays for every other album.
function setClassicalHead(j) {
  const a = j.album || {};
  const composers = Array.isArray(a.composers) ? a.composers : [];
  let line = document.getElementById("modal-composers");
  let perf = document.getElementById("modal-performers");
  if (!composers.length) {
    if (line) line.remove();
    if (perf) perf.remove();
    modalSub.classList.remove("hidden");
    return;
  }
  if (!line) {
    line = document.createElement("div");
    line.id = "modal-composers"; line.className = "modal-composers"; line.dataset.parity = "album.composer";   // each link in it is a composer's
    modalSub.parentNode.insertBefore(line, modalSub);
  }
  renderArtistLinks(line, composers.map(name => ({ name, linkable: true })), { separator: " · ", linkClass: "modal-artist-link", sepClass: "modal-subtitle-year" });
  if (!perf) {
    perf = document.createElement("div");
    perf.id = "modal-performers"; perf.className = "modal-performers"; perf.dataset.parity = "album.performers";
    modalSub.parentNode.insertBefore(perf, modalSub);
  }
  const names = (Array.isArray(a.performers) ? a.performers : []).slice();
  if (a.conductor) names.push(a.conductor + ", conductor");
  perf.textContent = names.length ? names.join(" · ") : (a.subtitle || "");
  modalSub.classList.add("hidden");
}

// ----- The tracks, as works where the album has them ---------------------
// Each work's row, a brass ring to play it and its movements under it as
// track rows (the track's number, its name as a movement); a one-track work
// is its own row; the rest of the tracks as they are. A set's discs head the
// list. An album with no works is the plain list it always was.
function renderTrackList(j, trackList) {
  modalTracks.innerHTML = "";
  const works = Array.isArray(j.works) && j.works.some(w => w && w.title) ? j.works : null;
  const head = document.querySelector(".tracks-head span");
  if (head) head.textContent = works ? "Works" : "Tracks";
  if (!works) { trackList.forEach((t, idx) => modalTracks.appendChild(buildTrackRow(t, idx))); return; }
  const discs = new Set(works.map(w => w.disc).filter(d => d != null)).size > 1;
  const several = new Set(works.map(w => w.composer).filter(Boolean)).size > 1;
  let disc = null;
  for (const w of works) {
    if (discs && w.disc != null && w.disc !== disc) {
      disc = w.disc;
      const li = document.createElement("li");
      li.className = "t-disc"; li.dataset.parity = "album.disc-head";
      li.textContent = "Disc " + disc;
      modalTracks.appendChild(li);
    }
    const movements = Array.isArray(w.movements) ? w.movements.filter(m => trackList[m.track]) : [];
    if (!movements.length) continue;
    if (!w.title) { modalTracks.appendChild(buildTrackRow(trackList[movements[0].track], movements[0].track, { noDisc: discs })); continue; }
    modalTracks.appendChild(buildWorkRow(w, movements, several, trackList));
    if (movements.length > 1) for (const m of movements) modalTracks.appendChild(buildTrackRow(trackList[m.track], m.track, { title: m.title, movement: true, noDisc: discs }));
  }
}

/* A work's row: the ring, its name, who it is by (where the album has several composers) and who performs it, its length. */
function buildWorkRow(w, movements, several, trackList) {
  const li = document.createElement("li");
  li.className = "t-row t-work"; li.dataset.parity = "album.work";
  const play = document.createElement("button");
  play.type = "button"; play.className = "t-work-play"; play.dataset.parity = "album.work-play";
  play.setAttribute("aria-label", "Play " + w.title);
  play.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2.5 1.2v7.6L8.4 5z" fill="currentColor"/></svg>';
  play.addEventListener("click", (e) => { e.stopPropagation(); playWork(movements, trackList, "play_now"); });
  li.appendChild(play);
  const tx = document.createElement("div"); tx.className = "t-text";
  const ti = document.createElement("span"); ti.className = "t-title"; ti.textContent = w.title;
  tx.appendChild(ti);
  const su = document.createElement("span"); su.className = "t-sub";
  if (several && w.composer) {
    const c = document.createElement("span"); c.className = "t-composer"; c.dataset.parity = "album.work-composer"; c.textContent = w.composer;
    su.appendChild(c);
  }
  const who = (Array.isArray(w.performers) ? w.performers : []).concat(w.conductor ? [w.conductor] : []);
  if (who.length) {
    if (su.childNodes.length) su.appendChild(Object.assign(document.createElement("span"), { className: "t-composer", textContent: " · " })).dataset.parity = "album.work-composer";
    const p = document.createElement("span"); p.dataset.parity = "album.work-performers"; p.textContent = who.join(", ");
    su.appendChild(p);
  }
  tx.appendChild(su);
  li.appendChild(tx);
  const len = document.createElement("span"); len.className = "t-len"; len.dataset.parity = "album.work-length";
  len.textContent = fmtTotal(Number(w.length) || movements.reduce((s, m) => s + (Number(trackList[m.track].length) || 0), 0));
  li.appendChild(len);
  li.addEventListener("click", (e) => {
    if (e.target.closest(".t-actions")) return;
    toggleWorkActions(li, movements, trackList);
  });
  return li;
}

/* The work's Play now, Play next and Queue, as a track row's (album-tracks.js); one row open at a time. */
function toggleWorkActions(li, movements, trackList) {
  const wasOpen = li.classList.contains("is-open");
  const open = modalTracks.querySelector("li.is-open");
  if (open) closeTrackRow(open);
  if (wasOpen) return;
  li.classList.add("is-open");
  const row = document.createElement("div");
  row.className = "t-actions";
  const mk = (label, kind, primary, key) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action-btn t-act" + (primary ? " primary" : "");
    b.textContent = label;
    b.dataset.parity = key;
    b.addEventListener("click", (e) => { e.stopPropagation(); closeTrackRow(li); playWork(movements, trackList, kind); });
    row.appendChild(b);
  };
  mk("Play now", "play_now", true, "album.work-play-now");
  mk("Play next", "play_next", false, "album.work-play-next");
  mk("Queue", "queue", false, "album.work-queue");
  li.appendChild(row);
}

/* The work's tracks played in the album's order, as a selection of them would be (invokeTrackMulti). */
function playWork(movements, trackList, kind) {
  invokeTrackMulti(kind, movements.map(m => ({ index: m.track, title: trackList[m.track].title || "" })));
}

/* A track's row (the album's list, or a movement of a work): its number, its name, who else is on it and its length. */
function buildTrackRow(t, idx, opts) {
  opts = opts || {};
  const li = document.createElement("li");
  li.className = "t-row" + (opts.movement ? " t-movement" : ""); li.dataset.trackId = t.track_id == null ? "" : String(t.track_id);   // nowdisc.js finds the playing track by it
  li.dataset.parity = "album.track";
  // Same two-line .t-text structure as the cached render above — the
  // .t-actions row stays a SIBLING of .t-text so the is-open flex-wrap
  // still drops it onto its own full-width line.
  const tx = document.createElement("div"); tx.className = "t-text";
  const ti = document.createElement("span"); ti.className = "t-title";
  ti.textContent = opts.title || t.title || "";
  const su = document.createElement("span"); su.className = "t-sub";
  const [subText, len] = splitTrackLength(t.subtitle);
  // Under a disc's heading the row needn't say which disc it is on.
  su.textContent = opts.noDisc ? subText.split(" · ").filter(p => !/^Disc \d+$/.test(p)).join(" · ") : subText;
  tx.appendChild(ti); tx.appendChild(su);
  li.appendChild(tx);
  // The track's length on the right, level with the title.
  if (len) { const ln = document.createElement("span"); ln.className = "t-len"; ln.textContent = len; li.appendChild(ln); }

  // The select target, on the right. Present from the start but hidden
  // until select mode is armed, so arming it doesn't reflow every row.
  // A real element rather than a ::after: .album-art-wrap's ♪ placeholder
  // already taught us what happens when two states share one pseudo.
  // It stays a sibling BEFORE .t-actions so is-open's flex-wrap still
  // drops the action row onto its own full-width line beneath it.
  const mark = document.createElement("button");
  mark.type = "button";
  mark.className = "t-mark"; mark.dataset.parity = "album.track-select";
  mark.setAttribute("aria-label", "Select this track");
  mark.setAttribute("aria-pressed", "false");
  mark.addEventListener("click", (e) => {
    // Selecting must never also expand or collapse the row's actions.
    e.stopPropagation();
    toggleTrackSelected(li, t, idx);
  });
  li.appendChild(mark);

  li.addEventListener("click", (e) => {
    if (e.target.closest(".t-actions")) return;   // taps on the buttons themselves
    if (e.target.closest(".t-mark")) return;      // handled above
    // Once the mode is armed the whole row selects. Making the user hunt
    // for a small circle is the wrong ergonomics for a list you are
    // deliberately working through.
    if (trackSelectMode) { toggleTrackSelected(li, t, idx); return; }
    toggleTrackActions(li, t, idx);
  });

  // A long press starts selecting, with this track the first pick —
  // the same rule as the album grid (v0.6.24).
  addLongPress(li, () => { if (trackSelectMode) return; enterTrackSelectMode(); toggleTrackSelected(li, t, idx); });
  return li;
}
