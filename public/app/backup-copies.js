/* ------------------------------------------------------------------ */
/*  Backup & restore's copies of the database (bug list item 410):    */
/*  the one Mandarin keeps aside as a restore swaps a database in, and */
/*  the one Mandarin OS's reinstaller makes before it switches builds  */
/*  (GET /api/backup's copies; Admin/Backup.Copies.cs). Listed beside  */
/*  the backups, each restored as a backup's whole database is and     */
/*  deleted as one is; the database alone, no settings, said so. And   */
/*  what a restore says of the music folders, for the page to show     */
/*  while Mandarin restarts. settings-backup.js draws them with these. */
/* ------------------------------------------------------------------ */

/** What a copy holds, under its title. */
const BACKUP_COPY_PARTS = "The whole database only: no settings";

/** The copies in the server's answer ([info]: GET /api/backup), each marked where: "copy". */
function backupCopies(info) {
  return ((info && info.copies) || []).map(c => Object.assign({ where: "copy" }, c));
}

/** A copy's title: what came after it ([when]: a moment, short). */
function backupCopyTitle(c, when) {
  const what = c.kind === "restore" ? "Before the restore of " + when(c.created)
    : c.kind === "dev" ? "Before switching to development builds"
    : c.kind === "latest" ? "Before switching to the latest release" : "Before a change";
  return what + " · on the server";
}

/**
 * A copy's card, as a backup's (settings-backup.js renderList): its title, when and how big, what it holds, and
 * Restore… and Delete; no Download. [h]: the page's { esc, date, when, bytes }.
 */
function backupCopyItem(c, h) {
  const meta = [h.date(c.created), h.bytes(c.bytes || 0)].join(" · ");
  return '<div class="backup-item" data-where="copy" data-id="' + h.esc(c.id) + '">' +
    '<div class="backup-item-head"><b data-parity="settings-backup.item-title">' + h.esc(backupCopyTitle(c, h.when)) + '</b>' +
    '<span data-parity="settings-backup.item-meta">' + h.esc(meta) + '</span>' +
    '<small data-parity="settings-backup.item-parts">' + h.esc(BACKUP_COPY_PARTS) + '</small></div>' +
    '<div class="backup-item-actions">' +
      '<button data-parity="settings-backup.restore" class="settings-update-btn" type="button" data-act="restore">Restore…</button>' +
      '<button data-parity="settings-backup.delete" class="settings-update-btn" type="button" data-act="delete">Delete</button>' +
    '</div>' +
    '<div class="backup-restore hidden"></div>' +
  '</div>';
}

/** The question before a copy is deleted ([date]: a moment, whole). */
function backupCopyDeleteQuestion(c, date) {
  return "Delete the copy of the database of " + date(c.created) + " from the server?";
}

/** What the page says while Mandarin restarts after a restore ([j]: its answer), the music folders kept included. */
function backupRestartingNote(j, again) {
  return "Mandarin is restarting with the restored settings. This page reloads when it's back." +
    (j && j.folders ? " " + j.folders : "") + (again || "");
}
