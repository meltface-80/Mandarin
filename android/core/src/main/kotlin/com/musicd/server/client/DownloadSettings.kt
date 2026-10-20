package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/** A place downloads can be saved to: phone storage, the SD card, or the download folder. */
data class DlPlace(val id: String, val label: String, val free: Long)

/**
 * The app's download settings as its bridge gives them (DownloadsBridge.settings; bug list item 91): what Settings →
 * Downloads shows. A part the bridge leaves out (an older app) is null, and its rows aren't shown.
 */
data class DlSettings(
    val quality: String, val location: String, val wifiOnly: Boolean, val limitGb: Int,
    val autoPicks: Boolean, val autoAotd: Boolean, val autoRecent: Int, val awayQuality: String?,
    val places: List<DlPlace>, val offlineMode: Boolean?,
    /** The download folder: none, ok, needed (all files access), unmapped, away; its name; whether one is chosen. */
    val folderAccess: String, val folderName: String, val folderChosen: Boolean,
    /** Albums saved somewhere other than the place chosen. */
    val elsewhere: Int,
    /** A move under way: how far it has come, or what stopped it. */
    val movingDone: Int?, val movingTotal: Int, val movingError: String,
    val used: Long,
    val cacheWifi: Int, val cacheMobile: Int, val cacheGb: Int,
    val cacheWifiChoices: List<Int>, val cacheMobileChoices: List<Int>, val cacheGbChoices: List<Int>,
) {
    companion object {
        fun parse(j: JSONObject): DlSettings {
            val places = j.optJSONArray("places")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { DlPlace(it.optString("id"), it.optString("label"), it.optLong("free")) } }.orEmpty()
            val f = j.optJSONObject("folder")
            val mv = j.optJSONObject("moving")
            val cc = j.optJSONObject("cacheChoices")
            fun ints(name: String) = cc?.optJSONArray(name)?.let { a -> (0 until a.length()).map { a.optInt(it) } }.orEmpty()
            return DlSettings(
                j.optString("quality", "original"), j.optString("location"), j.optBoolean("wifiOnly"), j.optInt("limitGb"),
                j.optBoolean("autoPicks"), j.optBoolean("autoAotd"), j.optInt("autoRecent"), if (j.has("awayQuality")) j.optString("awayQuality") else null,
                places, if (j.has("offlineMode")) j.optBoolean("offlineMode") else null,
                f?.optString("access", "none") ?: "none", f?.optString("name").orEmpty(), f?.optBoolean("chosen") ?: false,
                j.optInt("elsewhere"),
                mv?.optInt("done"), mv?.optInt("total") ?: 0, mv?.optString("error").orEmpty(),
                j.optLong("used"),
                j.optInt("cacheWifi"), j.optInt("cacheMobile"), j.optInt("cacheGb"), ints("wifi"), ints("mobile"), ints("gb"))
        }
    }
}

/** An album on the phone or on its way (DownloadsBridge.all), or on a card that is out ([state] "away"). */
data class DlAlbum(val id: Int, val state: String, val done: Int, val total: Int, val title: String, val artist: String,
                   val quality: String, val bytes: Long, val auto: Boolean, val error: String, val imageKey: String?) {
    companion object {
        fun list(a: JSONArray): List<DlAlbum> = (0 until a.length()).map { a.getJSONObject(it) }.map {
            DlAlbum(it.optInt("id"), it.optString("state"), it.optInt("done"), it.optInt("total"), it.optString("title"), it.optString("artist"),
                it.optString("quality"), it.optLong("bytes"), it.optBoolean("auto"), it.optString("error"), it.optString("image_key").ifEmpty { null })
        }
    }
}

/** One part of the download folder's rows: a row with its name and its buttons ([actions]: choose, forget, allow, move), or a note. */
data class DlPart(val text: String, val actions: List<String> = emptyList(), val note: Boolean = false)

