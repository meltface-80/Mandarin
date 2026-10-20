package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * An album's corrections, typed (the group B of docs/specs/plan-android-native.md, B5; bug list item 74): the editor's
 * view of an album (/api/album/edit), the covers found on the web (/api/album/art-search) and the releases MusicBrainz
 * offers for it (/api/identify/candidates), with what the page says of each, as album-editor.js and
 * album-editor-match.js read and say them.
 */

/** A line the page writes with its first words in bold: [bold], then [rest]. */
data class Said(val bold: String, val rest: String) {
    val text: String get() = bold + rest
}

/** The box set an album is a disc of. */
data class BoxPart(val name: String, val disc: Int, val of: Int)

/**
 * The editor's view of an album: its names now and as [scanned] from the files, whether it has been [edited], its
 * cover (its own in the files, [artOwn]; one found on the web, [artFound], and where from) and its folder.
 */
data class EditState(val offset: Long, val folder: String?, val box: BoxPart?, val title: String, val artist: String, val year: String,
                     val scanned: Map<String, String>, val edited: Boolean, val imageKey: String?, val artOwn: Boolean, val artFound: Boolean,
                     val artSource: String?) {
    /** The box set it is part of, as the folder line says it. */
    val boxLine: String? get() = box?.let { "From " + it.name + " · disc " + it.disc + " of " + it.of }

    companion object {
        fun parse(j: JSONObject): EditState {
            val s = j.optJSONObject("scanned") ?: JSONObject()
            val art = j.optJSONObject("art") ?: JSONObject()
            val box = j.optJSONObject("box")?.let { BoxPart(it.optString("name"), it.optInt("disc"), it.optInt("of")) }
            return EditState(j.optLong("offset"), text(j, "folder"), box, text(j, "title").orEmpty(), text(j, "artist").orEmpty(), text(j, "year").orEmpty(),
                listOf("title", "artist", "year").associateWith { text(s, it).orEmpty() }, j.optBoolean("edited"), text(j, "image_key"),
                art.optBoolean("own"), art.optBoolean("found"), text(art, "source"))
        }
    }
}

/** A cover found on the web: where from, what it is of, and how well it matches the album (the share of its tracks, when known). */
data class ArtCandidate(val url: String, val thumb: String?, val source: String, val title: String, val artist: String, val year: String,
                        val tracks: Int, val matchTracks: Double?) {
    /** The picture to show: the small one when there is one. */
    val picture: String get() = thumb ?: url
    /** What it is called, as the page's tile is (its title). */
    val label: String get() = "$title — $artist ($source)"
    /** The line under its source: how many of the tracks match, or its year and how many tracks. */
    val line: String get() = matchTracks?.let { if (it >= 0.999) "All tracks match" else "${Math.round(it * 100)}% tracks match" }
        ?: listOf(year, if (tracks > 0) "$tracks tracks" else "").filter { it.isNotEmpty() }.joinToString(" · ")
}

/** The covers found, best first; [sure]: the one that matches tracks, artist and title, picked at once. */
data class ArtSearch(val candidates: List<ArtCandidate>, val sure: ArtCandidate?) {
    /** What the search says above them. */
    val status: Said get() = when {
        sure != null -> Said("Found it", " on ${sure.source} — same tracks, artist and title. Save to use it, or pick another.")
        candidates.isNotEmpty() -> Said("Not sure which one is right.", " Pick the cover that matches, or paste an image address below.")
        else -> Said("Nothing found.", " Paste an image address below — from a record shop, Discogs or a search engine (copy image address).")
    }

