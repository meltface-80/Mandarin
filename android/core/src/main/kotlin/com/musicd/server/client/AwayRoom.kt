package com.musicd.server.client

import org.json.JSONObject

/*
 * Away from home this phone is the one room (bug list item 487). The server offers no other there, and refuses whatever
 * names another: 403, "Away from home, only this phone plays" (PlaybackRoutes.cs). But a screen is opened in a room and
 * stays on show (item 117): one opened at home in the Bridge's room went on asking for the Bridge's from the train, so
 * Now playing and the mini player showed the Bridge and their buttons did nothing, until the phone was chosen in Play
 * on, on each screen in turn. Offline the phone has always taken what any screen sends ([PhoneRoom]); away it does now
 * too: what a screen sends for a room is sent for the phone's.
 */

/** [inner]'s answers, a room's requests sent for this phone's room while away: [phone] its id then, null at home (or not yet known). */
class AwayRoom(private val inner: Transport, private val phone: () -> String?) : Transport {
    override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject {
        val own = phone()
        return if (own.isNullOrEmpty()) inner.json(method, path, body, timeout)
        else inner.json(method, AwayRooms.path(path, own), AwayRooms.body(path, body, own), timeout)
    }
    override fun bytes(path: String, timeout: Int): ByteArray = inner.bytes(path, timeout)
    override fun upload(path: String, bytes: ByteArray, type: String, timeout: Int): JSONObject = inner.upload(path, bytes, type, timeout)
}

object AwayRooms {
    /**
     * What is asked of a room or sent to one, the room named in it: the server's playback requests (PlaybackRoutes.cs,
     * Gets and Posts) but those it keeps for home (HomeOnly: every room paused or muted, rooms grouped, a queue moved
     * between two), the lists of rooms, a speaker's own switches, and SQ-tool's, which measure a room that is named.
     */
    val PATHS = setOf(
        "/api/zone-state", "/api/queue", "/api/radio", "/api/album/now-playing", "/api/pick-unheard", "/api/shortcut/play-random",
        "/api/shortcut/play-unheard", "/api/bitperfect", "/api/control", "/api/seek", "/api/volume", "/api/zone-settings", "/api/play",
        "/api/play-track", "/api/play-multi", "/api/play-from-here", "/api/play-unheard", "/api/queue/remove", "/api/queue/clear",
        "/api/queue/move", "/api/queue/play-history-next", "/api/queue/history-multi")

    /** What the server says of another room's request away (PlaybackRoutes.cs). */
    const val REFUSED = "Away from home, only this phone plays"

    /** The fields that name the room, in the address or the body (the server's PhoneFields, but a move's from and to). */
    val FIELDS = setOf("zone", "zone_or_output_id", "output_id", "zone_id")

    private fun ours(path: String) = path.substringBefore('?') in PATHS

    /** [path] with a room named in its query made [own]; another's request, or one that names none or this phone's, as it is. */
    fun path(path: String, own: String): String {
        val at = path.indexOf('?')
        if (at < 0 || !ours(path)) return path
        var changed = false
        val query = path.substring(at + 1).split('&').joinToString("&") { pair ->
            val eq = pair.indexOf('=')
            val name = if (eq < 0) pair else pair.substring(0, eq)
            val value = if (eq < 0) "" else java.net.URLDecoder.decode(pair.substring(eq + 1), "UTF-8")
            if (name in FIELDS && value.isNotEmpty() && value != own) { changed = true; name + "=" + java.net.URLEncoder.encode(own, "UTF-8") } else pair
        }
        return if (changed) path.substring(0, at + 1) + query else path
    }

    /** [body] with a room named in it made [own], in a copy (the caller's own is left as sent); as it is where nothing changes. */
    fun body(path: String, body: JSONObject?, own: String): JSONObject? {
        if (body == null || !ours(path)) return body
        val named = FIELDS.filter { f -> body.has(f) && !body.isNull(f) && body.optString(f).let { it.isNotEmpty() && it != own } }
        if (named.isEmpty()) return body
        return JSONObject(body.toString()).also { copy -> named.forEach { copy.put(it, own) } }
    }
}