/** Settings → Downloads as the page's android-downloads.js words it. */
object Downloads {
    /** A size as the page writes it: GB to a tenth from a gigabyte, else whole MB. */
    fun size(b: Long): String = if (b >= 1L shl 30) String.format(Locale.ROOT, "%.1f GB", b / (1L shl 30).toDouble()) else "${Math.round(b / (1L shl 20).toDouble())} MB"

    private fun albums(n: Int) = "$n" + if (n == 1) " album" else " albums"
    private fun done(list: List<DlAlbum>) = list.count { it.state == "done" }

    /** Under the title: how many albums are on the phone and the space they take. */
    fun settingsDesc(list: List<DlAlbum>, used: Long) = albums(done(list)) + " · " + size(used) + " used"
    /** The albums' page: the same, on this phone. */
    fun albumsDesc(list: List<DlAlbum>, used: Long) = albums(done(list)) + " on this phone · " + size(used)
    /** The Downloads row's second line. */
    fun folderSub(list: List<DlAlbum>, used: Long): String {
        if (list.isEmpty()) return "Nothing downloaded yet"
        val going = list.size - done(list)
        return albums(done(list)) + " · " + size(used) + if (going > 0) " · $going on the way" else ""
    }

    /** How far an album has come. */
    fun stateLine(d: DlAlbum): String {
        val q = if (d.quality == "opus") "Opus 256" else "Original"
        val total = if (d.total > 0) d.total.toString() else "?"
        return when (d.state) {
            "done" -> "${d.total} tracks · ${size(d.bytes)} · $q" + if (d.auto) " · automatic" else ""
            "away" -> "On a card that isn’t in · ${d.total} tracks · ${size(d.bytes)}"
            "downloading" -> "Downloading ${d.done} of $total · $q"
            "waiting" -> "Waiting for the network · ${d.done} of $total"
            "failed" -> "Couldn’t download: " + d.error.ifEmpty { "unknown" }
            else -> "Waiting to start · $q"
        }
    }

    fun offlineNote(on: Boolean) = if (on) "On. Only the music on this phone shows — its music folder and downloads — and the app doesn’t use the server, even when it can be reached."
        else "Off. The server’s library shows whenever it can be reached; with no connection, only the music on this phone."

    val QUALITY = listOf(Choice("original", "Original"), Choice("opus", "Opus 256 kbps"))
    val AWAY = listOf(Choice("opus", "Opus 256 kbps"), Choice("original", "Original"))
    val LIMIT = listOf(0, 8, 16, 32, 64, 128, 256).map { Choice(it.toString(), if (it > 0) "$it GB" else "No limit") }
    val RECENT = listOf(0, 5, 10, 20, 30).map { Choice(it.toString(), if (it > 0) "The newest $it" else "Off") }
    fun places(s: DlSettings) = s.places.map { Choice(it.id, it.label + " · " + size(it.free) + " free") }
    fun tracks(choices: List<Int>) = choices.map { Choice(it.toString(), "$it tracks") }
    fun gbs(choices: List<Int>) = choices.map { Choice(it.toString(), "$it GB") }

