package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * A Dynamic Playlist made or edited (bug list item 95), as the page's smart-playlists.js (createSmartPlaylist,
 * saveSmartPlaylistPrompt), library-focus.js (the Focus sheet with a playlist to save) and playlist-share.js (SMART_MODES,
 * SMART_ORDERS, SMART_LIMITS) have it: what it is made of, asked first; then the Focus sheet led by its own Order and
 * Playlist size; then its name; then what is sent, and what is said once it is saved.
 */

/** One of the choices a Dynamic Playlist is made with: [id] as the server keeps it, [label] as the sheet shows it, [note] under it. */
data class SmartChoice(val id: String, val label: String, val note: String = "")

/**
 * A Dynamic Playlist being made ([id] null) or edited: its [name] so far, the library [view] it saves, how many albums it
 * plays ([limit]), what it is made of ([mode]) and in what [order]. The page's editTarget.
 */
data class SmartTarget(val id: String?, val name: String, val view: LibraryView, val limit: Int, val mode: String, val order: String) {
    /** The note under Order: what each order means for albums, or for tracks. */
    val orderNote: String get() = SmartEdit.orderNote(mode)
}

object SmartEdit {
    /** What a playlist is made of (the page's SMART_MODES), asked first by New. */
    val MODES = listOf(
        SmartChoice("albums", "Albums", "Queues whole albums, in their own running order."),
        SmartChoice("tracks", "Tracks", "Lists the tracks from those albums, so you can play or queue them one at a time."))
    /** The order it comes out in (SMART_ORDERS). */
    val ORDERS = listOf(SmartChoice("album", "Album order"), SmartChoice("random", "Random"))
    /** How many albums it may play (SMART_LIMITS), and what a new one plays. */
    val LIMITS = listOf(25, 50, 100, 200, 400)
    const val LIMIT_DEFAULT = 100
    const val ORDER_DEFAULT = "album"

    const val NEW_TITLE = "New Dynamic Playlist"
    const val NEW_INTRO = "What should this playlist be made of?"
    const val NEW_NOTE = "Either way the playlist follows the same focus, and re-runs it every time you open it — it isn't a fixed list. " +
        "The focus works at album level, so Tracks means the tracks OF the albums that match."
    const val SIZE_NOTE = "How many albums this playlist actually plays. A query can match your whole library, but a Sonos queue holds " +
        "1,000 tracks — 400 albums is thousands of tracks and takes minutes."
    const val PROMPT = "Name this Dynamic Playlist"

    /** The note under Order, for a playlist of [mode]. */
    fun orderNote(mode: String): String = (if (mode == "tracks")
        "Album order plays each record straight through, in the sort you chose. Random shuffles the albums AND the tracks inside them."
        else "Album order queues the albums in the sort you chose. Random shuffles which albums, and what order they play in.") +
        " The shuffle is fixed per playlist, so it stays put while you scroll rather than reshuffling under you."

    /** A new playlist of [mode] (New's choice), its focus starting from the Library's own [view]. */
    fun newTarget(view: LibraryView, mode: String) = SmartTarget(null, "", view.copy(prefix = ""), LIMIT_DEFAULT, mode, ORDER_DEFAULT)

    /** A saved playlist to edit: its own view, as the page's applyViewToLibView reads it. */
    fun editTarget(p: SmartPlaylist) = SmartTarget(p.id, p.name, viewOf(p.view), p.limit, p.mode, p.order)

    /** The name the box opens with: the playlist's own, or the page's suggestion. */
    fun suggested(target: SmartTarget?): String = target?.name?.takeIf { it.isNotEmpty() } ?: "My Dynamic Playlist"

    /**
     * A saved view as the Focus sheet holds it (applyViewToLibView): every facet it doesn't name off, its values as words
     * (a decade the server keeps as a number, as the page writes it), the sort, its direction, seed and listening kept.
     */
    fun viewOf(j: JSONObject): LibraryView {
        var v = LibraryView()
        j.optString("sort").takeIf { s -> LibraryView.SORTS.any { it.id == s } }?.let { v = v.copy(sort = it) }
        j.optString("dir").takeIf { it == "asc" || it == "desc" }?.let { v = v.copy(dir = it) }
        if (j.has("seed")) v = v.copy(seed = j.optInt("seed", v.seed))
        j.optString("played").takeIf { p -> LibraryView.PLAYED.any { it.id == p } }?.let { v = v.copy(played = it) }
        val facets = LinkedHashMap<String, List<String>>()
        for (id in LibraryView.FACET_IDS) {
            val a = j.optJSONArray(id) ?: continue
            val sel = (0 until a.length()).map { word(a.get(it)) }
            if (sel.isNotEmpty()) facets[id] = sel
        }
        return v.copy(facets = facets)
    }

    /** The view as a playlist saves it (the page's currentLibViewSnapshot): the sort, its direction and seed, the listening, every facet. */
    fun viewJson(v: LibraryView): JSONObject = JSONObject().put("sort", v.sort).put("dir", v.dir).put("seed", v.seed).put("played", v.played).also { o ->
        for (id in LibraryView.FACET_IDS) o.put(id, JSONArray().apply { for (x in v.facets[id] ?: emptyList()) put(x) })
    }

    /** What is said when no name is given; none when there is one. */
    fun nameError(name: String): String? = if (name.trim().isEmpty()) "Give it a name" else null

    /**
     * What is sent (POST /api/smart-playlists): its id when edited, the [name] trimmed, the [view]; and from [target] its
     * size, what it is made of and its order (Save as… from the Library has none, and takes the server's).
     */
    fun body(target: SmartTarget?, name: String, view: LibraryView): JSONObject = JSONObject()
        .put("id", target?.id ?: JSONObject.NULL).put("name", name.trim()).put("view", viewJson(view))
        .put("limit", target?.limit ?: JSONObject.NULL).put("mode", target?.mode ?: JSONObject.NULL).put("order", target?.order ?: JSONObject.NULL)

    /** What is said once it is saved ([j]: the server's answer): how many of the albums that match it plays, where it plays fewer. */
    fun saved(name: String, j: JSONObject): String {
        val p = j.optJSONObject("playlist")
        val limit = p?.opt("limit") as? Number
        val matched = p?.opt("album_matched") as? Number
        val n = name.trim()
        return if (limit != null && matched != null && matched.toInt() > limit.toInt())
            "Saved \"$n\" — it plays ${limit.toInt()} of the ${matched.toInt()} albums that match. Change that with Edit."
        else "Saved \"$n\""
    }

    private fun word(o: Any): String = if (o is Number && o.toDouble() == Math.floor(o.toDouble())) o.toLong().toString() else o.toString()
}
