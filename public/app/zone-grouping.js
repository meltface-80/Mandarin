/* The page's core (app.js until v1.0.5), 16 of 33: a smart playlist deleted, and rooms grouped. */
async function deleteSmartPlaylist(sp) {
  const ok = await confirmDialog(`Delete the Dynamic Playlist "${sp.name}"?`);
  if (!ok) return;
  try {
    const r = await fetch("/api/smart-playlists/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sp.id })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error || "Couldn't delete that", "error"); return; }
    showToast(`Deleted "${sp.name}"`);
    if (window.__playlistsChanged) window.__playlistsChanged();
    smartDetailActive = false;
    showSmartPlaylists();
  } catch (e) {
    showToast("Couldn't delete that", "error");
  }
}

// A zone row's label. Grouped zones get a second line naming their outputs,
// as Roon's own remote does — without it a zone called "Kitchen + Study" and
// a real Kitchen+Study group look identical.
function fillZoneRow(item, z) {
  const outs = z.outputs || [];
  const name = document.createElement("span");
  name.className = "group-name";
  name.textContent = z.display_name;
  item.appendChild(name);
  if (outs.length > 1) {
    const sub = document.createElement("span");
    sub.className = "np-device-sub";
    sub.textContent = outs.map(o => o.display_name).filter(Boolean).join(" + ");
    item.appendChild(sub);
  }
}
window.__fillZoneRow = fillZoneRow;

// ----- Zone grouping (Roon group_outputs / ungroup_outputs) ---------------
//
// Roon groups OUTPUTS, not zones: a zone IS whichever outputs currently play
// in sync. So this is a checklist of outputs anchored on the zone the app is
// driving. Roon preserves the first output's queue, so the anchor's own
// output is always sent first and always stays ticked — grouping can never
// throw away what you're listening to.
async function openGroupSheet() {
  const anchorZoneId = selectedZoneId;
  let list = [];
  try {
    const r = await fetch("/api/outputs", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.outputs)) list = j.outputs; }
  } catch (e) { /* leaves `list` empty — the empty state below explains it */ }

  const anchorOutputs = anchorZoneId ? list.filter(o => o.zone_id === anchorZoneId) : [];
  const anchorIds     = anchorOutputs.map(o => o.output_id);
  const primary       = anchorOutputs[0] || null;

  // Roon says which outputs an output may join. A Core that doesn't send the
  // list gives us null, which we read as "unknown" and offer everything —
  // offering nothing would make the feature look broken rather than limited.
  const allowed = primary && Array.isArray(primary.can_group_with_output_ids)
    ? new Set(primary.can_group_with_output_ids)
    : null;
  const offerable = list.filter(o =>
    anchorIds.includes(o.output_id) || !allowed || allowed.has(o.output_id));

  const picked = new Set(anchorIds);

  openLibSheet("Group zones", (body, close) => {
    const paint = () => {
      body.innerHTML = "";
      if (!primary) {
        const note = document.createElement("div");
        note.className = "lib-sheet-note";
        note.textContent = list.length
          ? "Choose a zone first — grouping needs a zone to build the group around."
          : "No Sonos rooms found. The server must share a network with your speakers (host networking), or set SONOS_HOSTS to a speaker's IP.";
        body.appendChild(note);
        return;
      }
      for (const o of offerable) {
        const isPrimary = o.output_id === primary.output_id;
        const on = picked.has(o.output_id);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "group-row" + (on ? " is-on" : "") + (isPrimary ? " is-anchor" : "");
        row.dataset.output = o.output_id;
        const box = document.createElement("span");
        box.className = "group-box";
        box.textContent = "✓";
        const text = document.createElement("span");
        text.className = "group-text";
        const nm = document.createElement("span");
        nm.className = "group-name";
        nm.textContent = o.display_name || o.output_id;
        text.appendChild(nm);
        // Say why a row can't be unticked, and warn when taking an output
        // would break up a group it is already in. Outputs already in THIS
        // zone get nothing — they're ticked, which says it, and naming the
        // group we're editing back at the user is just noise.
        const noteText = isPrimary
          ? "Keeps playing — this group's queue"
          : (!anchorIds.includes(o.output_id) && o.zone_name && o.zone_name !== o.display_name
              ? "In " + o.zone_name : "");
        if (noteText) {
          const nt = document.createElement("span");
          nt.className = "group-note";
          nt.textContent = noteText;
          text.appendChild(nt);
        }
        row.appendChild(box); row.appendChild(text);
        if (isPrimary) {
          row.disabled = true;
          row.setAttribute("aria-pressed", "true");
        } else {
          row.setAttribute("aria-pressed", String(on));
          row.addEventListener("click", () => {
            if (picked.has(o.output_id)) picked.delete(o.output_id);
            else picked.add(o.output_id);
            paint();
            const again = body.querySelector('[data-output="' + o.output_id + '"]');
            if (again) again.focus();
          });
        }
        body.appendChild(row);
      }
      if (offerable.length < list.length) {
        const note = document.createElement("div");
        note.className = "lib-sheet-note";
        note.textContent = "Outputs your Core can't sync with " + primary.display_name +
                           " aren't listed — Sonos decides which rooms can play together.";
        body.appendChild(note);
      }
    };
    paint();
  }, (foot, close) => {
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "action-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", close);
    const apply = document.createElement("button");
    apply.type = "button"; apply.className = "action-btn primary";
    apply.textContent = "Apply";
    apply.addEventListener("click", async () => {
      if (!primary) { close(); return; }
      const toRemove = anchorIds.filter(id => !picked.has(id));
      const toAdd    = [...picked].filter(id => !anchorIds.includes(id));
      if (!toRemove.length && !toAdd.length) { close(); return; }
      apply.disabled = true; cancel.disabled = true;
      const ok = await applyGrouping(anchorIds, toRemove, toAdd, primary);
      apply.disabled = false; cancel.disabled = false;
      if (ok) close();
    });
    foot.appendChild(cancel); foot.appendChild(apply);
  });
}

