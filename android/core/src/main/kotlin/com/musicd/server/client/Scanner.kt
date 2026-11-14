package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

/** A button of the scanner's (.id-btn): its [label], the [action] it asks for, [primary] in the accent. */
data class ScanButton(val label: String, val action: String, val primary: Boolean = false)

/** A folder of albums to place by hand (item 411): its [kind] (the list it opens), [title], the [sub] under it on the page, and the [note] over its albums. */
data class ScanFolder(val kind: String, val title: String, val count: Int, val sub: String, val note: String)

/** A kind of album the clean-up could remove ([kind]: files, qobuz or tidal), said ([words]), with its count ([albums]). */
data class CleanupRow(val kind: String, val words: String, val albums: Int)

/** The MusicBrainz pack as the page says it: [state] and the [error] after it (red), its [buttons] ([enabled] or not). */
data class PackView(val state: String, val error: String?, val buttons: List<ScanButton>, val enabled: Boolean, val following: Boolean)

/**
 * Settings → Library Scanner as the page says it (settings-scanner.js and its parts; bug list items 90 and 411): the
 * Album Scanner's one switch, its Progress readout and what it is doing now, the albums to place by hand as folders,
 * Schedule, the MusicBrainz pack, the clean-up and the processor, and each album of a folder with what the scan found
 * for it. Every answer is the server's own (/api/album-scanner, /api/identify, /api/cpu, /api/library/cleanup,
 * /api/identify/pack); numbers as the phone writes them.
 */
object Scanner {
    /** The note under the switch; off, that none of it is done. */
    const val NOTE = "Identifies albums, measures ReplayGain and finds missing covers, while nothing plays."
    fun note(scan: JSONObject?): String = NOTE + if (scan != null && !scan.optBoolean("on")) " Off: none of this is done." else ""

    /** The Album Scanner's state [scan] with [patch] laid over it ({ on, schedule, start, end }, as POSTed): shown at once, the server's answer taking its place (item 200). */
    fun withScanner(scan: JSONObject?, patch: JSONObject): JSONObject? = scan?.let { s ->
        JSONObject(s.toString()).also { c ->
            if (patch.has("on")) c.put("on", patch.getBoolean("on"))
            val sch = c.optJSONObject("schedule") ?: JSONObject().also { c.put("schedule", it) }
            if (patch.has("schedule")) sch.put("on", patch.getBoolean("schedule"))
            for (k in listOf("start", "end")) if (patch.has(k)) sch.put(k, patch.getString(k))
        }
    }

    /** A count as the phone writes it (the page's toLocaleString). */
    fun num(n: Long, locale: Locale = Locale.getDefault()): String = NumberFormat.getIntegerInstance(locale).format(n)
    private fun num(n: Int, locale: Locale) = num(n.toLong(), locale)

