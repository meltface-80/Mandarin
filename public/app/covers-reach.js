/* Settings → Library Scanner → Find covers when the music can't be reached (bug list item 410): the folders the
 * cover finder couldn't reach (GET /api/covers/auto's unreachable; Extras/AutoCovers.Reach.cs) said after its line,
 * as its run says them in the log, at most three named. The app says the same (Scanner.coversLine). */
function coversUnreachable(c) {
  const away = (c && Array.isArray(c.unreachable) && c.unreachable) || [];
  if (!away.length) return "";
  return " · the music folders can't be reached (" + away.slice(0, 3).join(", ") + (away.length > 3 ? ", …" : "") +
    " not found): covers will be looked for once they are";
}
