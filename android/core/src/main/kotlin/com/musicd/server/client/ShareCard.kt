package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * The share card, typed (the group B of old/plan-android-native.md, B4; bug list item 75): what the card says
 * (from /api/album/extras, as share-card.js's cardFields reads it), where its record can be heard or read about (the
 * links under it), the acts suggested under them (/api/similar), and the card's layout, measured as sharecard.js
 * measures it before it draws: the height is a result of the words, so everything is wrapped first.
 */

/** A place to hear the record (a service: [review] false) or to read about it, with the words on its chip. */
data class ShareLink(val id: String, val name: String, val chip: String?, val url: String, val review: Boolean) {
    /** The chip's words, as the page writes them. */
    val words: String get() = chip ?: name.ifEmpty { id }
}

/** What the card shows, and where its record is: the release (raw), the review and whose words they are, Pitchfork's score and flag. */
data class CardFields(val releaseRaw: String, val reviewText: String, val reviewSource: String, val score: Double?, val bestNew: Boolean,
                      val services: List<ShareLink>, val reviews: List<ShareLink>) {
    /** What decides whether the card must be drawn again once the full answer comes. */
    val signature: String get() = listOf(releaseRaw, reviewText, reviewSource, score?.let(::num).orEmpty(), bestNew.toString()).joinToString("|")
    /** The chips in the row's order: the services, then the reviews. */
    val links: List<ShareLink> get() = services + reviews

    companion object {
        val NONE = CardFields("", "", "", null, false, emptyList(), emptyList())

        /** From an extras answer (none: the card with title and artist only); a review switched off in Settings left out. */
        fun parse(j: JSONObject?): CardFields {
            if (j == null) return NONE
            val a = j.optJSONObject("album")
            val release = text(j, "year") ?: a?.let { text(it, "year") }.orEmpty()
            val score = a?.takeIf { it.has("score") && !it.isNull("score") }?.optDouble("score")?.takeIf { !it.isNaN() }
            val wantReview = !(j.optJSONObject("card")?.let { it.has("review") && it.opt("review") == false } ?: false)
            val desc = a?.let { text(it, "description") }
            val review = if (desc != null && wantReview) ShareCard.trimReview(desc) else ""
            val source = if (review.isNotEmpty()) a?.let { text(it, "description_source") }.orEmpty() else ""
            val links = j.optJSONObject("links")
            return CardFields(release, review, source, score, a?.optBoolean("isBestNewMusic") ?: false,
                ShareCard.links(links?.optJSONArray("services"), false), ShareCard.links(links?.optJSONArray("reviews"), true))
        }
    }
}

/** An act worth hearing next ("If you like this"): one record of theirs, why it is suggested, and where it is. */
data class SimilarAct(val name: String, val album: String, val year: String, val reason: String, val inLibrary: Boolean, val offset: Long?,
                      val libraryTitle: String, val librarySubtitle: String, val services: List<ShareLink>) {
    /** The quiet line beside the name: the record, and its year. */
    val sub: String get() = if (album.isEmpty()) "" else if (year.isNotEmpty()) "$album · $year" else album
    /** Queued from the library (its offset known), rather than found on a service. */
    val queues: Boolean get() = inLibrary && offset != null
    /** Where a tap goes when it isn't in the library: the default service of those it is on, or none. */
    fun service(preferred: String?): ShareLink? = services.firstOrNull { it.id == ShareCard.preferred(preferred, services.map { s -> s.id }) }

    companion object {
        fun list(j: JSONObject?): List<SimilarAct> = objs(j?.optJSONArray("acts")).mapNotNull {
            val name = text(it, "name") ?: return@mapNotNull null
            SimilarAct(name, text(it, "album").orEmpty(), text(it, "year").orEmpty(), text(it, "reason").orEmpty(), it.optBoolean("in_library"),
                it.takeIf { o -> o.opt("offset") is Number }?.optLong("offset"), text(it, "library_title").orEmpty(), text(it, "library_subtitle").orEmpty(),
                ShareCard.links(it.optJSONArray("services"), false))
        }
    }
}

/** The card's rules beside its drawing: the review trimmed, the default service, the file's name, the hint. */
object ShareCard {
    const val GENERATING = "Generating card…"
    const val FAILED = "Could not generate the card."
    const val HINT = "Tap a button above, or long-press the card to save."

