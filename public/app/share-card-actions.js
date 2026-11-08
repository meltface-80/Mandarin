/* The share card (app/share-card.js), 2 of 2: its buttons, Copy image and Download (item 336: the links and the
   suggestions that were under the card are gone, the card alone kept). */
/*
 * An iOS app added to the home screen, as opposed to iOS in a browser tab.
 *
 * Two separate facts, and both are needed. `navigator.standalone` is the
 * iOS-only flag for a home-screen launch; the display-mode query is the
 * standard one and covers an installed app elsewhere. The platform test is
 * what keeps this from firing on an installed desktop PWA, where downloading
 * works perfectly well — and it checks maxTouchPoints because an iPad reports
 * its platform as "MacIntel" and is indistinguishable from a Mac without it.
 */
function iosStandalone() {
  try {
    const p = (navigator.platform || "") + " " + (navigator.userAgent || "");
    const isIOS = /iPhone|iPad|iPod/.test(p) ||
                  (/Mac/.test(p) && (navigator.maxTouchPoints || 0) > 1);
    if (!isIOS) return false;
    if (navigator.standalone === true) return true;
    return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  } catch (e) {
    // A UA sniff that throws must not take the share sheet with it; the
    // download button is the safe answer because it is what every other
    // platform gets.
    return false;
  }
}

function buildActions(blob, title, artist) {
  actions.innerHTML = "";
  const fileName =
    `${(artist || "artist").replace(/[^a-z0-9]+/gi, "_")}-` +
    `${(title  || "card"  ).replace(/[^a-z0-9]+/gi, "_")}.png`;

  const canShare = (() => {
    try {
      if (!navigator.share || !navigator.canShare) return false;
      const probe = new File([new Uint8Array([0])], "p.png", { type: "image/png" });
      return navigator.canShare({ files: [probe] });
    } catch { return false; }
  })();
  const canCopy = typeof window.ClipboardItem !== "undefined"
    && navigator.clipboard && typeof navigator.clipboard.write === "function";

  if (canCopy) {
    const b = mkBtn("ghost", icon("copy"), "Copy image", "share-card.copy");
    b.onclick = async () => {
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
        setLabel(b, "Copied!"); setTimeout(() => setLabel(b, "Copy image"), 2000);
      } catch (e) { errEl.textContent = e.message || String(e); }
    };
    actions.appendChild(b);
  }
  if (canShare) {
    const b = mkBtn("primary", icon("share"), "Share…", "share-card.share");
    b.onclick = async () => {
      try {
        const file = new File([blob], fileName, { type: "image/png" });
        await navigator.share({ files: [file] });
      } catch (e) { if (e && e.name !== "AbortError") errEl.textContent = e.message || String(e); }
    };
    actions.appendChild(b);
  }
  // NOT on an installed iOS app. `<a download>` is not implemented in WebKit
  // on iOS — the attribute is ignored, so the button either navigates away
  // from the app to a blob: URL or does nothing at all, and in a standalone
  // PWA there is no browser chrome to get back from it. Long-pressing the
  // image gives the real Save Image, which is what the hint already says.
  //
  // Narrowed to STANDALONE rather than to iOS: in Safari proper the tab is
  // still there to return from, and on every other platform it works.
  // In the Android app (v0.6.0-RC4): a download link does nothing in its
  // WebView, so the app saves the card itself — to Pictures/Mandarin.
  const app = window.MusicDShare;
  if (app && typeof app.saveImage === "function") {
    const b = mkBtn("ghost", icon("download"), "Download", "share-card.download");
    b.onclick = async () => {
      try {
        const url = await blobToDataUrl(blob);
        const ok = app.saveImage(String(url).slice(String(url).indexOf(",") + 1), fileName, "image/png");
        setLabel(b, ok ? "Saved to Pictures" : "Couldn’t save");
        setTimeout(() => setLabel(b, "Download"), 2500);
      } catch (e) { errEl.textContent = e.message || String(e); }
    };
    actions.appendChild(b);
  } else if (!iosStandalone()) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName; a.setAttribute("data-parity", "share-card.download");
    a.appendChild(document.createTextNode(""));
    a.innerHTML = `${icon("download")}<span>Download</span>`;
    actions.appendChild(a);
  }

  hintEl.textContent = (canCopy || canShare)
    ? "Tap a button above, or long-press the card to save."
    : "Long-press the card to save.";
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}
function mkBtn(cls, iconSvg, label, key) {
  const b = document.createElement("button");
  b.className = cls; b.setAttribute("data-parity", key);
  b.type = "button";
  b.innerHTML = `${iconSvg}<span>${label}</span>`;
  return b;
}
function setLabel(btn, text) {
  const s = btn.querySelector("span");
  if (s) s.textContent = text;
}
function icon(name) {
  const I = {
    share:    '<polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
    copy:     '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ""}</svg>`;
}

// Wire the share button inside the album modal
if (modalBtn) {
  modalBtn.addEventListener("click", () => {
    // On the now-playing screen read the live zone state directly via
    // window.__getCurrentNp() (not a mirrored global) so the card always
    // reflects the current track, not the album that was playing when the
    // modal first opened, regardless of which modal tab is active.
    const npModal = document.getElementById("album-modal");
    const isNp = npModal && npModal.classList.contains("np-mode");
    const np = isNp && window.__getCurrentNp && window.__getCurrentNp();
    if (np) {
      openShare({ title: np.line3 || "", artist: np.line2 || "", image_key: np.image_key });
      return;
    }
    const a = window.__currentAlbum;
    if (!a) return;
    openShare({ title: a.title || "", artist: a.subtitle || "", image_key: a.image_key });
  });
}
