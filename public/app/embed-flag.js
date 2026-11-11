// @ts-check
/* The page's first part: whether it is the Shelf's album frame (item 218; audit W-M2). */
// The Shelf (shelf.html) shows an album in this page, in a frame of its own (/?embed=album, album-embed.js), made
// once and kept, hidden, behind the shelf. There the page is its album view alone: what starts the rest of it —
// Home, the rooms read every 15 s, the zone-state and library long-polls, the update, notice and settings checks —
// doesn't start (each part says so where it starts). The Shelf has its own bar and asks all that itself; the
// frame asked it again behind it, 24 asks in 25 s.

/** Whether this page is the Shelf's album frame: read once, from the address, before any other part runs. */
const EMBED = new URLSearchParams(location.search).get("embed") === "album" && window.parent !== window;
if (EMBED) document.documentElement.classList.add("embed-album");
