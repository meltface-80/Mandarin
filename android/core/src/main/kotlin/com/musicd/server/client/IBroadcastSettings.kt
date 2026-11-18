package com.musicd.server.client

import org.json.JSONObject
import java.util.Locale

/**
 * Settings → Services → iBroadcast as the server keeps the account (GET /api/settings/ibroadcast; item 443): the page's
 * ibroadcastWords (settings-ibroadcast.js) in what they say. Signed out, a sign-in under way: the address to open, the
 * code to approve Mandarin with there, or what went wrong. Signed in: who, whether the account is Premium, the formats
 * iBroadcast takes, and the upload (item 446): how the one under way is going, or what the last one did.
 */
data class IBroadcastAccount(
    val connected: Boolean,
    /** The line under the title: who is signed in, or how a sign-in is going; "" signed out with none under way. */
    val status: String,
    /** Whether the account is Premium, in words; "" signed out. */
    val premium: String,
    /** The formats iBroadcast takes, in capitals; "" signed out. */
    val formats: String,
    /** A sign-in under way: the address to open (as shown, [linkText]) and the code; none otherwise. */
    val pendingUrl: String?,
    val pendingCode: String,
    /** A sign-in that went wrong (no longer waited for). */
    val pendingError: Boolean,
    /** Whether iBroadcast's albums are in the library (item 444). */
    val import: Boolean = true,
    /** The library being read from iBroadcast now (asked again shortly while it is). */
    val reading: Boolean = false,
    /** What the library holds of iBroadcast; "" signed out. */
    val libraryStatus: String = "",
    /** The upload (item 446), as the page says it. */
    val upload: IBroadcastUploadWords = IBroadcastUploadWords(false, "", "", ""),
    /** The upload on a schedule (item 447): on or off, its hours, and the Library Scanner's said beside them. */
    val schedule: Boolean = false,
    val start: String = "",
    val end: String = "",
    val scannerHours: String = "",
    /** What the upload is from and how hard it pushes (item 451): the choices as kept, and the drives offered. */
    val choices: IBroadcastUploadChoices = IBroadcastUploadChoices(null, "", 3, false, 3, false, 1, emptyList()),
) {
    /** The address of a sign-in under way, without its scheme. */
    val linkText: String get() = pendingUrl?.replace(Regex("^https?://"), "") ?: ""
    /** Whether to look again shortly: a sign-in waited for, or the library being read. */
    val again: Boolean get() = (pendingUrl != null && !pendingError) || reading || (connected && upload.running)
}

/**
 * Upload from ([from]: "all", one drive's folder, "drives" for several, or none chosen; [fromNote] said where none is),
 * how many at once, and while music plays at home or away (items 451, 472).
 */
data class IBroadcastUploadChoices(val from: String?, val fromNote: String, val atOnce: Int, val home: Boolean, val homeAtOnce: Int, val away: Boolean, val awayAtOnce: Int,
    /** What may be chosen: All drives, then each drive offered, as (value, name). */
    val sources: List<Pair<String, String>>,
    /** The values lit: All drives and every drive where All drives is chosen, else the drives chosen, any number. */
    val on: Set<String> = emptySet()) {
    /**
     * Upload from's [value] tapped (ibroadcastFromTap): the change to keep. All drives on or off; a drive on or off among
     * the rest (with All drives on, the others but that one).
     */
    fun tap(value: String): org.json.JSONObject {
        if (value == "all") return org.json.JSONObject().put("from", if (from == "all") org.json.JSONObject.NULL else "all")
        val next = on - "all"
        val drives = if (value in next) next - value else next + value
        return org.json.JSONObject().put("drives", org.json.JSONArray(drives.toList()))
    }
}

/** The upload as the page says it (ibroadcastUploadWords): under way or not, the line under Upload, the progress, and the files left out or not sent, a line each. */
data class IBroadcastUploadWords(val running: Boolean, val status: String, val progress: String, val problems: String)

