package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import kotlin.random.Random

/*
 * The library offline, as the app answers for the server (bug list item 106, O1 in old/plan-android-native.md;
 * what the app's OfflineApi answered the page with): the albums downloaded to this phone, each with the page saved when
 * it was downloaded, and the phone's own music. The rows the phone keeps nothing for (not played lately, history, the
 * album of the day, label of the week, genres, Smart Picks) answer empty, as the server's do with nothing to show.
 */

/** A downloaded album as the phone keeps it: its download's [id] (the server's album id), what it is, its [page] when it was saved. */
data class ShelfAlbum(
    val id: Int, val title: String, val artist: String, val year: Int?, val imageKey: String?, val addedAt: Long,
    val tracks: List<ShelfTrack>, val page: JSONObject? = null,
)

/** One of its tracks: the server's id, its title and length in seconds. */
data class ShelfTrack(val id: Long, val title: String, val duration: Double)

/** An album of the phone's own music (its key, its [hasArt] cover), and its tracks. */
data class PhoneAlbum(val key: String, val title: String, val artist: String, val year: Int?, val hasArt: Boolean, val tracks: List<PhoneTrack>)

/** One of its tracks: what its tags say, its length, its file's type, rate and depth. */
data class PhoneTrack(val title: String, val artist: String, val duration: Double, val ext: String, val rate: Int, val bits: Int)

/** The phone's own music as it was last read: its albums, the folder read, whether a read is under way and when the last ended. */
data class PhoneMusic(val albums: List<PhoneAlbum> = emptyList(), val folder: String? = null, val scanning: Boolean = false, val scannedAt: Long = 0)

/** The library on this phone ([downloads] finished, the phone's [music]), answering as the server would. */
class PhoneShelf(private val downloads: List<ShelfAlbum>, private val music: PhoneMusic = PhoneMusic(), private val random: Random = Random.Default) {

    /** The answer to GET [path] with [q], or null when it isn't the library's to answer. */
    fun get(path: String, q: Map<String, String>): Answer? = when (path) {
        "/api/library/albums" -> {
            var list = when (q["sort"]) {
                "artist" -> downloads.sortedBy { it.artist.lowercase() }
                "year" -> downloads.sortedBy { it.year ?: 9999 }
                "added" -> downloads.sortedBy { it.addedAt }
                "random" -> downloads.shuffled(random)
                else -> downloads.sortedBy { it.title.lowercase() }
            }
            if (q["dir"] == "desc") list = list.reversed()
            val offset = (q["offset"]?.toIntOrNull() ?: 0).coerceIn(0, list.size)
            val count = (q["count"]?.toIntOrNull() ?: 60).coerceIn(1, 200)
            Answer.ok(JSONObject().put("albums", albums(list.drop(offset).take(count))).put("offset", offset).put("total", list.size))
        }
        "/api/random-albums" -> {
            val list = downloads.shuffled(random).take(q["count"]?.toIntOrNull() ?: 30)
            Answer.ok(JSONObject().put("albums", albums(list)).put("total", list.size).put("filtered", false))
        }
        // A random one of the phone's, as Random Album asks (the page's play-unheard.js, native pickUnheard).
        "/api/pick-unheard" -> downloads.randomOrNull(random)?.let { Answer.ok(JSONObject().put("album", json(it))) }
            ?: Answer.error(404, "Nothing downloaded to play")
        // Not played in 6 months: the phone keeps no history of its own to judge by, so it is empty (v0.6.13).
        "/api/home/unplayed" -> Answer.ok(JSONObject().put("albums", JSONArray()).put("total", 0).put("months", 6).put("no_history", true).put("ready_at", JSONObject.NULL))
        "/api/home/history" -> Answer.ok(JSONObject().put("albums", JSONArray()).put("days", 30))
        "/api/home/album-of-the-day" -> Answer.ok(JSONObject().put("album", JSONObject.NULL))
        "/api/home/label-of-the-week" -> Answer.ok(JSONObject().put("label", JSONObject.NULL).put("albums", JSONArray()))
        "/api/home/genre-groups" -> Answer.ok(JSONObject().put("parent", JSONObject.NULL).put("pop", JSONArray()).put("rockmetal", JSONArray()).put("flat", true))
        "/api/smart-picks" -> Answer.ok(JSONObject().put("day", "").put("enabled", false).put("service_ready", false).put("building", false).put("picks", JSONArray()))
        "/api/discover" -> Answer.ok(JSONObject().put("enabled", false).put("albums", JSONArray()))
        "/api/library/facets" -> Answer.ok(JSONObject().put("facets", JSONArray()))
        "/api/filters/genres" -> Answer.ok(JSONObject().put("genres", JSONArray()))
        "/api/filters/decades" -> Answer.ok(JSONObject().put("decades", JSONArray()))
        "/api/radio" -> Answer.ok(JSONObject().put("enabled", false).put("zones", JSONArray()))
        // Playlists offline (v0.5.58): the server's aren't shown, their albums not on the phone.
        "/api/user-playlists", "/api/playlists" -> Answer.ok(JSONObject().put("playlists", JSONArray()))
        "/api/search" -> {
            val term = (q["q"] ?: "").trim().lowercase()
            val hits = if (term.isEmpty()) emptyList() else downloads.filter { it.title.lowercase().contains(term) || it.artist.lowercase().contains(term) }
            Answer.ok(JSONObject().put("query", q["q"] ?: "").put("count", hits.size).put("indexed", downloads.size)
                .put("results", albums(hits)).put("artists", JSONArray()).put("labels", JSONArray()))
        }
        "/api/artist-albums" -> {
            val name = (q["artist"] ?: "").trim().lowercase()
            Answer.ok(JSONObject().put("artist", q["artist"] ?: "").put("primary", albums(downloads.filter { it.artist.lowercase().contains(name) })).put("featured", JSONArray()))
        }
        "/api/album" -> album(q["offset"] ?: "")
        "/api/album/extras" -> Answer.ok(JSONObject())
        // The phone's own music: the page's "On this phone".
        "/api/phone-music/albums" -> Answer.ok(JSONObject().put("albums", JSONArray().apply { music.albums.forEach { put(phoneJson(it)) } })
            .put("folder", music.folder ?: JSONObject.NULL).put("scanning", music.scanning).put("scanned_at", music.scannedAt))
        else -> null
    }

