/* The share card (app/share-card.js), 2 of 3: the services and review sites under the card. */
/*
 * The services and review sites under the card.
 *
 * Every url is built server-side by lib/share-links.js and arrives on the
 * extras response the card already waits for, so there is no second request
 * and nothing renders twice. The labels are constants from that module —
 * never anything off the record, which is what keeps one six-line chip from
 * setting the height of the whole grid.
 *
 * rel="noreferrer" as well as noopener: these are search pages on other
 * people's sites, and there is no reason to tell them which library sent the
 * visitor.
 */
// Bumped by every open() and by close(), so anything still in flight can ask
// whether it is still wanted. See the note at the top of open().
let shareSeq = 0;

/*
 * THE DEFAULT SERVICE — where a suggestion goes when the record is not in
 * the library.
 *
 * PER DEVICE, IN localStorage, which is the Share Card app's choice and the
 * right one: the phone and the tablet across the house can reasonably differ,
 * and a display preference is not worth a server write. Every touch of
 * storage is guarded — it throws outright in a private window — and the
 * fallback is the first service that is switched on rather than a hardcoded
 * name, so a user who has turned Qobuz off is never sent to it.
 *
 * SET BY HOLDING A SERVICE CHIP, the gesture the Share Card app uses, and
 * also from Settings -> Share Card. The gesture is the discoverable one once
 * you know it; the setting is the discoverable one before that.
 */
const SHARE_PREF_KEY = "musicd-share-service";

function preferredService(available) {
  const list = available || [];
  let stored = null;
  try { stored = localStorage.getItem(SHARE_PREF_KEY); }
  catch (e) { /* private browsing — the fallback below stands */ }
  // A remembered service that is now switched off (or was removed from the
  // build) must not win: it would send a tap somewhere the user cannot see.
  if (stored && (!list.length || list.indexOf(stored) > -1)) return stored;
  return list.length ? list[0] : "qobuz";
}

function setPreferredService(id) {
  if (!id) return;
  try { localStorage.setItem(SHARE_PREF_KEY, id); }
  catch (e) { /* the choice lasts this session, which beats none */ }
  markPreferredChip();
  renderLinks(lastLinks);       // the tick moves
  renderSimilar(lastActs);      // and so does where the suggestions point
  // Switching TO Qobuz means the rows now point at search links that have
  // never been upgraded, so they get the same treatment they would have had
  // if Qobuz had been the default when they were drawn.
  const seq = shareSeq;
  upgradeQobuzLinks(lastActs, {
    container: similarLs, current: () => seq === shareSeq,
    album: a => a.album, artist: a => a.name,
  });
  if (window.__showToast) {
    const svc = (lastLinks && lastLinks.services || []).find(x => x.id === id);
    window.__showToast((svc ? svc.name : id) + " is now the default", "ok");
  }
}

/** Exactly one chip carries the tick, so the old one has to lose it. */
function markPreferredChip() {
  if (!linksEl) return;
  const chips = linksEl.querySelectorAll("a[data-service]");
  const ids = Array.prototype.map.call(chips, c => c.dataset.service);
  const chosen = preferredService(ids);
  for (const chip of chips) {
    const mine = chip.dataset.service === chosen;
    chip.classList.toggle("is-default", mine);
    chip.setAttribute("aria-pressed", mine ? "true" : "false");
  }
}

/*
 * A HOLD, NOT A TAP, AND THE TAP STILL HAS TO WORK.
 *
 * There is no long-press event, so it is a timer armed on touchstart and
 * cancelled by a move or a lift. When it fires, the click that follows on
 * both platforms has to be swallowed, or choosing a service would also open
 * it. contextmenu covers the desktop right-click and is what iOS raises when
 * the callout is suppressed — preventing it is what stops a held chip
 * showing a link preview instead of choosing.
 */
const HOLD_MS = 500;
function holdToPrefer(chip, id) {
  let timer = null, held = false;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  chip.addEventListener("touchstart", () => {
    held = false; cancel();
    timer = setTimeout(() => { held = true; setPreferredService(id); }, HOLD_MS);
  }, { passive: true });
  chip.addEventListener("touchmove",   cancel, { passive: true });
  chip.addEventListener("touchend",    cancel);
  chip.addEventListener("touchcancel", cancel);
  chip.addEventListener("click", (e) => {
    if (!held) return;
    held = false;
    e.preventDefault();      // the hold already did something
  });
  chip.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    setPreferredService(id);
  });
}

