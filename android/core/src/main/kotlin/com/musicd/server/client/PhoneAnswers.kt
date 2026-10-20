package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * The server's /api answered by the app when the server can't be reached (bug list item 107, O1 in
 * old/plan-android-native.md; the app's OfflineApi before): the library is the phone's ([PhoneShelf]), the one
 * room this phone ([PhoneRoom]); this phone's audio device and the covers are the app's to answer; a setting answers as
 * the server last did. Anything that needs the server says so rather than pretend.
 */

/** What the app knows of itself offline: its [version], who is signed in, whether Offline mode is on. */
data class PhoneInfo(val version: String, val username: String, val offlineMode: Boolean)

class PhoneAnswers(
    private val info: () -> PhoneInfo,
    private val shelf: () -> PhoneShelf,
    private val room: PhoneRoom,
    /** Every download, finished or not (what the library is asked about). */
    private val everyDownload: () -> List<ShelfAlbum>,
    /** Settings → Audio Devices: this phone's device, by method and path, or null when it isn't one of its paths. */
    private val devices: (method: String, path: String, body: JSONObject) -> Answer? = { _, _, _ -> null },
    /** A cover by its key. */
    private val image: (key: String) -> Answer = { Answer(404, bytes = ByteArray(0), mime = "text/plain") },
    /** A setting's answer as the server last gave it. */
    private val cached: (path: String) -> JSONObject? = { null },
) {
    /** The answer to [method] on [path] with its [query] and [body]. */
    fun answer(method: String, path: String, query: Map<String, String>, body: JSONObject?): Answer = try {
        if (method == "GET") get(path, query) else post(method, path, body ?: JSONObject())
    } catch (e: Exception) {
        Answer.error(500, e.message ?: "offline error")
    }

    private fun get(path: String, q: Map<String, String>): Answer {
        if (path in PhoneShelf.PATHS) shelf().get(path, q)?.let { return it }
        when (path) {
            "/api/health" -> return Answer.ok(JSONObject().put("ok", true).put("version", info().version)
                .put("albums", shelf().all().size).put("rooms", 0).put("offline", true))
            "/api/status" -> {
                val me = info()
                return Answer.ok(JSONObject().put("offline", true).put("offline_mode", me.offlineMode).put("away", true).put("paired", true)
                    .put("core_id", "musicd-server").put("core_name", "Mandarin").put("zone_count", 1)
                    .put("library_importing", false).put("index_count", shelf().all().size)
                    .put("sonos", JSONObject().put("rooms", 0).put("discovered", 0).put("searching", false))
                    .put("music_dir_exists", true).put("data_persistent", true)
                    .put("scan", JSONObject().put("running", false).put("progress", 0).put("files_seen", 0).put("last", JSONObject().put("status", "ok")))
                    .put("version", me.version))
            }
            "/api/auth/status" -> return Answer.ok(JSONObject().put("setup_required", false).put("can_setup", false)
                .put("away", true).put("signed_in", true).put("username", info().username))
        }
        room.get(path, q)?.let { return it }
        // Dynamic Playlists offline: the list as the server last gave it, its playlists left out (their albums aren't here).
        if (path == "/api/smart-playlists") return Answer.ok((cached(path) ?: JSONObject()).put("playlists", JSONArray()))
        devices("GET", path, JSONObject())?.let { return it }
        if (path.startsWith("/api/image/")) return image(java.net.URLDecoder.decode(path.removePrefix("/api/image/"), "UTF-8").substringBefore('?'))
        return Answer.ok(cached(path) ?: JSONObject())
    }

    private fun post(method: String, path: String, b: JSONObject): Answer {
        devices(method, path, b)?.let { return it }
        room.post(path, b)?.let { return it }
        if (path == "/api/download/albums") {
            val ids = b.optJSONArray("ids") ?: JSONArray()
            return shelf().downloadAlbums((0 until ids.length()).map { ids.optInt(it) }, everyDownload())
        }
        return Answer.error(503, OFFLINE)
    }

    companion object {
        const val OFFLINE = "Not available offline — Mandarin can't be reached"
    }
}