    companion object {
        fun parse(j: JSONObject): ArtSearch {
            fun one(o: JSONObject) = ArtCandidate(o.optString("url"), text(o, "thumb"), text(o, "source").orEmpty(), text(o, "title").orEmpty(),
                text(o, "artist").orEmpty(), text(o, "year").orEmpty(), o.optDouble("tracks", 0.0).takeIf { !it.isNaN() }?.toInt() ?: 0,
                o.optJSONObject("match")?.let { m -> m.optDouble("tracks").takeIf { !it.isNaN() } })
            val list = objs(j.optJSONArray("candidates")).map(::one).filter { it.url.isNotEmpty() }
            val sure = j.optJSONObject("sure")?.let(::one)?.let { s -> list.firstOrNull { it.url == s.url } ?: s }
            return ArtSearch(list, sure)
        }
    }
}

/** A cover chosen in the editor: one found or an address pasted ([source]: where from), or the found one to go ([remove]). */
data class CoverPick(val url: String, val thumb: String?, val source: String, val remove: Boolean = false) {
    companion object {
        val REMOVE = CoverPick("", null, "", remove = true)
        const val PASTED = "a pasted address"
    }
}

/** A release MusicBrainz (or iTunes) has that the album could be: its names, what sets it apart, and how alike it is. */
data class ReleaseCandidate(val mbid: String, val source: String, val artist: String, val title: String, val year: String, val releaseYear: String,
                            val edition: String, val country: String, val trackCount: Int, val missing: Int, val extra: Int, val similarity: Int) {
    /** Its artist and title, as its row's first line. */
    val name: String get() = (if (artist.isNotEmpty()) "$artist — " else "") + title.ifEmpty { "—" }
    /** As alike as the scan applies by itself: its percentage in the accent. */
    val sure: Boolean get() = similarity >= 96
    /** Its second line: the source when it is iTunes, the year, this pressing's, the edition, the country, the tracks. */
    val line: String get() = listOfNotNull(
        "iTunes".takeIf { source == "itunes" }, year.ifEmpty { null },
        "this pressing $releaseYear".takeIf { releaseYear.isNotEmpty() && year.isNotEmpty() && releaseYear != year },
        edition.ifEmpty { null }, country.ifEmpty { null }, "$trackCount tracks".takeIf { trackCount > 0 },
        "$missing missing here".takeIf { missing > 0 }, "$extra not on it".takeIf { extra > 0 }).joinToString(" · ")
}

/** The releases offered, best first, and the scan's [verdict] on the first ("applied", "proposed" or neither). */
data class MatchSearch(val candidates: List<ReleaseCandidate>, val verdict: String, val ambiguous: Boolean) {
    /** What the search says above them. */
    val status: Said get() = when {
        candidates.isEmpty() -> Said("Nothing with this title on MusicBrainz.", " Try the barcode below, or a link to the release.")
        verdict == "applied" -> Said("This is it", " — the same tracks and lengths. Tap to apply, or choose another.")
        verdict == "proposed" -> Said("Close", (if (ambiguous) ", but two releases fit" else "") + ". Tap the right one to apply.")
        else -> Said("Not sure which.", " Tap one to apply it, or use the barcode below.")
    }

    /** The badge on the [i]th row: the first one's, when the scan would apply it ("Match") or propose it ("Likely"). */
    fun badge(i: Int): String? = if (i != 0) null else when (verdict) { "applied" -> "Match"; "proposed" -> "Likely"; else -> null }

    companion object {
        fun parse(j: JSONObject?): MatchSearch = MatchSearch(objs(j?.optJSONArray("candidates")).map {
            ReleaseCandidate(it.optString("mbid"), text(it, "source") ?: "musicbrainz", text(it, "artist").orEmpty(), text(it, "title").orEmpty(),
                text(it, "year").orEmpty(), text(it, "release_year").orEmpty(), text(it, "edition").orEmpty(), text(it, "country").orEmpty(),
                it.optDouble("track_count", 0.0).takeIf { n -> !n.isNaN() }?.toInt() ?: 0, it.optInt("missing_tracks"), it.optInt("extra_tracks"),
                it.optInt("similarity"))
        }, j?.optString("verdict").orEmpty(), j?.optBoolean("ambiguous") ?: false)
    }
}