object IBroadcastSettings {
    /** The account [j] as the server answered it; [at]: a moment (milliseconds) as the phone writes a date and time. */
    fun parse(j: JSONObject, at: (Long) -> String = { it.toString() }): IBroadcastAccount {
        val on = j.optBoolean("connected")
        val pending = if (on) null else j.optJSONObject("pending")
        val who = j.optJSONObject("user")?.optString("name").orEmpty().ifEmpty { "your account" }
        val status = when {
            on -> "Signed in as $who"
            pending != null -> pending.optString("error").ifEmpty { "Waiting for Mandarin to be approved on iBroadcast…" }
            else -> ""
        }
        val premium = when {
            !on -> ""
            j.opt("premium") == true -> "Yes: your files play as they are"
            j.opt("premium") == false -> "No: iBroadcast plays everything as 128 kbps MP3"
            else -> "iBroadcast didn't say"
        }
        val list = j.optJSONArray("formats")
        val formats = if (!on) "" else (0 until (list?.length() ?: 0)).map { list!!.optString(it).uppercase() }.filter { it.isNotEmpty() }
            .joinToString(", ").ifEmpty { "iBroadcast didn't say" }
        val l = j.optJSONObject("library")
        val import = l?.opt("import") != false
        val reading = on && l?.optBoolean("reading") == true
        return IBroadcastAccount(on, status, premium, formats, pending?.optString("url")?.takeIf { it.isNotEmpty() }, pending?.optString("code").orEmpty(),
            pending?.optString("error").orEmpty().isNotEmpty(), import, reading, if (on) libraryWords(l, at) else "", uploadWords(if (on) j.optJSONObject("upload") else null, at),
            on && j.optJSONObject("schedule")?.optBoolean("on") == true, j.optJSONObject("schedule")?.optString("start").orEmpty(),
            j.optJSONObject("schedule")?.optString("end").orEmpty(), if (on) scannerHours(j.optJSONObject("scanner_hours")) else "", choices(j))
    }

    /** The upload's choices and the drives offered ([j]: the state), as the page has them. */
    fun choices(j: JSONObject): IBroadcastUploadChoices {
        val c = j.optJSONObject("upload_settings") ?: JSONObject()
        val from = c.optString("from").takeIf { it.isNotEmpty() && !c.isNull("from") }
        val list = j.optJSONArray("upload_sources")
        val sources = listOf("all" to "All drives") + (0 until (list?.length() ?: 0)).mapNotNull { list!!.optJSONObject(it) }.map { it.optString("path") to it.optString("name") }
        // Lit (ibroadcastFromOn, item 472): All drives and every drive where All drives is chosen, else the drives chosen.
        val drives = c.optJSONArray("drives")?.let { a -> (0 until a.length()).map { a.optString(it) } }
            ?: listOfNotNull(from?.takeIf { it != "all" && it != "drives" })
        val on = if (from == "all") sources.map { it.first }.toSet() else drives.toSet()
        return IBroadcastUploadChoices(from, fromNote(from), c.optInt("at_once", 3), c.optBoolean("home"), c.optInt("home_at_once", 3), c.optBoolean("away"), c.optInt("away_at_once", 1), sources, on)
    }

    /** What is said under Upload from (ibroadcastFromNote): to choose, where nothing is. */
    fun fromNote(from: String?): String = if (from == null) "Choose All drives, or the drives to upload from." else ""

    /** What the upload schedule's switch says (item 447; ibroadcastScheduleNote). */
    fun scheduleNote(on: Boolean): String = if (on) "Uploads each day between these times, stopping at the end" else "Off: uploads only when you tap Upload now"

    /** The Library Scanner's hours, said beside the upload window's ([h]: the state's scanner_hours; ibroadcastScannerHours). */
    fun scannerHours(h: JSONObject?): String = when {
        h == null -> ""
        h.optBoolean("on") -> "The Library Scanner runs ${h.optString("start")}–${h.optString("end")}: the upload window can't overlap it."
        else -> "The Library Scanner has no hours (its Schedule is off): give it hours in Library Scanner to upload on a schedule."
    }

    /** A size in bytes as the page says it (ibroadcastSize): "512 KB", "3.4 MB", "1.2 GB". */
    fun size(b: Double): String = when {
        b >= 1e9 -> String.format(Locale.ROOT, "%.1f GB", b / 1e9)
        b >= 1e6 -> String.format(Locale.ROOT, "%.1f MB", b / 1e6)
        else -> "${Math.round(b / 1e3)} KB"
    }

    /** The time left, in words (ibroadcastLeft): "about 2 h 5 min left", "about 12 min left", "under a minute left". */
    fun left(s: Long): String {
        val h = s / 3600
        val m = (s % 3600) / 60
        return if (h > 0) "about $h h $m min left" else if (m > 0) "about $m min left" else "under a minute left"
    }

