package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

/** A button of the scanner's (.id-btn): its [label], the [action] it asks for, [primary] in the accent. */
data class ScanButton(val label: String, val action: String, val primary: Boolean = false)

/** One of the scanner's lists (proposed, unidentified, applied, rejected): its [title], its [note] (none for the declined). */
data class ScanSection(val kind: String, val title: String, val note: String?)

/** The MusicBrainz pack as the page says it: [state] and the [error] after it (red), its [buttons] ([enabled] or not). */
data class PackView(val state: String, val error: String?, val buttons: List<ScanButton>, val enabled: Boolean, val following: Boolean)

/**
 * Settings → Library Scanner as the page says it (settings-scanner.js and settings-scanner-albums.js; bug list item 90):
 * the schedule and what runs now, identification's progress and status, Measure ReplayGain's, the clean-up, the processor,
 * the MusicBrainz pack, and each album of the lists with what the scan found for it. Every answer is the server's own
 * (/api/identify, /api/loudness, /api/cpu, /api/library/cleanup, /api/identify/pack); numbers as the phone writes them.
 */
object Scanner {
    /** A count as the phone writes it (the page's toLocaleString). */
    fun num(n: Long, locale: Locale = Locale.getDefault()): String = NumberFormat.getIntegerInstance(locale).format(n)
    private fun num(n: Int, locale: Locale) = num(n.toLong(), locale)

