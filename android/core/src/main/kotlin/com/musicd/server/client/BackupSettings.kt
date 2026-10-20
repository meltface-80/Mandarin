package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/**
 * A backup in Settings → Backup & restore's list (bug list item 92): one the server keeps ([where] "server", its [id]) or a
 * file this phone saved ([where] "phone", its [uri] and file [name]), as the page's settings-backup.js lists them.
 */
data class BackupEntry(
    val where: String,
    val id: String,
    val uri: String,
    val kind: String,
    val created: Long,
    val version: String,
    val bytes: Long,
    val sealed: Boolean,
    val label: String,
    val name: String,
    /** The parts it holds, in the order it lists them. */
    val parts: List<String>,
) {
    val onPhone: Boolean get() = where == "phone"
}

/** Settings → Backup & restore as the page says it (settings-backup.js). */
object BackupSettings {
    /** The parts, by the names the server and the app give them. */
    val NAMES: Map<String, String> = linkedMapOf(
        "settings" to "Settings", "devices" to "Players", "collection" to "Your collection", "keys" to "API keys",
        "database" to "The whole database", "page" to "This device's screen settings", "app" to "This app's settings")
    /** What each holds, under its name. */
    val HINT: Map<String, String> = mapOf(
        "settings" to "Only the ones you changed",
        "devices" to "Sonos rooms, renderers and phones: names, output, DSP, levelling",
        "collection" to "Playlists, favourites, Listen later, album edits",
        "keys" to "Discogs, FanArt.tv, the Qobuz and Tidal sign-ins, and the server's Tailscale identity",
        "database" to "Everything Mandarin knows, play history included",
        "page" to "Text sizes, layout, the chosen room",
        "app" to "Downloads, USB DAC, this phone's DSP and levelling")

    /** What can be backed up from here: the server's parts and this screen's, and the app's in the app ([app]). */
    fun backupParts(app: Boolean): List<String> = listOf("settings", "devices", "collection", "keys", "database", "page") + if (app) listOf("app") else emptyList()

    /** The parts the server makes; this screen's and the app's travel beside them. */
    fun serverParts(parts: List<String>): List<String> = parts.filter { it != "page" && it != "app" }

    /** A part's name as its tick box says it: the whole database with its size once the server has said it ([dbBytes]). */
    fun partName(part: String, dbBytes: Long?): String = (NAMES[part] ?: part) + if (part == "database" && dbBytes != null) " (" + bytes(dbBytes) + ")" else ""

    /** A size as the page writes it: GB to a tenth, MB whole, KB whole and 1 at least. */
    fun bytes(n: Long): String = when {
        n >= 1_000_000_000L -> String.format(java.util.Locale.ROOT, "%.1f GB", n / 1e9)
        n >= 1_000_000L -> "${Math.round(n / 1e6)} MB"
        else -> "${maxOf(1L, Math.round(n / 1e3))} KB"
    }