    /** The upload ([u]: the state's upload, none before the first) as the page says it (ibroadcastUploadWords). */
    fun uploadWords(u: JSONObject?, at: (Long) -> String): IBroadcastUploadWords {
        if (u == null) return IBroadcastUploadWords(false, "Nothing uploaded from here yet.", "", "")
        val list = u.optJSONArray("problems")
        val problems = (0 until (list?.length() ?: 0)).mapNotNull { list!!.optJSONObject(it) }
            .joinToString("\n") { it.optString("file").split('/', '\\').last() + ": " + it.optString("why") }
        val n = { k: String -> u.optLong(k) }
        if (u.optBoolean("running")) {
            if (n("files_total") == 0L && n("files_done") == 0L) return IBroadcastUploadWords(true, "Looking at what iBroadcast has…", "", problems)
            val parts = mutableListOf("${n("files_done")} of ${n("files_total")} files", size(u.optDouble("bytes_done", 0.0)) + " of " + size(u.optDouble("bytes_total", 0.0)))
            if (u.optDouble("speed", 0.0) > 0) parts += size(u.optDouble("speed")) + "/s"
            if (u.has("eta") && !u.isNull("eta")) parts += left(u.optLong("eta"))
            val status = if (u.optBoolean("held")) (if (u.optString("held_where") == "away") "Paused while music plays away from home" else "Paused while music plays") else "Uploading " + (u.optString("album").takeIf { it.isNotEmpty() && !u.isNull("album") } ?: "…")
            return IBroadcastUploadWords(true, status, parts.joinToString(" · "), problems)
        }
        val how = if (u.optBoolean("stopped")) "Stopped" else u.optString("error").takeIf { it.isNotEmpty() && !u.isNull("error") }?.let { "Ended: $it" } ?: "Done"
        val said = mutableListOf("${n("uploaded")} uploaded", "${n("already")} already in iBroadcast")
        if (n("converted") > 0) said += "${n("converted")} made FLAC"
        if (n("skipped") > 0) said += "${n("skipped")} left out"
        if (n("failed") > 0) said += "${n("failed")} not sent"
        return IBroadcastUploadWords(false, how + " · " + at(u.optLong("finished")), said.joinToString(" · "), problems)
    }

    /** What the library holds of iBroadcast ([l]: the state's library), as the page says it (ibroadcastLibraryWords). */
    fun libraryWords(l: JSONObject?, at: (Long) -> String): String {
        if (l?.opt("import") == false) return "Off: your iBroadcast albums are not in the library. Switch on to show them."
        if (l?.optBoolean("reading") == true) return READING
        if (l == null || !l.has("albums") || l.isNull("albums")) return "Your iBroadcast library is read shortly after signing in."
        val n = l.optInt("albums")
        val here = l.optInt("also_here")
        return "$n album" + (if (n == 1) "" else "s") + " in iBroadcast" + (if (here > 0) " · $here of them here as files too, shown once" else "") + " · updated " + at(l.optLong("at"))
    }

    const val UPLOAD_INFO = "Your music here uploaded to iBroadcast, album by album, each file as it is. DSD, which iBroadcast can't play, goes up as FLAC at 24-bit/176.4 kHz (88.2 kHz where that is over iBroadcast's 1.5 GB a file); a lossless file over 1.5 GB as FLAC at its most compression, or at half its rate where that is still over. A file already in iBroadcast isn't sent again, so an upload stopped goes on where it was. Your files here are only read: never changed, moved or deleted. While music plays, it waits."
    const val READING = "Reading your iBroadcast library…"
    const val IMPORT_INFO = "Every album in your iBroadcast library as an album here: on the walls, in search, in Smart Picks and Listen later. One you also have here as files is shown once, from the files. Read again whenever iBroadcast says your library changed (Mandarin looks every ten minutes), and by Update library now. On unless you switch it off; off, none of them are in the library."

    const val INFO = "Your iBroadcast account: your own music, uploaded to iBroadcast's servers. Sign in shows a link and a code: open the link on any device, sign in to iBroadcast there and approve Mandarin with the code. Mandarin keeps iBroadcast's sign-in token, never a password, and asks only to read your account and library, change your library and upload to it. Premium is needed to play your files as they are (lossless), rather than as 128 kbps MP3."
    const val NOTE = "Open this link, sign in to iBroadcast there, approve Mandarin with this code, and come back. Mandarin notices by itself."
}