    /** POST /api/download/albums: each of [ids] as the library has it, here the phone's own downloads. */
    fun downloadAlbums(ids: List<Int>, all: List<ShelfAlbum> = downloads): Answer {
        val out = JSONArray()
        for (id in ids) {
            val a = all.firstOrNull { it.id == id }
            if (a == null) { out.put(JSONObject().put("id", id).put("exists", false)); continue }
            val j = json(a)
            out.put(JSONObject().put("id", id).put("exists", true).put("title", a.title).put("artist", a.artist).put("year", a.year ?: JSONObject.NULL)
                .put("image_key", j.optString("image_key")).put("art_url", "/api/image/" + j.optString("image_key")).put("album", j))
        }
        return Answer.ok(JSONObject().put("albums", out))
    }

    /** The download [id], or null when it isn't on the phone. */
    fun download(id: Int): ShelfAlbum? = downloads.firstOrNull { it.id == id }

    /** One of the phone's own albums by its [key]. */
    fun phoneAlbum(key: String): PhoneAlbum? = music.albums.firstOrNull { it.key == key }

    /** Every downloaded album, for a random one to play. */
    fun all(): List<ShelfAlbum> = downloads

    private fun album(offset: String): Answer {
        if (offset.startsWith("phone:")) {
            val a = phoneAlbum(offset.removePrefix("phone:")) ?: return Answer.error(409, "That album isn't on this phone any more")
            return Answer.ok(phonePage(a))
        }
        val a = download(offset.toIntOrNull() ?: -1) ?: return Answer.error(409, "That album isn't on this phone")
        return Answer.ok(page(a))
    }

    private fun albums(list: List<ShelfAlbum>) = JSONArray().apply { list.forEach { put(json(it)) } }

