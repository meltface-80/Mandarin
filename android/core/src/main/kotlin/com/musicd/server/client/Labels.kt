package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer

/*
 * Record labels, typed (the group B of old/plan-android-native.md, B1; bug list item 71): the list as the
 * server has it (/api/filters/labels), with the scan's progress, what the page says of it, the order and the find
 * it is shown in; a label's albums (/api/label-albums) and the logos Discogs offers for it; as the page's
 * labels.js, labels-list.js and labels-albums.js read and say them.
 */

/** A label merged into another: its key (to take it out again) and its name. */
data class MergedLabel(val key: String, val display: String)

/** A label as the list has it: its name, how many albums (in words, and as a count), its logo, and the labels merged into it. */
data class LabelTile(val key: String, val title: String, val subtitle: String, val albumCount: Int, val logoUrl: String?, val mergedFrom: List<MergedLabel>) {
    /** Its name in words for a tile with no logo, one a line (none: "?"). */
    val words: List<String> get() = title.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.ifEmpty { listOf("?") }
}

/** The list: the labels # to Z, whether the scan still runs (and how far), and whether labels are looked up beyond the files' tags. */
data class LabelList(val labels: List<LabelTile>, val scanning: Boolean, val progress: Double, val lookups: Boolean) {
    /** The labels shown: those with at least [min] albums, turned round when [reversed] (Z to #), those whose name holds [find]. */
    fun shown(min: Int, reversed: Boolean, find: String = ""): List<LabelTile> {
        val q = Labels.fold(find)
        val kept = labels.filter { it.albumCount >= min && (q.isEmpty() || Labels.fold(it.title).contains(q)) }
        return if (reversed) kept.reversed() else kept
    }

    /** What the page says above the tiles when there are none (or null): the scan's progress, or why there are none yet. */
    fun banner(min: Int): String? {
        if (labels.any { it.albumCount >= min }) return null
        val pct = Math.round(progress * 100)
        return when {
            scanning -> if (pct > 0) "Scanning for record labels… $pct% complete." else "Building library index…"
            lookups -> "No labels found yet — the background scan is looking them up. This can take a few minutes for large libraries."
            else -> "No labels yet: none of the albums' files carry a LABEL tag."
        }
    }

    /** Rescan now offered: no labels, the scan done, the lookups on. */
    fun rescan(min: Int): Boolean = labels.none { it.albumCount >= min } && !scanning && lookups
    /** The scan log offered: the scan done, and labels looked up (with only the files' tags there is nothing to log). */
    val log: Boolean get() = !scanning && lookups

    companion object {
        fun parse(j: JSONObject) = LabelList(objs(j.optJSONArray("labels")).map {
            LabelTile(it.optString("key"), it.optString("title"), it.optString("subtitle"), it.optInt("albumCount", 1), it.optString("logo_url").takeIf { u -> u.isNotEmpty() && u != "null" },
                objs(it.optJSONArray("mergedFrom")).map { m -> MergedLabel(m.optString("key"), m.optString("display")) })
        }, j.optBoolean("scanning"), j.optDouble("progress", 0.0).takeIf { !it.isNaN() } ?: 0.0, j.optBoolean("lookups"))
    }
}

/** A label's albums, and its logo when it has one. */
data class LabelAlbums(val albums: List<AlbumSummary>, val logoUrl: String?) {
    companion object {
        fun parse(j: JSONObject) = LabelAlbums(AlbumRow.parse(j).albums, j.optString("logo_url").takeIf { it.isNotEmpty() && it != "null" })
    }
}

/** A logo Discogs offers: its picture's address and what it is called. */
data class LogoCandidate(val img: String, val title: String) {
    companion object {
        fun list(j: JSONObject): List<LogoCandidate> = objs(j.optJSONArray("candidates")).map { LogoCandidate(it.optString("img"), it.optString("title")) }.filter { it.img.isNotEmpty() }
    }
}

object Labels {
    /** A name as the find matches it: its accents off, in small letters, trimmed. */
    fun fold(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFD).filter { Character.getType(it) != Character.NON_SPACING_MARK.toInt() }.lowercase().trim()

    /** The order button's word and what it is called aloud. */
    fun orderWord(reversed: Boolean): String = if (reversed) "Z–#" else "#–Z"
    fun orderLabel(reversed: Boolean): String = "Order: " + if (reversed) "Z to # — tap for # to Z" else "# to Z — tap for Z to #"

    /** No label matching the find. */
    fun none(find: String): String = "No label matches “" + find.trim() + "”"

    /** The merge bar's line for the labels picked (the first is the one the rest go into): its words before and after the name, the name, and whether Merge is open. */
    data class MergeLine(val before: String, val name: String, val after: String, val canMerge: Boolean)

    fun mergeLine(picked: List<String>): MergeLine = when (picked.size) {
        0 -> MergeLine("Tap labels to select", "", "", false)
        1 -> MergeLine("", picked[0], " — select more to merge", false)
        else -> MergeLine("Merge ${picked.size} into ", picked[0], "", true)
    }

    /** What Discogs's logos come to when there are none, or it failed. */
    const val SEARCHING = "Searching Discogs…"
    const val NO_LOGOS = "No logos found on Discogs"
}

private fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