    /** The download folder's row and what stands between it and downloads landing there, and the move of what is elsewhere. */
    fun folderParts(s: DlSettings, canChoose: Boolean = true): List<DlPart> {
        val out = mutableListOf<DlPart>()
        if (canChoose) {
            if (!s.folderChosen) {
                out += DlPart("Download folder", listOf("choose"))
                out += DlPart("A folder of your own on the phone or an SD card, as a third place to save to. Albums there outlive the app.", note = true)
            } else out += DlPart("Download folder: " + s.folderName.ifEmpty { "chosen" }, listOf("choose", "forget"))
        }
        when (s.folderAccess) {
            "needed" -> {
                out += DlPart("Save into “" + s.folderName.ifEmpty { "the download folder" } + "”", listOf("allow"))
                out += DlPart("Android asks for the app to be allowed all files access first — tap Allow, switch it on, and come back.", note = true)
            }
            "unmapped" -> out += DlPart("The download folder you chose is on a drive the app can’t write plain files to (a cloud drive, say). Downloads can’t go there; choose a folder on the phone or its SD card.", note = true)
            "away" -> out += DlPart("The download folder isn’t reachable right now (its card out?). Downloads go to the place above until it is back.", note = true)
        }
        val d = s.movingDone
        if (d != null) {
            out += DlPart(if (s.movingError.isNotEmpty()) "Moving stopped: ${s.movingError} ($d of ${s.movingTotal} moved)" else "Moving ${minOf(d + 1, s.movingTotal)} of ${s.movingTotal}…", note = true)
        } else if (s.elsewhere > 0 && s.places.size > 1) {
            out += DlPart(s.elsewhere.toString() + (if (s.elsewhere == 1) " album is" else " albums are") + " saved elsewhere", listOf("move"))
            out += DlPart("Copied album by album, then removed from where they were. Stopped partway, nothing is lost: each album is whole at one end or the other.", note = true)
        }
        return out
    }

    /** The cache's line ([j]: DownloadsBridge.cacheStatus): how many of the next tracks are on the phone, and the space used. */
    fun cacheLine(j: JSONObject): String {
        val wanted = j.optInt("wanted")
        val ahead = if (wanted > 0) "${j.optInt("ahead")} of $wanted ahead on the phone" + (if (j.optBoolean("metered")) " (mobile data)" else "") else "Nothing queued"
        return ahead + " · " + size(j.optLong("used")) + " used"
    }

    /** The selecting bar's words, and its button's. */
    fun selected(n: Int) = if (n > 0) "$n selected" else "Tap albums to select them"
    fun removeChosen(n: Int) = if (n > 0) "Remove $n" else "Remove"

    /** What is asked before albums go: one ([title]), several, or all; the folder forgotten; everything moved. */
    fun askRemove(titles: List<String>): String = (if (titles.size == 1) "Remove “${titles[0]}” from this phone?" else "Remove ${titles.size} albums from this phone?") +
        "\n\n" + (if (titles.size == 1) "It stays" else "They stay") + " in your library on the server."
    fun askClearAll(n: Int) = "Remove all $n" + (if (n == 1) " album" else " albums") + " from this phone?\n\nEverything downloaded goes (downloads under way are stopped). They stay in your library on the server."
    const val ASK_FORGET = "Forget the download folder?\n\nDownloads go to phone storage from now on. Albums already in the folder stay there, and aren’t shown until it is chosen again."
    const val ASK_MOVE = "Move every downloaded album to the place chosen under Save to?"
    /** What is said once they have gone. */
    fun removed(n: Int) = if (n == 1) "Removed from this phone" else "$n albums removed from this phone"

    const val EMPTY = "Nothing here yet. On an album’s page, choose ⋯ → Download to this phone."
    const val QUALITY_INFO = "Original is the files as they are (formats a phone can’t play become lossless FLAC). Opus 256 is about a quarter of the size of a CD-quality FLAC, less against hi-res. You can choose each time."
    const val PLACE_INFO = "Phone storage and the SD card here are the app’s own: no permission needed, but uninstalling the app deletes what’s there (updates don’t). A folder of your own outlives the app: a fresh install pointed at the same folder finds the albums again."
    const val AWAY_INFO = "Albums not on the phone, over mobile data or other Wi-Fi. Opus 256 is made by the server as it plays, about a quarter of the data of a CD-quality FLAC; Original sends the files as they are."
    const val AUTO_INFO = "Kept on the phone by themselves, in the quality above, and removed again when they drop off the list. Albums you download yourself are never removed."
    fun cacheInfo(mobile: Int) = "Playing on this phone: the next tracks in the queue are kept on the phone ahead of time, so they play without the network — through a dead spot, or on mobile data without using any. On mobile data $mobile tracks is about ${Math.round(mobile * 9.0)} MB as Opus 256. Tracks stay until the space is needed, so one played again is already here."
}