    /** The review as the card carries it: ten sentences at most, and 1,400 characters, cut at a word with "…". */
    fun trimReview(desc: String): String {
        var t = desc.trim()
        val sentences = Regex("[^.!?]+[.!?]+").findAll(t).map { it.value }.toList()
        if (sentences.size > 10) t = sentences.take(10).joinToString(" ").trim()
        if (t.length > 1400) t = t.take(1398).replace(Regex("\\s+\\S*$"), "") + "…"
        return t
    }

    /** The default service: the one chosen ([stored]) while it is still on, else the first that is, else Qobuz. */
    fun preferred(stored: String?, available: List<String>): String =
        if (!stored.isNullOrEmpty() && (available.isEmpty() || stored in available)) stored else available.firstOrNull() ?: "qobuz"

    /** The saved card's name: the artist and the title, anything but letters and digits made "_". */
    fun fileName(title: String, artist: String): String =
        artist.ifEmpty { "artist" }.replace(Regex("[^a-zA-Z0-9]+"), "_") + "-" + title.ifEmpty { "card" }.replace(Regex("[^a-zA-Z0-9]+"), "_") + ".png"

    internal fun links(a: JSONArray?, review: Boolean): List<ShareLink> = objs(a).mapNotNull {
        val url = text(it, "url") ?: return@mapNotNull null
        ShareLink(it.optString("id"), text(it, "name").orEmpty(), text(it, "chip"), url, review)
    }
}

/**
 * The card's layout, as sharecard.js lays it out (1200 wide, 600 to 1800 tall): the pane on the softened cover, the
 * 424 cover, the release line, the title and the artist (each up to four lines, the size stepped down until it fits),
 * and the review under a hairline across the whole pane, with whose words they are. [measure] is a font's width of a
 * text at a weight and a size (sharecard.js's ctx.measureText), so the arithmetic is held here without a canvas.
 */
object CardLayout {
    const val CARD_W = 1200
    const val MIN_CARD_H = 600
    const val MAX_CARD_H = 1800
    const val INSET = 48
    const val PANE_W = CARD_W - INSET * 2
    const val PANE_R = 28
    const val PANE_PAD = 40
    const val ART = 424
    const val ART_R = 18
    const val ART_X = INSET + PANE_PAD
    const val TEXT_X = ART_X + ART + 44
    const val TEXT_W = INSET + PANE_W - 44 - TEXT_X
    const val CONTENT_W = PANE_W - PANE_PAD * 2
    const val LOGO_D = 96
    const val LOGO_PAD = 24
    const val SCORE_PAD = 14
    const val SCORE_H = 54
    const val SCORE_R = 12
    const val SCORE_SIZE = 30
    const val BNM_H = 26
    const val BNM_SIZE = 15
    const val DESC_SIZE = 26
    const val DESC_LH = 38
    const val DESC_MAX = 22
    const val RULE_GAP = 30
    const val SRC_SIZE = 20
    const val SRC_H = SRC_SIZE + 4
    const val SRC_GAP = 26
    const val META_SIZE = 26
    const val META_H = META_SIZE + 4
    const val META_GAP = 24
    const val BLOCK_GAP = 18
    private val TITLE_SIZES = listOf(56, 48, 42, 36, 31, 27)
    private val ARTIST_SIZES = listOf(37, 32, 28, 24, 21)
    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** Lines of text at one size, and their height each. */
    data class Fit(val lines: List<String>, val size: Int, val lh: Int)

    /** Everything measured, and where it goes: the card's height, the pane's, where its block, the cover and the words start. */
    data class Layout(val metaText: String?, val title: Fit, val artist: Fit, val desc: Fit?, val srcText: String, val headerTextH: Int, val headerH: Int,
                      val contentH: Int, val cardH: Int) {
        val paneH: Int get() = cardH - INSET * 2
        val contentY: Int get() = INSET + maxOf(PANE_PAD, Math.round((paneH - contentH) / 2.0).toInt())
        val artY: Int get() = contentY + Math.round((headerH - ART) / 2.0).toInt()
        val textY: Int get() = contentY + Math.round((headerH - headerTextH) / 2.0).toInt()
        /** Where the hairline is, over the review. */
        val ruleY: Int get() = contentY + headerH + RULE_GAP
    }

    /** A release as the card writes it: "20 Nov 2006", "Nov 2006", "2006", or as it came. */
    fun releaseDate(raw: String?): String? {
        val s = raw?.trim().orEmpty()
        if (s.isEmpty()) return null
        Regex("^(\\d{4})-(\\d{1,2})-(\\d{1,2})$").find(s)?.destructured?.let { (y, mo, d) ->
            if (mo.toInt() in 1..12 && d.toInt() in 1..31) return "${d.toInt()} ${MONTHS[mo.toInt() - 1]} $y"
        }
        Regex("^(\\d{4})-(\\d{1,2})$").find(s)?.destructured?.let { (y, mo) -> if (mo.toInt() in 1..12) return "${MONTHS[mo.toInt() - 1]} $y" }
        return s
    }