    /** Bytes as whole megabytes (the page's mbs). */
    fun mbs(bytes: Double, locale: Locale = Locale.getDefault()): String =
        NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 0 }.format(bytes / 1048576.0) + " MB"

    /** "Artist — Title", or the title alone. */
    fun names(artist: String?, title: String?): String = (if (!artist.isNullOrEmpty()) "$artist — " else "") + title.orEmpty()
    private fun names(o: JSONObject?) = if (o == null) "…" else names(o.text("artist"), o.text("title"))
    private fun plural(n: Int, one: String, many: String = one + "s") = if (n == 1) one else many

    // ------------------------------------------------------------ the readout (scanner-words.js)

    /** The share of the library's albums with every step done, rounded down: 100 is every one of them. */
    fun percent(scan: JSONObject?): Int {
        val all = scan?.optInt("albums") ?: 0
        return if (all > 0) Math.floorDiv(scan!!.optInt("done") * 100L, all.toLong()).toInt() else 0
    }

    /** "9,960 of 14,119 albums · 70%"; none until the server has answered. */
    fun progressCount(scan: JSONObject?, locale: Locale = Locale.getDefault()): String? {
        if (scan == null) return null
        val all = scan.optInt("albums")
        return num(scan.optInt("done"), locale) + " of " + num(all, locale) + (if (all == 1) " album · " else " albums · ") + percent(scan) + "%"
    }

    /** "Now: U2 — Pop · measuring loudness" while it works; else what it waits for, or that it is done. */
    fun nowLine(scan: JSONObject): String {
        val now = scan.optJSONObject("now") ?: JSONObject()
        val album = now.optJSONObject("album")
        return when (now.text("reason")) {
            "working" -> if (album != null) "Now: " + names(album.text("artist"), album.text("title")) + " · " + now.text("step") else "Now: on to the next album"
            "waiting" -> "Waiting for " + scan.optJSONObject("schedule")?.text("start").orEmpty()
            "playing" -> "Paused while music plays"
            "scanning" -> "Paused while the library is scanned"
            "unreachable" -> "MusicBrainz isn't answering; trying again in a few minutes"
            "done" -> "All done"
            "later" -> "The rest are looked at again after the next library scan, or at night"
            else -> "Off"
        }
    }

    /** The music folders the cover finder can't reach, under the readout (items 410, 411; the page's covers-reach.js): at most three named. */
    fun coversUnreachable(c: JSONObject?): String? {
        val a = c?.optJSONArray("unreachable") ?: return null
        val away = (0 until a.length()).map { a.optString(it) }.filter { it.isNotEmpty() }
        if (away.isEmpty()) return null
        return "The music folders can't be reached (" + away.take(3).joinToString(", ") + (if (away.size > 3) ", …" else "") +
            " not found): covers will be looked for once they are."
    }

    // ------------------------------------------------------------ the folders, and the schedule

    /** The folders shown: Unidentified always, To confirm while there are proposals. */
    fun folders(scan: JSONObject?): List<ScanFolder> {
        if (scan == null) return emptyList()
        val un = scan.optInt("unidentified"); val pr = scan.optInt("proposed")
        return listOfNotNull(folder("unidentified", un), if (pr > 0) folder("proposed", pr) else null)
    }
    fun folder(kind: String, count: Int): ScanFolder = if (kind == "proposed")
        ScanFolder(kind, "To confirm", count, "Found, but not sure enough to apply unasked", "Close, but not close enough to apply unasked. Tap the name to see the album; Accept writes the names shown.")
    else ScanFolder(kind, "Unidentified", count, if (count > 0) "Tap to place them by hand" else "None to place by hand",
        "Nothing near enough was found on MusicBrainz or iTunes. Tap the name to see the album (⋯ → Edit album to name it yourself), Barcode… to match it by its barcode or a MusicBrainz link, or Check again.")

    /** Schedule's line under its name. */
    fun scheduleNote(on: Boolean): String = if (on) "Runs only between these times" else "Off: runs any time, day and night"

    // ------------------------------------------------------------ the processor and the clean-up

    /** The processor's line; none until the server has answered. */
    fun cpuLine(cpu: JSONObject?): String? {
        val cores = cpu?.optJSONArray("cores") ?: return null
        fun c(k: Int) = "$k core" + plural(k, "")
        return if (cpu.optBoolean("split")) c(cores.length()) + " · " + (cpu.optJSONArray("playback")?.length() ?: 0) + " kept for playback" + (if (cpu.optBoolean("making")) " (making as it plays)" else if (cpu.optBoolean("dsp")) " (DSP in use)" else "") +
            " · " + (cpu.optJSONArray("background")?.length() ?: 0) + " for the rest"
        else c(cores.length()) + ", shared; playback comes first by priority"
    }
    /** What is said of playback's priority, behind the processor's ⓘ (the page keeps to one screen). */
    fun cpuHint(cpu: JSONObject?): String = if (cpu?.optJSONArray("cores") == null || !cpu.optBoolean("split")) ""
        else if (cpu.optBoolean("raised")) " Playback also runs at a higher priority here." else " To run playback at a higher priority too, give the server the SYS_NICE capability."
    /** The choices of cores for a making (item 260): Auto, then 1 to 3, no more than all the cores but one; none where the cores aren't split. */
    fun makingChoices(cpu: JSONObject?): List<SegChoice> {
        val most = if (cpu?.optBoolean("split") != true) 0 else minOf(3, (cpu.optJSONArray("cores")?.length() ?: 0) - 1)
        return if (most < 1) emptyList() else listOf(SegChoice("auto", "Auto")) + (1..most).map { SegChoice("$it", "$it") }
    }
    /** The choice in force: "auto" or the number. */
    fun makingCurrent(cpu: JSONObject?): String = cpu?.optInt("making_cores", 0)?.takeIf { it > 0 }?.toString() ?: "auto"

    /** The kinds with albums the clean-up could remove, each said, with its Remove; none when nothing could go. */
    fun cleanupRows(cleanup: JSONObject?, locale: Locale = Locale.getDefault()): List<CleanupRow> {
        if (cleanup == null) return emptyList()
        fun albums(n: Int, what: String) = num(n, locale) + " " + what + plural(n, "")
        val q = cleanup.optJSONObject("qobuz")
        return listOfNotNull(
            cleanup.optJSONObject("files")?.optInt("albums")?.takeIf { it > 0 }?.let { CleanupRow("files", albums(it, "album") + " whose files are gone", it) },
            q?.optInt("albums")?.takeIf { it > 0 }?.let { CleanupRow("qobuz", albums(it, "Qobuz album") + if (q.optBoolean("signed_in")) " no longer wanted" else " (signed out of Qobuz)", it) },
            cleanup.optJSONObject("tidal")?.optInt("albums")?.takeIf { it > 0 }?.let { CleanupRow("tidal", albums(it, "Tidal album") + " no longer wanted", it) })
    }
    /** What is asked before a kind is removed. */
    fun cleanupQuestion(kind: String, n: Int, locale: Locale = Locale.getDefault()): String =
        if (kind == "files") "Remove " + num(n, locale) + " album" + plural(n, "") + " whose files are gone from the server?\n\nPlays stay in history; their edits, hearts and Listen later go. If the files come back, a scan adds the albums afresh."
        else "Remove " + num(n, locale) + " " + (if (kind == "tidal") "Tidal" else "Qobuz") + " album" + plural(n, "") + " from the database?\n\nPlays stay in history. Signing in and favouriting again brings an album back."

    // ------------------------------------------------------------ the pack

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
                if (free != null && free < latest.optDouble("size", 0.0) + 200 * 1048576.0) warn = "Not enough room in this folder: choose another."
                "Not downloaded. A " + mbs(latest.optDouble("gz_size", 0.0), locale) + " download that unpacks to " + mbs(latest.optDouble("size", 0.0), locale) + " in the folder below."
            } else if (pack.optBoolean("checking")) "Not downloaded. Asking GitHub what’s published…"
            else "Not downloaded." + pack.text("check_error").let { if (it.isNotEmpty()) " ($it)" else "" }
            buttons += ScanButton("Download", "download", true)
            if (latest == null) enabled = false
        }
        return PackView(state, listOfNotNull(warn, jobError).joinToString(" ").ifEmpty { null }, buttons, enabled, running)
    }

    /** Where the pack is kept, said after its state, and what is wrong with the place (red); [jobError] already said with the state. */
    fun packFolder(pack: JSONObject, locale: Locale = Locale.getDefault()): Pair<String, String?> {
        val dir = pack.text("dir"); val data = pack.text("data_dir")
        val free = if (pack.isNull("free") || !pack.has("free")) "" else " · " + mbs(pack.optDouble("free"), locale) + " free"
        val problem = pack.text("dir_problem").ifEmpty { null }?.takeIf { it != pack.optJSONObject("job")?.text("error") }
        return (dir + (if (dir == data) " (the data folder)" else "") + free) to problem
    }

    // ------------------------------------------------------------ a folder's albums

    /** A folder shows its first 60 until Show all; Show all shows up to 500. */
    const val SHOW = 60
    fun showAll(count: Int): Int = minOf(count, 500)

    /** What is said once an album's action is done. */
    fun actDone(action: String): String? = mapOf("accept" to "Applied", "reject" to "Declined", "recheck" to "It will be looked at again")[action]

    /** An album's actions, by the folder it is in. */
    fun actions(kind: String): List<ScanButton> = if (kind == "proposed") listOf(ScanButton("Accept", "accept", true), ScanButton("Reject", "reject"))
        else listOf(ScanButton("Check again", "recheck"))

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

    /** An album's second line in its folder ([kind]), as the page's albumRow writes it. */
    fun line2(it: JSONObject, kind: String): String {
        val c = it.optJSONObject("candidate")
        val from = if (c?.text("source") == "itunes") " · from iTunes" else ""
        val why = it.optJSONArray("why")?.let { w -> if (w.length() > 0) " — " + (0 until w.length()).joinToString(", ") { w.optString(it) } else "" }.orEmpty()
        val sim = it.optInt("similarity")
        return if (kind == "proposed") "→ " + names(c) + (if ((c?.optInt("year") ?: 0) > 0) " (" + c!!.optInt("year") + ")" else "") + version(c) + " · $sim % alike" + why +
            (if (it.optBoolean("ambiguous")) " · two releases fit" else "") + from
        else if (c != null) "nearest: " + names(c) + " · $sim %" + why + from else "nothing with this title on MusicBrainz or iTunes"
    }

    /** The counts a folder's albums were last asked for at: when the server's move, they are asked for again. */
    fun countsOf(scan: JSONObject?): String = scan?.let { s -> listOf("done", "unidentified", "proposed").joinToString(",") { s.optInt(it).toString() } }.orEmpty()

    /** A list from an answer, empty when it has none. */
    fun list(j: JSONObject?, kind: String): List<JSONObject> = j?.optJSONArray(kind)?.let { a: JSONArray -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } }.orEmpty()
}

/**
 * A field's text, or "" where the server sends none or null. Android's org.json reads a JSON null as the word "null"
 * (the server's "no problem with the folder" showed as a red "null"; bug list item 103), where the JVM's reads "".
 */
private fun JSONObject.text(key: String): String = if (!has(key) || isNull(key)) "" else optString(key)
