/* ------------------------------------------------------------------ */
/*  Share card overlay                                                 */
/* ------------------------------------------------------------------ */
const shareOverlay   = document.getElementById("share-overlay");
const frame     = document.getElementById("share-frame");
const actions   = document.getElementById("share-actions");
const linksEl   = document.getElementById("share-links");
const similarEl = document.getElementById("share-similar");
const similarLs = document.getElementById("share-similar-list");
const hintEl    = document.getElementById("share-hint");
const errEl     = document.getElementById("share-err");
const modalBtn  = document.getElementById("modal-share-btn");

// Bounded (v0.6.1): a font that never arrived held the card up for ever.
async function ensureFont() {
  if (!document.fonts || !document.fonts.load) return;
  const loaded = (async () => {
    await Promise.all([
      document.fonts.load('700 42px Manrope'),
      document.fonts.load('400 28px Manrope'),
      document.fonts.load('700 16px Manrope'),
      document.fonts.load('400 22px Manrope')
    ]);
    await document.fonts.ready;
  })().catch(() => { /* fall back to the system face */ });
  await Promise.race([loaded, new Promise(r => setTimeout(r, 2000))]);
}

function closeShare() {
  // Anything still in flight for the record that was on screen is no longer
  // wanted: without this a card or a suggestions row can arrive after the
  // sheet has been shut and paint into it.
  shareSeq++;
  shareOverlay.classList.add("hidden");
  frame.innerHTML =
    `<div class="share-placeholder"><div class="share-spinner"></div><div>Generating card…</div></div>`;
  actions.innerHTML = "";
  if (linksEl) { linksEl.innerHTML = ""; linksEl.classList.add("hidden"); }
  if (similarEl && similarLs) { similarLs.innerHTML = ""; similarEl.classList.add("hidden"); }
  lastActs = [];
  hintEl.textContent = "";
  errEl.textContent  = "";
}
shareOverlay.addEventListener("click", (e) => {
  if (e.target.closest && e.target.closest("[data-share-close]")) closeShare();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !shareOverlay.classList.contains("hidden")) closeShare();
});

// What the card shows, from an /api/album/extras answer (or none).
function cardFields(j) {
  const f = { releaseRaw: "", reviewText: "", reviewSource: "", links: null, score: null, bestNew: false };
  if (j) {
    if (j.links) f.links = j.links;
    if (j.year) f.releaseRaw = j.year;
    if (j.album && j.album.year && !f.releaseRaw) f.releaseRaw = String(j.album.year);
    // Pitchfork's number and their Best New Music flag — never their
    // prose, which the server nulls before it leaves fetchAlbumBios.
    if (j.album && j.album.score != null) f.score = j.album.score;
    if (j.album && j.album.isBestNewMusic) f.bestNew = true;
    const desc = j.album && j.album.description;
    // Settings → Share Card → Review switched off: a card without it.
    const wantReview = !(j.card && j.card.review === false);
    if (desc && wantReview) {
      // Card height grows to fit, so show most of the review — capped
      // (~10 sentences / 1400 chars) against a very long article.
      let t = String(desc).trim();
      const sentences = t.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length > 10) t = sentences.slice(0, 10).join(" ").trim();
      if (t.length > 1400) t = t.slice(0, 1398).replace(/\s+\S*$/, "") + "…";
      f.reviewText = t;
      // Whose prose it is — not where the link goes (kept apart on purpose).
      if (j.album.description_source) f.reviewSource = String(j.album.description_source);
    }
  }
  f.signature = [f.releaseRaw, f.reviewText, f.reviewSource, f.score, f.bestNew].join("|");
  return f;
}
// Draw the card and put it on screen (an object URL: no base64 copy of a
// large PNG to make first). Only while this open is still the current one.
let cardUrl = null;
async function paintCard(f, coverUrl, title, artist, seq) {
  const blob = await ShareCard.render({
    // The duck tile in the card's bottom-right corner (v0.7.5).
    coverUrl, wordmarkUrl: null, logoUrl: LOGO_URL, title, artist,
    releaseRaw: f.releaseRaw, review: f.reviewText,
    reviewSource: f.reviewSource, score: f.score, bestNewMusic: f.bestNew
  });
  if (seq !== shareSeq) return;
  if (cardUrl) URL.revokeObjectURL(cardUrl);
  cardUrl = URL.createObjectURL(blob);
  frame.innerHTML = "";
  const img = document.createElement("img");
  img.src = cardUrl; img.alt = "Share card"; img.setAttribute("aria-label", "Share card"); img.setAttribute("data-parity", "share-card.image");
  frame.appendChild(img);
  buildActions(blob, title, artist);
}
/*
 * THE COVER THE CARD DRAWS IS THE ONE ALREADY ON SCREEN (v0.7.6). The card
 * asked for the cover at 1000 px, which the server rounds up to its 1200 px
 * step: a size nothing else on the page uses, so every first share of a
 * record meant the server decoding the full cover and encoding it again
 * (seconds on a small server) and the phone downloading it. The album page
 * and Now playing both show the cover at 800 px — and the card's own cover
 * pane is 424 px — so the card now asks for exactly that address and gets
 * the browser's copy back: nothing rendered, nothing downloaded.
 */