    /** Every backup, on the server ([info]'s backups) and on this phone ([phone]: the app's list of its files), newest first. */
    fun list(info: JSONObject?, phone: JSONArray?): List<BackupEntry> {
        val out = ArrayList<BackupEntry>()
        info?.optJSONArray("backups")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let { out += entry("server", it) } }
        phone?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let { out += entry("phone", it) } }
        return out.sortedByDescending { it.created }
    }

    private fun entry(where: String, j: JSONObject): BackupEntry {
        val parts = j.optJSONArray("parts")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
        return BackupEntry(where, j.optString("id"), j.optString("uri"), j.optString("kind"), j.optLong("created"), j.optString("version"),
            j.optLong("bytes"), j.optBoolean("sealed"), j.optString("label"), j.optString("name"), parts)
    }

    /** Where it is, in bold on its card. */
    fun title(b: BackupEntry): String = if (b.onPhone) "On this phone" else if (b.kind == "auto") "Before restore · on the server" else "On the server"

    /** When, what version, how big, sealed or not, and the file's name or the device it came from ([date]: a moment as the phone writes it). */
    fun meta(b: BackupEntry, date: (Long) -> String): String {
        val m = mutableListOf(date(b.created), "v" + b.version.ifEmpty { "?" }, bytes(b.bytes))
        if (b.sealed) m += "sealed"
        if (b.onPhone) m += b.name else if (b.label.isNotEmpty()) m += "from " + b.label
        return m.filter { it.isNotEmpty() }.joinToString(" · ")
    }

    /** What it holds, by name. */
    fun partsLine(b: BackupEntry): String = b.parts.joinToString(", ") { NAMES[it] ?: it }

    /** The parts a restore of [b] offers: what it holds (a phone's file with none listed: all), the app's only in the app. */
    fun restoreParts(b: BackupEntry, app: Boolean): List<String> =
        if (b.onPhone) b.parts.ifEmpty { backupParts(app) } else b.parts.filter { it != "app" || app }

    /** The question before a restore of [want]. */
    fun restoreQuestion(want: List<String>): String =
        "Restore " + want.joinToString(", ") { NAMES[it] ?: it } + "?" +
            (if (serverParts(want).isNotEmpty()) " This puts them back for every device, and Mandarin restarts. A backup of how things are now is kept first." else "") +
            (if ("database" in want) " The whole database replaces everything Mandarin knows; your account and sign-ins stay." else "")

    /** The question before [b] is deleted. */
    fun deleteQuestion(b: BackupEntry, date: (Long) -> String): String =
        if (b.onPhone) "Delete the backup file " + b.name + " of " + date(b.created) + " from this phone?"
        else "Delete the backup on the server of " + date(b.created) + "?"

    /** What is said once a backup is made. */
    fun backedUp(bytes: Long, created: Long, date: (Long) -> String): String = "Backed up: " + bytes(bytes) + ", " + date(created) + "."

    /** What is said when there is no backup yet: on the phone the files count too. */
    fun empty(app: Boolean): String = if (app) "No backups yet." else "No backups on the server yet."

    /** A restore's answer, said: what went wrong (none when only cancelled), or the folders to choose again (Android asks once an install). */
    fun restoreSaid(j: JSONObject): String? = when {
        !j.optBoolean("ok") -> if (j.optBoolean("cancelled")) null else j.optString("error").ifEmpty { "Restore failed" }
        (j.optJSONObject("app_result")?.optJSONArray("choose_again")?.length() ?: 0) > 0 -> CHOOSE_AGAIN
        else -> null
    }

    const val CHOOSE_AGAIN = "Choose the music and download folders again in Settings: Android asks once per install."
    const val SEALED = "Its passphrase (for the keys and the whole database)"
    const val FILE_PASS = "Its passphrase, if it was sealed with one"
    const val PASS_HINT = "Optional. Seals the API keys, the Qobuz and Tidal sign-ins and the server's Tailscale identity, in the keys part or the whole database. Restoring those asks for it, and nothing opens them without it: keep it safe."
    const val BACKUP_INFO = "Choose what goes in. Settings are only the ones you changed. Players are every Sonos room, renderer and phone with its own name, output, DSP and volume levelling. Your collection is playlists, Dynamic Playlists, favourites, Listen later and album edits. The whole database is everything Mandarin knows, play history included. The API keys part carries the Qobuz and Tidal sign-ins and the server's Tailscale identity, so a restore onto a fresh install is the same node on your tailnet: the same address, no signing in again, and the app still reaches it away from home. A backup never holds your password or other devices' sign-ins. Without a passphrase the keys and sign-ins are in the file as they are, so keep it as you would keep them; with one, they are sealed (AES-256) and only that passphrase opens them. It works away from home too, over Tailscale; the whole database is a large file over mobile data."
    const val RESTORE_INFO = "Restoring puts back the parts you tick, as they were when the backup was made, for every device. A backup of how things are now is kept here first (Before restore), so a restore can be undone. Mandarin restarts afterwards and this page reloads."
}