    /** Bytes as whole megabytes (the page's mbs). */
    fun mbs(bytes: Double, locale: Locale = Locale.getDefault()): String =
        NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 0 }.format(bytes / 1048576.0) + " MB"

    /** "Artist — Title", or the title alone. */
    fun names(artist: String?, title: String?): String = (if (!artist.isNullOrEmpty()) "$artist — " else "") + title.orEmpty()
    private fun names(o: JSONObject?) = if (o == null) "…" else names(o.text("artist"), o.text("title"))
    private fun albumNames(c: JSONObject?) = if (c == null) "…" else names(c.text("subtitle"), c.text("title"))
    private fun plural(n: Int, one: String, many: String = one + "s") = if (n == 1) one else many

    /** The line under identification's progress: what it is doing, or why it isn't. */
    fun scanStatus(st: JSONObject): String {
        val start = st.optJSONObject("settings")?.text("start").orEmpty()
        return when (st.text("reason")) {
            "off" -> "Off."
            "waiting" -> "Waits for $start (the server's clock)."
            "scanning" -> "Paused while the library is being scanned."
            "unreachable" -> "MusicBrainz isn't answering; trying again in a few minutes."
            "pack" -> "MusicBrainz isn't answering, so the albums the MusicBrainz pack can answer are being matched from it: " + names(st.optJSONObject("current"))
            "checking" -> "Checking: " + names(st.optJSONObject("current"))
            "starting" -> "Starting…"
            else -> "Every album has been looked at. New ones are checked as they arrive."
        }
    }

    /** Measure ReplayGain's own line, while it is on: why it is or isn't measuring. */
    fun loudStatus(st: JSONObject?, loud: JSONObject?): String {
        val start = st?.optJSONObject("settings")?.text("start") ?: "the start time"
        return when (loud?.text("reason")) {
            "waiting" -> "Waits for $start (the server's clock)."
            "scanning" -> "Paused while the library is being scanned."
            "identifying" -> "Waits for identification to look at the next albums."
            "measuring" -> "Measuring: " + albumNames(loud.optJSONObject("current"))
            "done" -> "Every track is known. New ones are measured as they arrive."
            else -> ""
        }
    }

    /** The schedule's "now": what is running, or why nothing is. */
    fun nowLine(st: JSONObject, loud: JSONObject?): String {
        val parts = mutableListOf<String>()
        when (st.text("reason")) {
            "checking" -> parts += "Identifying " + names(st.optJSONObject("current"))
            "starting" -> parts += "Identifying the next album"
            "pack" -> parts += "Matching from the MusicBrainz pack"
        }
        val lr = loud?.text("reason")
        if (lr == "measuring") parts += "Measuring " + albumNames(loud.optJSONObject("current"))
        if (parts.isNotEmpty()) return "Now: " + parts.joinToString(" · ")
        val r = st.text("reason")
        if (r == "waiting" || lr == "waiting") return "Now: waiting for " + st.optJSONObject("settings")?.text("start").orEmpty() + "."
        if (r == "scanning" || lr == "scanning") return "Now: waiting while the library is scanned."
        if (r == "unreachable") return "Now: MusicBrainz isn't answering; trying again in a few minutes."
        return "Now: nothing to do."
    }

    /** Identification's progress, counted; none until the server has answered. */
    fun progressLine(st: JSONObject?, locale: Locale = Locale.getDefault()): String? {
        val p = st?.optJSONObject("progress") ?: return null
        return num(p.optInt("checked"), locale) + " of " + num(p.optInt("eligible"), locale) + " albums checked · " + num(p.optInt("applied"), locale) + " applied · " +
            num(p.optInt("proposed"), locale) + " proposed · " + num(p.optInt("unidentified"), locale) + " unidentified"
    }

    /** Whether there is anything to look at again (Check the proposed and unidentified again). */
    fun canRecheck(st: JSONObject?): Boolean = st?.optJSONObject("progress")?.let { it.optInt("proposed") > 0 || it.optInt("unidentified") > 0 } == true

    /** Measure ReplayGain's counts; none until the server has answered. */
    fun loudLine(loud: JSONObject?, locale: Locale = Locale.getDefault()): String? {
        if (loud == null) return null
        val failed = loud.optInt("failed")
        return num(loud.optInt("tagged"), locale) + " tagged · " + num(loud.optInt("measured"), locale) + " measured · " + num(loud.optInt("left"), locale) + " to measure" +
            (if (failed > 0) " · " + num(failed, locale) + " couldn’t be read" else "")
    }

    /** The streamed tracks that aren't measured, said; none when there are none. */
    fun streamedNote(loud: JSONObject?, locale: Locale = Locale.getDefault()): String? {
        val n = loud?.optInt("streamed") ?: 0
        return if (n > 0) num(n, locale) + " Qobuz and Tidal track" + plural(n, "") + " aren’t measured." else null
    }

    /** The processor's line and the note under it; none until the server has answered. */
    fun cpuLine(cpu: JSONObject?): String? {
        val cores = cpu?.optJSONArray("cores") ?: return null
        fun c(k: Int) = "$k core" + plural(k, "")
        return if (cpu.optBoolean("split")) c(cores.length()) + " · " + (cpu.optJSONArray("playback")?.length() ?: 0) + " kept for playback" + (if (cpu.optBoolean("dsp")) " (DSP in use)" else "") +
            " · " + (cpu.optJSONArray("background")?.length() ?: 0) + " for scanning and everything else"
        else c(cores.length()) + ", shared"
    }
    fun cpuNote(cpu: JSONObject?): String = if (cpu?.optJSONArray("cores") == null) "…" else if (!cpu.optBoolean("split")) "Playback comes first by priority."
        else if (cpu.optBoolean("raised")) "Playback also runs at a higher priority." else "To run playback at a higher priority too, start the container with --cap-add SYS_NICE."

    /** A clean-up kind's button ("Remove 2 albums"), or none when it has nothing to remove. */
    fun cleanupButton(cleanup: JSONObject?, kind: String, locale: Locale = Locale.getDefault()): String? {
        val n = cleanup?.optJSONObject(kind)?.optInt("albums") ?: 0
        return if (n > 0) "Remove " + num(n, locale) + " album" + plural(n, "") else null
    }
    fun filesNote(cleanup: JSONObject?, locale: Locale = Locale.getDefault()): String {
        val f = cleanup?.optJSONObject("files") ?: return if (cleanup == null) "…" else "Every album’s files are where the scanner last found them."
        val a = f.optInt("albums"); val folders = f.optInt("folders")
        return if (a > 0) num(a, locale) + " album" + plural(a, "") + " (" + num(f.optInt("tracks"), locale) + " tracks) in " + num(folders, locale) + " folder" + plural(folders, "") + " the scanner couldn’t find."
        else "Every album’s files are where the scanner last found them."
    }
    fun servicesNote(cleanup: JSONObject?): String = if (cleanup == null) "…"
        else if (cleanup.optJSONObject("qobuz")?.optBoolean("signed_in") == true) "Qobuz albums neither in your favourites or purchases nor needed by a playlist."
        else "Signed out of Qobuz: every Qobuz album the database still holds."
    /** What is asked before a kind is removed. */
    fun cleanupQuestion(kind: String, n: Int, locale: Locale = Locale.getDefault()): String =
        if (kind == "files") "Remove " + num(n, locale) + " album" + plural(n, "") + " whose files are gone from the server?\n\nPlays stay in history; their edits, hearts and Listen later go. If the files come back, a scan adds the albums afresh."
        else "Remove " + num(n, locale) + " Qobuz album" + plural(n, "") + " from the database?\n\nPlays stay in history. Signing in and favouriting again brings an album back."

    /** The MusicBrainz pack, said ([day]: an ISO date as the phone writes it); [busy]: something under way here. */
    fun pack(pack: JSONObject, busy: Boolean, day: (String) -> String, locale: Locale = Locale.getDefault()): PackView {
        val have = pack.optJSONObject("installed"); val job = pack.optJSONObject("job"); val latest = pack.optJSONObject("latest")
        val jobError = job?.text("error").orEmpty().ifEmpty { null }
        val phase = job?.text("phase").orEmpty()
        val running = job != null && jobError == null && phase != "done"
        val state: String; var warn: String? = null; val buttons = mutableListOf<ScanButton>(); var enabled = !busy
        if (running && phase == "moving") state = "Moving the pack… between drives this takes a minute or two."
        else if (running) {
            val total = job!!.optDouble("total", 0.0); val done = job.optDouble("done", 0.0)
            state = if (phase == "checking") "Asking GitHub…" else "Downloading… " + (if (total > 0) Math.floor(done / total * 100).toInt() else 0) + " % (" + mbs(done, locale) + " of " + mbs(total, locale) + ")"
        } else if (have != null) {
            state = num(have.optLong("releases"), locale) + " releases · from " + day(have.text("built")) + " · " + mbs(have.optDouble("size", 0.0), locale) + (if (pack.optBoolean("newer")) " · a newer one is out" else "")
            if (pack.optBoolean("newer")) buttons += ScanButton("Update", "download", true)
            buttons += ScanButton("Remove", "remove")
        } else {
            val free = if (pack.isNull("free") || !pack.has("free")) null else pack.optDouble("free")
            state = if (latest != null) {
                if (free != null && free < latest.optDouble("size", 0.0) + 200 * 1048576.0) warn = "Not enough room in this folder: choose another below."
                "Not downloaded. A " + mbs(latest.optDouble("gz_size", 0.0), locale) + " download that unpacks to " + mbs(latest.optDouble("size", 0.0), locale) + " in the folder below."
            } else if (pack.optBoolean("checking")) "Not downloaded. Asking GitHub what’s published…"
            else "Not downloaded." + pack.text("check_error").let { if (it.isNotEmpty()) " ($it)" else "" }
            buttons += ScanButton("Download", "download", true)
            if (latest == null) enabled = false
        }
        return PackView(state, listOfNotNull(warn, jobError).joinToString(" ").ifEmpty { null }, buttons, enabled, running)
    }

    /** Where the pack is kept, said, and what is wrong with the place (red); [jobError] already said above it. */
    fun packFolder(pack: JSONObject, locale: Locale = Locale.getDefault()): Pair<String, String?> {
        val dir = pack.text("dir"); val data = pack.text("data_dir")
        val free = if (pack.isNull("free") || !pack.has("free")) "" else " · " + mbs(pack.optDouble("free"), locale) + " free"
        val problem = pack.text("dir_problem").ifEmpty { null }?.takeIf { it != pack.optJSONObject("job")?.text("error") }
        return (dir + (if (dir == data) " (the data folder)" else "") + free) to problem
    }

    /** The lists in the page's order, each with its note. */
    val SECTIONS = listOf(
        ScanSection("proposed", "Proposed", "Close, but not close enough to apply unasked. Tap the name to see the album; Accept writes the names shown."),
        ScanSection("unidentified", "Unidentified", "Nothing near enough was found. Tap the name, then ⋯ → Edit album to name it yourself."),
        ScanSection("applied", "Applied", "Names written by the scan. Undo puts back what the album had."),
        ScanSection("rejected", "Declined", null))

    /** The page shows the first 60 of a list until Show all; Show all shows up to 500 (100 applied or declined). */
    const val SHOW = 60
    fun showAll(kind: String, count: Int): Int = minOf(count, if (kind == "applied" || kind == "rejected") 100 else 500)

    /** What is said once an album's action is done. */
    fun actDone(action: String): String? = mapOf("accept" to "Applied", "reject" to "Declined", "undo" to "Put back", "recheck" to "It will be looked at again")[action]

    /** An album's actions, by the list it is on. */
    fun actions(kind: String): List<ScanButton> = when (kind) {
        "proposed" -> listOf(ScanButton("Accept", "accept", true), ScanButton("Reject", "reject"))
        "applied" -> listOf(ScanButton("Undo", "undo"))
        else -> listOf(ScanButton("Check again", "recheck"))
    }

    /** The pressing as MusicBrainz sets it apart from the album: " · 2015 remaster, released 2015", or nothing. */
    fun version(c: JSONObject?): String {
        if (c == null) return ""
        val bits = mutableListOf<String>()
        c.text("edition").takeIf { it.isNotEmpty() }?.let { bits += it }
        val ry = c.optInt("release_year"); val y = c.optInt("year")
        if (ry > 0 && y > 0 && ry != y) bits += "released $ry"
        val p = c.optJSONObject("parts") ?: JSONObject()
        val missing = p.optInt("missing_tracks"); val extra = p.optInt("extra_tracks")
        if (p.optBoolean("edition")) bits += "the same record; this pressing has " + (if (missing == 1) "1 more track" else "$missing more tracks")
        else if (missing > 0) bits += if (missing == 1) "1 track of the release missing here" else "$missing tracks of the release missing here"
        if (extra > 0) bits += if (extra == 1) "1 track the release hasn't" else "$extra tracks the release hasn't"
        return if (bits.isEmpty()) "" else " · " + bits.joinToString(", ")
    }

    /** An album's second line on its list ([kind]), as the page's albumRow writes it; [itunes]: iTunes is asked too. */
    fun line2(it: JSONObject, kind: String, itunes: Boolean): String {
        val c = it.optJSONObject("candidate")
        val from = if (c?.text("source") == "itunes") " · from iTunes" else ""
        val why = it.optJSONArray("why")?.let { w -> if (w.length() > 0) " — " + (0 until w.length()).joinToString(", ") { w.optString(it) } else "" }.orEmpty()
        val sim = it.optInt("similarity")
        var line = when (kind) {
            "proposed" -> "→ " + names(c) + (if ((c?.optInt("year") ?: 0) > 0) " (" + c!!.optInt("year") + ")" else "") + version(c) + " · $sim % alike" + why +
                (if (it.optBoolean("ambiguous")) " · two releases fit" else "") + from
            "applied" -> "was " + names(it.optJSONObject("scanned")) + (if ((c?.optInt("year") ?: 0) > 0) " · " + c!!.optInt("year") else "") + version(c) + from
            "unidentified" -> if (c != null) "nearest: " + names(c) + " · $sim %" + why + from else "nothing with this title on MusicBrainz" + if (itunes) " or iTunes" else ""
            else -> if (c != null) "declined: " + names(c) else ""
        }
        if (kind == "applied" && c != null) {
            val manual = c.text("manual")
            val by = c.text("matched_by")
            if (manual.isNotEmpty()) line += " · matched by " + when (manual) { "barcode" -> "barcode"; "pick" -> "you"; else -> "link" }
            else if (by.isNotEmpty()) line += " · matched by " + (mapOf("musicbrainz-id" to "the files' MusicBrainz ID", "barcode" to "barcode", "catalogue-number" to "catalogue number", "isrc" to "ISRCs")[by] ?: by) +
                if (c.optBoolean("from_pack")) " (pack)" else ""
        }
        return line
    }

    /** The counts the lists were last asked for at: when the server's move, the lists are asked for again. */
    fun countsOf(st: JSONObject?): String = st?.optJSONObject("progress")?.let { p -> listOf("checked", "applied", "proposed", "unidentified", "rejected").joinToString(",") { p.optInt(it).toString() } }.orEmpty()

    /** A list from an answer, empty when it has none. */
    fun list(j: JSONObject?, kind: String): List<JSONObject> = j?.optJSONArray(kind)?.let { a: JSONArray -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } }.orEmpty()
}

/**
 * A field's text, or "" where the server sends none or null. Android's org.json reads a JSON null as the word "null"
 * (the server's "no problem with the folder" showed as a red "null"; bug list item 103), where the JVM's reads "".
 */
private fun JSONObject.text(key: String): String = if (!has(key) || isNull(key)) "" else optString(key)