    companion object {
        /** The paths [get] answers, so a caller reads the phone's library only for those. */
        val PATHS = setOf("/api/library/albums", "/api/random-albums", "/api/pick-unheard", "/api/home/unplayed", "/api/home/history",
            "/api/home/album-of-the-day", "/api/home/label-of-the-week", "/api/home/genre-groups", "/api/smart-picks", "/api/discover",
            "/api/library/facets", "/api/filters/genres", "/api/filters/decades", "/api/radio", "/api/user-playlists", "/api/playlists",
            "/api/search", "/api/artist-albums", "/api/album", "/api/album/extras", "/api/phone-music/albums")

        private val ACTIONS = listOf("play_now" to "Play Now", "queue" to "Queue", "play_next" to "Play Next", "shuffle" to "Shuffle")
        private fun actions() = JSONArray(ACTIONS.map { JSONObject().put("kind", it.first).put("title", it.second) })
        private fun clock(len: Int) = "%d:%02d".format(len / 60, len % 60)

        /** A download as the server's lists show it: the album its saved page has, or what the phone knows of it. */
        fun json(a: ShelfAlbum): JSONObject {
            a.page?.optJSONObject("album")?.let { return JSONObject(it.toString()).put("offset", a.id) }
            return JSONObject().put("offset", a.id).put("title", a.title).put("subtitle", a.artist)
                .put("image_key", a.imageKey ?: "al-${a.id}").put("source", JSONObject.NULL)
                .apply { a.year?.let { put("year", it) } }
        }

        /** Its page: the one saved when it was downloaded, or, downloaded before pages were kept, made from what the phone knows. */
        fun page(a: ShelfAlbum): JSONObject {
            a.page?.let { return it }
            val tracks = JSONArray()
            for (t in a.tracks) {
                val len = t.duration.toInt()
                tracks.put(JSONObject().put("title", t.title).put("subtitle", clock(len)).put("length", len).put("track_id", t.id).put("quality", JSONObject.NULL))
            }
            return JSONObject().put("album", json(a)).put("tracks", tracks).put("actions", actions())
                .put("offset", a.id).put("artists", JSONArray().put(a.artist))
                .put("library_moved", false).put("partial", false).put("declared_tracks", tracks.length())
        }

        /** One of the phone's own albums as the server's lists show one, its badge as the server shapes it. */
        fun phoneJson(a: PhoneAlbum): JSONObject = JSONObject()
            .put("key", a.key).put("offset", "phone:${a.key}").put("title", a.title).put("subtitle", a.artist)
            .put("image_key", if (a.hasArt) "phone-${a.key}" else JSONObject.NULL).put("source", "local")
            .put("tracks", a.tracks.size).put("year", a.year ?: JSONObject.NULL)
            .put("quality", quality(a) ?: JSONObject.NULL).put("hires", hires(a))

        /** Its page, as the server shapes one. */
        fun phonePage(a: PhoneAlbum): JSONObject {
            val tracks = JSONArray()
            for (t in a.tracks) {
                val len = t.duration.toInt()
                tracks.put(JSONObject().put("title", t.title).put("subtitle", clock(len)).put("length", len).put("track_id", JSONObject.NULL)
                    .put("artist", t.artist).put("quality", depth(t) ?: JSONObject.NULL))
            }
            return JSONObject().put("album", phoneJson(a)).put("tracks", tracks).put("actions", actions())
                .put("offset", "phone:${a.key}").put("artists", JSONArray().put(a.artist))
                .put("library_moved", false).put("partial", false).put("declared_tracks", tracks.length()).put("on_phone", true)
        }

        /**
         * One of the phone's own albums as the app's album page reads one (item 108): its page, with no offset of the
         * server's (-1) and each track numbered by its place (-1, -2, …) where the server would have its id.
         */
        fun phoneView(a: PhoneAlbum): Album {
            val page = phonePage(a).put("offset", -1)
            page.getJSONObject("album").put("offset", -1)
            val tracks = page.getJSONArray("tracks")
            for (i in 0 until tracks.length()) tracks.getJSONObject(i).put("track_id", -(i + 1))
            return Album.parse(page)
        }

        /** The tile's badge: "24/96" for a lossless file whose depth and rate are known, the format for a lossy one. */
        fun quality(a: PhoneAlbum): String? {
            val t = a.tracks.firstOrNull() ?: return null
            if (t.ext !in LOSSLESS) return t.ext.uppercase()
            return depth(t)
        }

        /** Marked hi-res: over 48 kHz or 16 bits. */
        fun hires(a: PhoneAlbum): Boolean = a.tracks.firstOrNull()?.let { it.rate > 48000 || it.bits > 16 } ?: false

        private val LOSSLESS = setOf("flac", "wav", "aif", "aiff", "alac", "wv", "ape")
        private fun depth(t: PhoneTrack): String? {
            if (t.rate <= 0 || t.bits <= 0) return null
            val khz = if (t.rate % 1000 == 0) (t.rate / 1000).toString() else String.format(java.util.Locale.ROOT, "%.1f", t.rate / 1000.0)
            return "${t.bits}/$khz"
        }
    }
}