/** What the editor says and sends, as the page's. */
object AlbumEdit {
    const val HEADING = "Edit album"
    const val LOADING = "Loading…"
    const val SEARCHING = "Searching Apple Music, Deezer and MusicBrainz…"
    const val ASKING = "Asking MusicBrainz… (a few seconds: one request a second)"
    const val MATCH_INTRO = "Names from MusicBrainz — artist, title, year and every track."
    const val NOTE = "Your music folders aren't changed — edits are kept in Mandarin's database and survive rescans."
    const val NO_PICTURE = "No picture loaded from that address. Make sure it's the image itself (“Copy image address”), not the page it's on."
    const val NO_BARCODE = "Type the digits under the bars, or paste a musicbrainz.org release link."

    /** What is said beside the cover: the one chosen ([pick]) to come, the found one to go, or the cover the album has. */
    fun coverStatus(state: EditState, pick: CoverPick?): Said = when {
        pick?.remove == true -> Said("", "The found cover will be removed when you save.")
        pick != null -> Said("New cover", " from ${pick.source} — save to use it.")
        state.artFound -> Said("Found cover", (state.artSource?.takeIf { it.isNotEmpty() && !Regex("^https?:").containsMatchIn(it) }?.let { " from $it" } ?: "") + ".")
        state.artOwn -> Said("", "Cover from the album's files.")
        else -> Said("No cover.", " This album's folder and tracks have no artwork.")
    }

    /** Under a field whose words ([now]) differ from the files' ([scanned]): what the files say, before Put back; null when they agree. */
    fun was(scanned: String, now: String): String? = if (now.trim() == scanned) null else "From the files: ${scanned.ifEmpty { "(none)" }} · "

    /** Why the year can't be saved (null: it can): four digits or none. */
    fun yearError(year: String): String? = if (year.trim().isEmpty() || Regex("^\\d{4}$").matches(year.trim())) null else "The year should be four digits, like 2002."

    /** Why an address pasted for a cover isn't one (null: it may be). */
    fun urlError(url: String): String? = if (Regex("^https?://\\S+$", RegexOption.IGNORE_CASE).matches(url.trim())) null
        else "That doesn't look like a web address (it should start with http)."

    fun searchFailed(why: String) = "The search didn't work ($why). You can still paste an image address below."
    fun matchFailed(why: String) = "The search didn't work ($why). You can still enter a barcode below."

    /** Save's request: the names as typed and the year, and the cover chosen (an address and its source, or "remove"). */
    fun saveBody(offset: Long, title: String, artist: String, year: String, pick: CoverPick?): JSONObject {
        val body = JSONObject().put("offset", offset).put("title", title).put("artist", artist).put("year", year.trim())
        if (pick?.remove == true) body.put("art", "remove")
        else if (pick != null) body.put("art_url", pick.url).put("art_source", if (pick.source == CoverPick.PASTED) pick.url else pick.source)
        return body
    }

    /** What is said once a release is applied to the album at [offset] ([answer]: the server's, the identify page's lists). */
    fun matched(answer: JSONObject, offset: Long): Said {
        val done = objs(answer.optJSONArray("applied")).firstOrNull { it.optJSONObject("album")?.optLong("offset", -1) == offset }
        val c = done?.optJSONObject("candidate") ?: return Said("Matched.", "")
        val artist = text(c, "artist").orEmpty()
        val year = text(c, "year")
        return Said("Matched:", " " + (if (artist.isNotEmpty()) "$artist — " else "") + text(c, "title").orEmpty() + (year?.let { " ($it)" } ?: "") +
            ". Undo is under Settings → Library Scanner.")
    }
}

/** A field's words: a number as the page writes it (2002, not 2002.0); none when it is missing, null or empty. */
private fun text(j: JSONObject, key: String): String? {
    if (!j.has(key) || j.isNull(key)) return null
    val v = j.opt(key)
    val s = if (v is Number && v.toDouble() == Math.floor(v.toDouble())) v.toLong().toString() else v.toString()
    return s.ifEmpty { null }
}

private fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