// Split first, then group: ungrouping an output that is also being regrouped
// elsewhere would otherwise race, and Roon takes the whole desired set for a
// group in one call anyway.
async function applyGrouping(anchorIds, toRemove, toAdd, primary) {
  const post = async (url, output_ids) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output_ids })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || ("HTTP " + r.status));
    }
  };
  try {
    if (toRemove.length) await post("/api/ungroup-outputs", toRemove);
    if (toAdd.length) {
      // primary first — Roon preserves the first output's zone's queue.
      const kept = anchorIds.filter(id => id !== primary.output_id && !toRemove.includes(id));
      await post("/api/group-outputs", [primary.output_id, ...kept, ...toAdd]);
    }
    showToast("Zones updated");
  } catch (e) {
    showToast(e.message || "Could not change grouping", "error");
    return false;
  }
  // Roon has accepted the change, so the sheet's work is done — settling the
  // app onto the new zone happens in the background rather than holding the
  // sheet open for it. Detached deliberately: an unresolved settle must not
  // leave the user staring at a sheet Roon has already acted on.
  const want = new Set([
    primary.output_id,
    ...anchorIds.filter(id => !toRemove.includes(id)),
    ...toAdd,
  ]);
  settleZoneAfterGrouping(primary.output_id, want);
  return true;
}

// Grouping retires zone ids — Roon mints a zone per set of outputs — so the
// app has to be re-pointed at whichever zone now holds the output we anchored
// on. Left alone, loadZones() would find the old id gone and fall back to
// whichever zone sorts first, quietly moving the user elsewhere.
//
// The Core's zone update is asynchronous, so a single fixed wait is a guess.
// Poll instead: take the best answer available on each attempt and stop as
// soon as the topology matches what was asked for. Bounded at ~2s, after which
// loadZones() and the 1.5s transport poll resync regardless.
async function settleZoneAfterGrouping(anchorOutputId, want) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise(r => setTimeout(r, 250));
    let zs = null;
    try {
      const r = await fetch("/api/zones", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.zones)) zs = j.zones; }
    } catch (e) { /* transient — retry; the loop is bounded and resyncs after */ }
    if (!zs) continue;
    const z = zs.find(zz => (zz.outputs || []).some(o => o.output_id === anchorOutputId));
    if (!z) continue;
    try { localStorage.setItem("rra-zone", z.zone_id); }
    catch (e) { /* private mode — loadZones() still selects a zone, just not this one */ }
    const have = new Set((z.outputs || []).map(o => o.output_id));
    if (have.size === want.size && [...want].every(id => have.has(id))) break;
  }
  await loadZones();
  if (typeof window.__refreshTransport === "function") window.__refreshTransport();
}
window.__openGroupSheet = openGroupSheet;
