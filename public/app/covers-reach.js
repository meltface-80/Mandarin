/* Settings → Library Scanner when the music can't be reached (bug list item 410): the folders the cover finder
 * couldn't reach (GET /api/album-scanner's and /api/covers/auto's unreachable; Extras/AutoCovers.Reach.cs) said under
 * the Album Scanner's Progress (item 411; after Find covers' line before it), as its run says them in the log, at
 * most three named. The app says the same (Scanner.coversUnreachable). */
function coversUnreachable(c) {
  const away = (c && Array.isArray(c.unreachable) && c.unreachable) || [];
  if (!away.length) return "";
  return "The music folders can't be reached (" + away.slice(0, 3).join(", ") + (away.length > 3 ? ", …" : "") +
    " not found): covers will be looked for once they are.";
}