// What is currently on screen, so a change of default can repaint both rows
// without asking the server again.
let lastLinks = null;
let lastActs  = [];

/*
 * "If you like this" — three acts, each with one record.
 *
 * Never blocks the card and never reports a failure: a suggestion row is the
 * page's business, and an error message where three names should be is worse
 * than the row simply not being there.
 */
async function loadSimilar(artist, seq) {
  if (!similarEl || !similarLs || !artist) return;
  let acts;
  try {
    const r = await fetch("/api/similar?artist=" + encodeURIComponent(artist));
    if (!r.ok) return;
    const j = await r.json();
    acts = (j && j.acts) || [];
  } catch (e) { return; }      // no row, no message
  if (seq !== shareSeq) return;   // the sheet moved on, or closed
  lastActs = acts;
  renderSimilar(acts);
  upgradeQobuzLinks(acts, {
    container: similarLs, current: () => seq === shareSeq,
    album: a => a.album, artist: a => a.name,
  });
}

/*
 * A Qobuz search link lands on their DOWNLOAD STORE and never opens the app.
 * Only an album id does — see lib/qobuz-deeplink.js for why no search URL
 * anywhere can. Getting an id costs a page read on the server, so it happens
 * AFTER the rows are on screen and never before them: a suggestion must not
 * wait on it, and a failure leaves the search link that was already there.
 *
 * ONLY WHEN QOBUZ IS THE DEFAULT, because that is the only link the rows
 * actually point at. Switching the default to Qobuz later runs this again.
 *
 * The row is found again by what it LINKS TO rather than held onto: the list
 * may have been rebuilt while a lookup was in flight (a change of default
 * repaints it), and a reference to a discarded node would upgrade nothing.
 */
async function upgradeQobuzLinks(items, opts) {
  opts = opts || {};
  const box     = opts.container;
  const current = typeof opts.current === "function" ? opts.current : () => true;
  const albumOf = opts.album  || (x => x.album);
  const artistOf = opts.artist || (x => x.name);
  if (!box) return;
  for (const item of (items || [])) {
    if (!current()) return;                       // the screen moved on
    const album = item && albumOf(item);
    if (!item || !album || item.in_library) continue;
    const svc = (item.services || []).find(x => x.id === "qobuz");
    if (!svc || !svc.url) continue;
    const ids = (item.services || []).map(x => x.id);
    if (preferredService(ids) !== "qobuz") continue;
    if (svc.url.indexOf("open.qobuz.com") === 0) continue;   // already upgraded
    try {
      const params = new URLSearchParams({ album, artist: artistOf(item) || "" });
      const r = await fetch("/api/qobuz-link?" + params);
      if (!r.ok) continue;
      const j = await r.json();
      if (!j || !j.url) continue;
      if (!current()) return;
      const before = svc.url;
      // Remember it on the item, so a repaint (a change of default and back)
      // keeps the good link instead of asking again.
      svc.url = j.url;
      const row = box.querySelector('a[href="' + cssEscapeUrl(before) + '"]');
      if (row) row.href = j.url;
    } catch (e) { /* the search link is still there, which is not nothing */ }
  }
}

/*
 * The card's Qobuz chip, upgraded the same way and for the same reason.
 * Separate from the suggestions only because it is one link rather than
 * three and it is about the record on the card, not about an act like it.
 */
async function upgradeQobuzChip(title, artist, seq) {
  if (!linksEl || !title) return;
  const svc = (lastLinks && lastLinks.services || []).find(x => x.id === "qobuz");
  if (!svc || !svc.url || svc.url.indexOf("open.qobuz.com") === 0) return;
  try {
    const params = new URLSearchParams({ album: title, artist: artist || "" });
    const r = await fetch("/api/qobuz-link?" + params);
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.url || seq !== shareSeq) return;
    const before = svc.url;
    svc.url = j.url;
    const chip = linksEl.querySelector('a[href="' + cssEscapeUrl(before) + '"]');
    if (chip) chip.href = j.url;
  } catch (e) { /* the search link is still there */ }
}

/** Quotes and backslashes, so a URL can sit inside an attribute selector. */
function cssEscapeUrl(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}