const COVER_SIZE = 800;
const coverUrlOf = (imageKey) => imageKey ? `/api/image/${encodeURIComponent(imageKey)}?size=${COVER_SIZE}` : "";
// Called when an album opens: fetch its cover now, so a share is instant.
window.__prewarmShareCard = (imageKey) => {
  if (!imageKey) return;
  try { const im = new Image(); im.src = coverUrlOf(imageKey); } catch (e) { /* only a head start */ }
};
// The duck tile, fetched once the page is idle, so the first card never
// waits for it (it is small — 256 px — since v0.7.6; it was a 900 KB PNG).
const LOGO_URL = "/icons/duck-tile.png";
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
idle(() => { try { const im = new Image(); im.src = LOGO_URL; } catch (e) { /* only a head start */ } });

/*
 * The pill's room under the sheet (v0.7.9), only while the pill is on
 * screen: it floats over the overlay, so the panel is centred above it.
 * On Now playing it is hidden, and the sheet takes the full height.
 */
function fitShareReserve() {
  const mt = document.getElementById("mini-transport");
  let reserve = 0;
  if (mt) {
    const r = mt.getBoundingClientRect();
    if (r.height > 0 && r.top < window.innerHeight) reserve = Math.max(0, Math.ceil(window.innerHeight - r.top - 20 + 8));
  }
  shareOverlay.style.setProperty("--share-reserve", reserve + "px");
}
window.addEventListener("resize", () => { if (!shareOverlay.classList.contains("hidden")) fitShareReserve(); });

// Public entry point — called from album modal share button + mini transport
async function openShare(input) {
  const title  = input.title  || "";
  const artist = input.artist || "";
  if (!title) return;

  /*
   * WHICH OPEN THIS IS. Stamped here, at the top, and not where each
   * asynchronous piece is issued — because two opens can finish their awaits
   * OUT OF ORDER and the later stamp then belongs to the earlier record.
   *
   * Found by the test rather than by reading: open, close, open again, and
   * the suggestions row came back showing acts for the first record under
   * the second one's card. The stamp used to be taken where the suggestion
   * fetch was issued (`++similarSeq` at the end of open), so whichever open
   * got there first owned the newest number — and the first open is not
   * always the first to get there. ensureFont() alone is enough to reorder
   * them: it really loads the font once and resolves instantly afterwards.
   *
   * Everything this open paints is now gated on still being the current one,
   * the card included — a superseded open painting its card over the live
   * one is the same bug wearing a different hat.
   */
  const mySeq = ++shareSeq;

  actions.innerHTML = "";
  if (linksEl) { linksEl.innerHTML = ""; linksEl.classList.add("hidden"); }
  if (similarEl && similarLs) { similarLs.innerHTML = ""; similarEl.classList.add("hidden"); }
  lastActs = [];
  hintEl.textContent = "";
  errEl.textContent  = "";
  frame.innerHTML =
    `<div class="share-placeholder"><div class="share-spinner"></div><div>Generating card…</div></div>`;
  shareOverlay.classList.remove("hidden");
  fitShareReserve();

  try {
    // THE CARD FIRST, THEN THE SUGGESTIONS. The card is drawn from what is
    // already to hand — the record is the one on screen, so title, artist
    // and cover are known, and the server's cache (fast=1: no lookups)
    // almost always has the year and the review. The full lookup runs
    // alongside; only if it brings something the card lacked (a review
    // found for the first time) is the card drawn again. The three acts
    // (loadSimilar, below) are asked for only once the card is on screen.
    //
    // The cover as the page already has it: the same address as the album
    // page's and Now playing's picture, which the server sends immutable,
    // so it is the browser's copy, not a download or a render. Asked for
    // here, before the extras come back, so the two overlap.
    const coverUrl = coverUrlOf(input.image_key);
    window.__prewarmShareCard(input.image_key);
    const params = new URLSearchParams({ title, artist });
    const getExtras = (fast) => fetch("/api/album/extras?" + params + (fast ? "&fast=1" : ""), { cache: "no-store" })
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const full = getExtras(false);
    const [, quick] = await Promise.all([ensureFont(), getExtras(true)]);
    if (mySeq !== shareSeq) return;

    const first = cardFields(quick);
    await paintCard(first, coverUrl, title, artist, mySeq);
    if (mySeq !== shareSeq) return;
    renderLinks(first.links);
    // The card's own Qobuz chip lands on the download store for exactly the
    // same reason the suggestions did, so it gets the same upgrade.
    upgradeQobuzChip(title, artist, mySeq);
    // AFTER the card, and deliberately not awaited: this costs up to five
    // Deezer calls and the card must not wait behind it. A generation stamp
    // rather than a plain flag, because the sheet can be reopened on another
    // record while this is still out — and three acts for the previous album
    // under the new one's card is worse than none at all.
    loadSimilar(artist, mySeq);

    const later = cardFields(await full);
    if (mySeq !== shareSeq) return;
    if (later.signature !== first.signature) {
      await paintCard(later, coverUrl, title, artist, mySeq).catch(() => {});
      if (mySeq === shareSeq && later.links) renderLinks(later.links);
    }
  } catch (e) {
    if (mySeq !== shareSeq) return;   // a superseded open's failure is not news
    frame.innerHTML = `<div class="share-placeholder">Could not generate the card.</div>`;
    errEl.textContent = (e && e.message) ? e.message : String(e);
  }
}
window.__openShareCard = openShare;
/*
 * The row builder and the Qobuz upgrade, published for the Discover screen.
 *
 * They live in THIS closure because everything they depend on does — the
 * default-service preference, the chips that set it, the share sequence that
 * orphans a superseded open. Discover is in the main closure (it needs the
 * wall, the banner and the grid), so the two halves reach each other the way
 * every other pair in this file does: one named window.__ export rather than
 * a second copy of the rules about where a tap goes.
 */
window.__goRow = goRow;
window.__upgradeQobuzLinks = upgradeQobuzLinks;
