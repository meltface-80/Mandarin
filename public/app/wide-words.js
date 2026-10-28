/* The page's core: a column of words fitted to the screen, Read more for the rest (items 214, 216). */
// The middle of the album view's and Now playing's three columns: write-ups
// (a .bio-section each, its words in .bio-text), each as tall as its words,
// shortened together when they don't all fit, faded at the cut, with Read more
// under each (the owner's). Read more opens the whole of them in the column,
// which scrolls then; Read less fits them again, back at the top. The fitting
// is style.css's (.aw-fit); this says which are cut short, and sets the words
// on the button. A section's words changing, or it shown or hidden, fits
// them again.
/**
 * @param {HTMLElement} col the column (given .aw-fit)
 * @param {HTMLElement[]} sections its write-ups, in order
 * @param {() => boolean} live whether the column is on screen (no fitting while it isn't)
 * @param {string} parity the contract's key for Read more (docs/specs/screens.json)
 * @returns {{ fit: () => void, reset: () => void }}
 */
function fitWords(col, sections, live, parity) {
  col.classList.add("aw-fit");
  const parts = sections.map((section) => {
    const text = /** @type {HTMLElement | null} */ (section.querySelector(".bio-text"));
    if (!text) return null;
    const read = document.createElement("button");
    read.type = "button";
    read.className = "aw-read hidden"; read.dataset.parity = parity;
    read.textContent = "Read more";
    read.addEventListener("click", () => {
      const reading = !col.classList.contains("aw-reading");
      col.classList.toggle("aw-reading", reading);
      if (!reading) col.scrollTop = 0;
      fit();
    });
    text.after(read);   // under the words, over where they are from
    return { section, text, read };
  }).filter(Boolean);
  let fitting = 0;
  /** After this frame's layout: a part whose words run on past its share is shortened, with Read more under it. */
  function fit() {
    if (fitting) return;
    fitting = requestAnimationFrame(() => {
      fitting = 0;
      const reading = col.classList.contains("aw-reading");
      for (const p of /** @type {{ section: HTMLElement, text: HTMLElement, read: HTMLElement }[]} */ (parts)) {
        const shown = live() && !p.section.classList.contains("hidden");
        const clipped = shown && !reading && p.text.scrollHeight > p.text.clientHeight + 1;
        p.section.classList.toggle("aw-clipped", clipped);
        p.read.classList.toggle("hidden", !(clipped || (shown && reading)));
        const word = reading ? "Read less" : "Read more";
        if (p.read.textContent !== word) p.read.textContent = word;
      }
    });
  }
  /** Shortened again (a new album, the columns gone). */
  function reset() { col.classList.remove("aw-reading"); fit(); }
  const words = new MutationObserver(fit);
  for (const p of /** @type {{ section: HTMLElement, text: HTMLElement }[]} */ (parts)) {
    words.observe(p.text, { childList: true, characterData: true, subtree: true });
    words.observe(p.section, { attributes: true, attributeFilter: ["class"] });
  }
  window.addEventListener("resize", fit);
  return { fit, reset };
}