    /** [text] wrapped to [maxWidth] in [maxLines] at most, and whether it didn't all fit (or a word is wider than the column). */
    fun wrap(width: (String) -> Float, text: String, maxWidth: Int, maxLines: Int): Pair<List<String>, Boolean> {
        if (text.isEmpty()) return emptyList<String>() to false
        val lines = mutableListOf<String>()
        var cur = ""
        var overflow = false
        for (w in text.split(Regex("\\s+"))) {
            val candidate = if (cur.isNotEmpty()) "$cur $w" else w
            if (width(candidate) <= maxWidth) { cur = candidate; continue }
            if (cur.isNotEmpty()) lines.add(cur)
            if (lines.size >= maxLines) { cur = ""; overflow = true; break }
            cur = w
            if (width(w) > maxWidth) overflow = true
        }
        if (cur.isNotEmpty() && lines.size < maxLines) lines.add(cur) else if (cur.isNotEmpty()) overflow = true
        return lines to overflow
    }

    /** [text] fitted in [maxLines]: each of [sizes] tried until it fits; at the smallest, the last line cut with "…". */
    fun fit(measure: (String, Int, Int) -> Float, text: String, maxWidth: Int, maxLines: Int, weight: Int, sizes: List<Int>, lhRatio: Double): Fit {
        var r: Pair<List<String>, Boolean> = emptyList<String>() to false
        var size = sizes[0]
        for (s in sizes) {
            size = s
            r = wrap({ measure(it, weight, s) }, text, maxWidth, maxLines)
            if (!r.second) break
        }
        val lines = r.first.toMutableList()
        if (r.second && lines.isNotEmpty()) {
            var last = lines.last()
            while (last.isNotEmpty() && measure("$last…", weight, size) > maxWidth) last = last.dropLast(1)
            lines[lines.size - 1] = last.trimEnd() + "…"
        }
        return Fit(lines, size, Math.round(size * lhRatio).toInt())
    }

    /** The card measured: [measure] a width at a weight and a size; the review dropped below two lines' room. */
    fun measure(measure: (String, Int, Int) -> Float, title: String, artist: String, releaseRaw: String, review: String, reviewSource: String): Layout {
        val metaText = releaseDate(releaseRaw)?.let { "Released $it" }
        val t = fit(measure, title, TEXT_W, 4, 700, TITLE_SIZES, 68.0 / 56)
        val a = fit(measure, "by $artist", TEXT_W, 4, 400, ARTIST_SIZES, 48.0 / 37)
        val headerTextH = (if (metaText != null) META_H + META_GAP else 0) + t.lines.size * t.lh + BLOCK_GAP + a.lines.size * a.lh
        val headerH = maxOf(ART, headerTextH)
        val src = reviewSource.trim()
        val srcH = if (src.isNotEmpty()) SRC_GAP + SRC_H else 0
        val room = MAX_CARD_H - INSET * 2 - PANE_PAD * 2 - headerH - (RULE_GAP * 2 + 1) - srcH
        val maxDesc = minOf(DESC_MAX, Math.floorDiv(room, DESC_LH))
        val desc = if (review.isNotEmpty() && maxDesc >= 2) fit(measure, review, CONTENT_W, maxDesc, 400, listOf(DESC_SIZE), DESC_LH.toDouble() / DESC_SIZE) else null
        val descH = if (desc != null) RULE_GAP + 1 + RULE_GAP + desc.lines.size * desc.lh + srcH else 0
        val contentH = headerH + descH
        val cardH = maxOf(MIN_CARD_H, minOf(MAX_CARD_H, contentH + PANE_PAD * 2 + INSET * 2))
        return Layout(metaText, t, a, desc, if (desc != null) src else "", headerTextH, headerH, contentH, cardH)
    }
}

private fun num(d: Double): String = if (d % 1.0 == 0.0) d.toLong().toString() else d.toString()

/** A field's words: a number as the page writes it (2002, not 2002.0); none when it is missing, null or empty. */
private fun text(j: JSONObject, key: String): String? {
    if (!j.has(key) || j.isNull(key)) return null
    val v = j.opt(key)
    val s = if (v is Number) num(v.toDouble()) else v.toString()
    return s.ifEmpty { null }
}

private fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
