/* The page's core (app.js until v1.0.5), 22 of 33: the queue. */
// Send the selection, in the order it was picked.
async function runHistoryMulti(kind, rows) {
  if (!historySelected.length) return;
  const picks = historySelected.map(i => rows[i]).filter(Boolean);
  const verb = kind === "queue" ? "Add" : "Play";
  const what = picks.length === 1 ? `"${picks[0].track}"` : `${picks.length} tracks`;
  if (!await confirmDialog(
    `${verb} ${what} ${kind === "queue" ? "to the end of the queue" : "next"}?`)) return;

  for (const b of document.querySelectorAll(".q-hist-act")) b.disabled = true;
  showToast(`Adding ${picks.length} track${picks.length === 1 ? "" : "s"}…`,
            null, TOAST_REPORT_MS);
  try {
    const r = await fetch("/api/queue/history-multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zone_or_output_id: queueZoneId(),
        kind,
        // Selection order. The server decides what order to SEND them in so
        // they land this way round — see playNextSendOrder.
        tracks: picks.map(h => ({ track: h.track, artist: h.artist, album: h.album })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(j.error || `Couldn't add those: HTTP ${r.status}`, "error", TOAST_REPORT_MS);
      return;
    }
    // Every part of a partial result is worth saying: which went, which the
    // library could not find, which Roon refused.
    let msg = `${kind === "queue" ? "Queued" : "Playing"} ${j.queued} track${j.queued === 1 ? "" : "s"}`;
    // Name them. "1 not in your library" leaves the user to work out WHICH of
    // their picks it meant, and the answer decides whether it is a real
    // absence or something to report.
    const named = (list, what) => {
      if (!list || !list.length) return "";
      const shown = list.slice(0, 3).map(t => `“${t}”`).join(", ");
      return `, ${shown}${list.length > 3 ? ` and ${list.length - 3} more` : ""} ${what}`;
    };
    const missed = (j.unresolved || []).length;
    const failed = (j.failed || []).length;
    msg += named(j.unresolved, "not in your library");
    msg += named(j.failed, "refused by Sonos");
    showToast(msg, (missed || failed) ? "error" : null, TOAST_REPORT_MS);
    historySelectMode = false;
    historySelected = [];
    // Now, not when the reload lands: the send has finished and the controls
    // have to say so immediately, or they sit there lit over nothing.
    repaintHistory();
    setTimeout(loadQueue, 600);
  } catch (e) {
    showToast("Couldn't reach the extension", "error");
  } finally {
    for (const b of document.querySelectorAll(".q-hist-act")) b.disabled = false;
  }
}

// Add a played track back, after the current one.
async function playHistoryNext(h) {
  const name = h.track || "this track";
  if (!await confirmDialog(`Play "${name}" next?`)) return;
  try {
    const r = await fetch("/api/queue/play-history-next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Re-read at tap time, exactly as the live rows do: these rows belong
        // to whichever zone the screen is showing now.
        zone_or_output_id: queueZoneId(),
        track: h.track, artist: h.artist, album: h.album
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // "Not in your library" is an outcome, not a fault — a stream, or an
      // album since removed. Saying which stops it reading as a bug.
      showToast(j.unresolved
        ? `Can't play "${name}" again — it isn't in your library`
        : "Couldn't play that: " + (j.error || `HTTP ${r.status}`), "error");
      return;
    }
    showToast(`Playing "${j.track || name}" next`);
    setTimeout(loadQueue, 600);
  } catch (e) {
    showToast("Couldn't reach the extension", "error");
  }
}

// The queue as last shown (v0.8.35): while it is asked for again, that one
// stays on screen and the fresh one replaces it once it comes — the list is
// never emptied to wait. Only a zone not yet shown says "Loading queue…".
let queueView = null;     // { zoneId, items, history }
let queueLoads = 0;       // the latest load: an earlier one that answers after it is dropped
// [expectFirst]: a track just played from here. Until the room's own queue
// has it as "Now playing", the screen keeps it so (asked again three times,
// then the room's word is taken).
async function loadQueue(opts = {}) {
  const zoneId = queueZoneId();
  if (!zoneId) return;
  const seq = ++queueLoads;
  const summary = document.getElementById("queue-summary");
  const list    = document.getElementById("queue-list");
  const empty   = document.getElementById("queue-empty");
  if (!queueView || queueView.zoneId !== zoneId) {
    queueView = null;
    summary.textContent = "Loading queue…";
    list.innerHTML = "";
    empty.classList.add("hidden");
  }
  try {
    const r = await fetch(`/api/queue?zone=${encodeURIComponent(zoneId)}`);
    const j = await r.json();
    if (seq !== queueLoads || zoneId !== queueZoneId()) return;
    const view = { zoneId, items: j.items || [], history: Array.isArray(j.history) ? j.history : [] };
    const tries = opts.tries || 0;
    if (opts.expectFirst != null && (view.items[0] || {}).queue_item_id !== opts.expectFirst && tries < 3) {
      setTimeout(() => { if (seq === queueLoads) loadQueue({ expectFirst: opts.expectFirst, tries: tries + 1 }); }, 700);
      return;
    }
    renderQueue(view);
  } catch (e) {
    if (seq !== queueLoads) return;
    if (!queueView) summary.textContent = "Couldn't load queue: " + e.message;
  }
}
// The queue once a track further down plays from here: the ones above it
// played (newest first, as the server sends them), it "Now playing".
function playedFrom(view, k) {
  const played = view.items.slice(0, k).reverse().map(x => ({
    track: x.title, artist: x.subtitle, album: x.album, image_key: x.image_key,
    duration: x.length || 0, elapsed: x.length || 0, played: true, queue_item_id: x.queue_item_id
  }));
  return { zoneId: view.zoneId, items: view.items.slice(k), history: played.concat(view.history) };
}
function renderQueue(view) {
  queueView = view;
  const summary = document.getElementById("queue-summary");
  const list    = document.getElementById("queue-list");
  const empty   = document.getElementById("queue-empty");
  summary.textContent = "";
  list.innerHTML = "";
  // The rows about to be discarded are the ones the picks point at, so the
  // selection goes with them. Select MODE goes too: leaving it on with an
  // empty selection shows an action bar over rows nobody has picked yet.
  historySelectMode = false;
  historySelected = [];
  queueSelectMode = false;
  queueSelected = [];
  empty.classList.add("hidden");
  try {
    const items = view.items;
    const history = view.history;
    // Only truly empty when there is nothing either side of the divider. A
    // queue that has run out but played twenty tracks is not an empty screen.
    if (!items.length && !history.length) {
      summary.textContent = "";
      empty.classList.remove("hidden");
      return;
    }
    let totalSec = 0;
    for (const it of items) if (it.length) totalSec += it.length;
    // The bar: the count and time on the left; on the right Clear all, or,
    // selecting, the ⋯ menu (Play now, Play next, Remove) and Done.
    summary.innerHTML = "";
    const sumText = document.createElement("span");
    sumText.className = "queue-summary-text";
    sumText.textContent = items.length
      ? `${items.length} track${items.length === 1 ? "" : "s"} · ${fmtDuration(totalSec)} remaining`
      : "Nothing more queued";
    const tools = document.createElement("div");
    tools.className = "queue-summary-tools";
    const clearAll = document.createElement("button");
    clearAll.type = "button"; clearAll.className = "q-tool"; clearAll.textContent = "Clear all";
    clearAll.setAttribute("aria-label", "Clear the queue"); clearAll.dataset.parity = "queue.clear";
    const menuWrap = document.createElement("div");
    menuWrap.className = "sel-menu-wrap q-sel-menu-wrap hidden";
    const menuBtn = document.createElement("button");
    menuBtn.type = "button"; menuBtn.className = "q-tool q-tool-menu"; menuBtn.textContent = "⋯";
    menuBtn.setAttribute("aria-label", "What to do with the selected tracks");
    menuBtn.setAttribute("aria-haspopup", "menu"); menuBtn.setAttribute("aria-expanded", "false"); menuBtn.dataset.parity = "queue.select-menu";
    const menu = document.createElement("div");
    menu.className = "sel-menu hidden"; menu.setAttribute("role", "menu");
    const menuCount = document.createElement("div"); menuCount.className = "sel-menu-title"; menuCount.dataset.parity = "queue.select-title";
    menu.appendChild(menuCount);
    // The keys are the screens contract's (docs/specs/screens.json): the Android app's Queue has each.
    const mkItem = (label, act, key, danger) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sel-menu-item" + (danger ? " is-danger" : ""); b.setAttribute("role", "menuitem");
      b.dataset.queueAct = act; b.textContent = label; b.dataset.parity = key;
      b.addEventListener("click", () => { closeMenu(); runQueueAction(act, items); });
      menu.appendChild(b);
      return b;
    };
    mkItem("Play now", "play_now", "queue.play-now"); mkItem("Play next", "play_next", "queue.play-next"); mkItem("Remove", "remove", "queue.remove", true);
    menuWrap.append(menuBtn, menu);
    const done = document.createElement("button");
    done.type = "button"; done.className = "q-tool hidden"; done.textContent = "Done"; done.dataset.parity = "queue.done";
    tools.append(clearAll, menuWrap, done);
    summary.append(sumText, tools);
    const closeMenu = () => { menu.classList.add("hidden"); menuBtn.setAttribute("aria-expanded", "false"); };
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle("hidden") === false;
      menuBtn.setAttribute("aria-expanded", String(open));
      if (open) setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
    });
    clearAll.addEventListener("click", () => clearQueueAll());
    done.addEventListener("click", () => { queueSelectMode = false; queueSelected = []; paintQueueSelection(); });
    const itemRows = [];
    // Which rows are picked and in what order; the tools for the mode.
    const paintQueueSelection = () => {
      itemRows.forEach(({ li, num, it }) => {
        const at = queueSelected.indexOf(it.queue_item_id);
        li.classList.toggle("is-picked", at !== -1);
        li.classList.toggle("is-selecting", queueSelectMode);
        num.textContent = at === -1 ? "" : String(at + 1);
        num.classList.toggle("hidden", at === -1 || !queueSelectMode);   // unpicked: the outlined circle
      });
      const n = queueSelected.length;
      menuCount.textContent = n ? `${n} selected` : "Tap tracks to select them";
      for (const b of menu.querySelectorAll(".sel-menu-item")) b.disabled = n === 0;
      clearAll.classList.toggle("hidden", queueSelectMode || !items.length);
      menuWrap.classList.toggle("hidden", !queueSelectMode);
      done.classList.toggle("hidden", !queueSelectMode);
      if (!queueSelectMode) closeMenu();
    };
    repaintQueueSelection = paintQueueSelection;

    // Above the "Now playing" divider, because that is where it happened.
    renderQueueHistory(list, history);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (i === 0) {
        // Roon-style "Now playing" divider above the current track
        const div = document.createElement("li");
        div.className = "q-divider"; div.dataset.parity = "queue.divider";
        div.setAttribute("aria-hidden", "true");
        div.innerHTML =
          '<span class="q-divider-line"></span>' +
          '<span class="q-divider-label">Now playing</span>' +
          '<span class="q-divider-line"></span>';
        list.appendChild(div);
      }
      const li = document.createElement("li");
      li.dataset.parity = "queue.track";
      if (i === 0) li.classList.add("is-now");
      else li.classList.add("is-tappable");

      // The pick number, as the played-earlier rows carry it.
      const num = document.createElement("span"); num.className = "q-hist-num hidden";
      const art = document.createElement("img"); art.className = "q-art";
      if (it.image_key) art.src = `/api/image/${encodeURIComponent(it.image_key)}?size=120`;
      else art.style.visibility = "hidden";
      const tx = document.createElement("div"); tx.className = "q-text";
      const tt = document.createElement("div"); tt.className = "q-title";  tt.textContent = it.title || "";
      const ts = document.createElement("div"); ts.className = "q-sub";    ts.textContent = it.subtitle || "";
      tx.appendChild(tt); tx.appendChild(ts);
      const len = document.createElement("span"); len.className = "q-len";
      if (it.length) len.textContent = fmtDuration(it.length);
      li.appendChild(num); li.appendChild(art); li.appendChild(tx); li.appendChild(len);
      itemRows.push({ li, num, it });

      // A long press starts selecting, with this row the first pick.
      const pick = () => {
        const at = queueSelected.indexOf(it.queue_item_id);
        if (at === -1) queueSelected.push(it.queue_item_id); else queueSelected.splice(at, 1);
        paintQueueSelection();
      };
      addLongPress(li, () => {
        if (queueSelectMode) return;
        queueSelectMode = true; queueSelected = [it.queue_item_id];
        paintQueueSelection();
      });
      li.addEventListener("click", (e) => { if (queueSelectMode) { e.stopImmediatePropagation(); pick(); } });

      if (i !== 0) {
        li.addEventListener("click", async () => {
          const trackName = it.title || "this track";
          // confirmDialog, not window.confirm: a native confirm can be left
          // open when the app is backgrounded and then resolves on reopen,
          // firing the request into a network stack that is still coming
          // back up. An in-page sheet cannot be resolved by backgrounding.
          if (!await confirmDialog(`Play from "${trackName}"?`)) return;
          const epochAtSend = hiddenEpoch;
          // "Now playing" moves to it at once (v0.8.35); the room's own queue is asked for after.
          const at = queueView ? queueView.items.indexOf(it) : -1;
          if (at > 0) renderQueue(playedFrom(queueView, at));
          try {
            const r = await fetch("/api/play-from-here", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                // Re-read at click time: the rows on screen belong to
                // queueZoneId()'s queue, so the action must target that same
                // zone, not the one captured when the screen opened.
                zone_or_output_id: queueZoneId(),
                queue_item_id: it.queue_item_id
              })
            });
            if (!r.ok) {
              const j = await r.json().catch(() => ({}));
              showToast("Couldn't play from here: " + (j.error || `HTTP ${r.status}`), "error");
              loadQueue();
              return;
            }
            // The room's own queue, now it has moved: the server answers once it has.
            loadQueue({ expectFirst: it.queue_item_id });
          } catch (e) {
            // Backgrounded mid-flight. iOS killed the connection and handed
            // us the rejection on reopen, so this is not a failure the user
            // caused or can act on — and Roon has almost certainly already
            // played the track. Re-pull the queue (the success path's own
            // follow-up never ran) and say nothing, rather than alerting
            // about a tap made minutes ago.
            if (hiddenEpoch !== epochAtSend) { loadQueue(); return; }
            showToast("Couldn't play from here: " + e.message, "error");
            loadQueue();
          }
        });
      }

      list.appendChild(li);
    }
    paintQueueSelection();
  } catch (e) {
    summary.textContent = "Couldn't show the queue: " + e.message;
  }
}
// The picks played now (moved to after the track playing and the first of
// them played), played next (moved), or removed.
async function runQueueAction(kind, items) {
  const picks = queueSelected.slice();
  if (!picks.length) return;
  const names = picks.map(id => { const it = items.find(x => x.queue_item_id === id); return it && it.title; }).filter(Boolean);
  const what = picks.length === 1 ? `"${names[0] || "this track"}"` : `${picks.length} tracks`;
  if (kind === "remove" && !await confirmDialog(`Remove ${what} from the queue?`)) return;
  try {
    const r = await fetch(kind === "remove" ? "/api/queue/remove" : "/api/queue/move", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone_or_output_id: queueZoneId(), queue_item_ids: picks, kind })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast((j.error || `HTTP ${r.status}`), "error"); return; }
    showToast(kind === "remove" ? `Removed ${what}` : kind === "play_now" ? `Playing ${what}` : `Playing ${what} next`);
    queueSelectMode = false; queueSelected = [];
    repaintQueueSelection();
    setTimeout(loadQueue, 600);
  } catch (e) {
    showToast("Couldn't reach the server", "error");
  }
}
async function clearQueueAll() {
  if (!await confirmDialog("Clear the queue? Playback stops.")) return;
  try {
    const r = await fetch("/api/queue/clear", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone_or_output_id: queueZoneId() })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast((j.error || `HTTP ${r.status}`), "error"); return; }
    showToast("Queue cleared");
    setTimeout(loadQueue, 600);
  } catch (e) {
    showToast("Couldn't reach the server", "error");
  }
}
function fmtDuration(secs) {
  secs = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}
