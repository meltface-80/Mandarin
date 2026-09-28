package com.musicd.server.android

import android.content.Context
import android.content.Intent
import com.musicd.server.client.Phone
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The server's /api, answered by the app when the server can't be reached —
 * so MusicD's own interface works offline, on what's on the phone.
 *
 * The library is the downloaded albums; the one room is This phone, played
 * by the phone player; album pages are the ones saved when each album was
 * downloaded (OfflineSite). Settings answer as the server last did. Anything
 * that needs the server — Sonos rooms, editing, search beyond the phone —
 * says so instead of pretending.
 */
object OfflineApi {

    class Response(val status: Int, val mime: String, val body: ByteArray)

    private fun json(o: Any, status: Int = 200) = Response(status, "application/json", o.toString().toByteArray())
    private fun error(msg: String, status: Int = 503) = json(JSONObject().put("error", msg), status)
    private val OFFLINE = "Not available offline — MusicD Server can't be reached"

    fun handle(c: Context, method: String, path: String, query: Map<String, String>, body: String?): Response {
        val b = runCatching { if (body.isNullOrBlank()) JSONObject() else JSONObject(body) }.getOrDefault(JSONObject())
        return try {
            if (method == "GET") get(c, path, query) else post(c, path, b)
        } catch (e: Exception) {
            error(e.message ?: "offline error", 500)
        }
    }

    // ------------------------------------------------------------ library

    private class Local(val album: DownloadStore.Album, val dir: File) {
        val page: JSONObject? by lazy {
            runCatching { JSONObject(File(dir, "page.json").readText()) }.getOrNull()
        }
        /** The album as the server's lists show it. */
        fun json(): JSONObject {
            page?.optJSONObject("album")?.let { return JSONObject(it.toString()).put("offset", album.id) }
            return JSONObject().put("offset", album.id).put("title", album.title).put("subtitle", album.artist)
                .put("image_key", album.imageKey ?: "al-${album.id}").put("source", JSONObject.NULL)
                .apply { album.year?.let { put("year", it) } }
        }
    }

    private fun library(c: Context): List<Local> =
        DownloadStore.albums(c).filter { it.first.state == "done" }.map { Local(it.first, it.second) }

    private fun local(c: Context, id: Int): Local? = library(c).firstOrNull { it.album.id == id }

    private fun albums(list: List<Local>) = JSONArray().apply { list.forEach { put(it.json()) } }

    private fun albumPage(l: Local): JSONObject {
        l.page?.let { return it }
        // Downloaded before album pages were kept: made from what the phone knows.
        val tracks = JSONArray()
        for (t in l.album.tracks) {
            val len = t.duration.toInt()
            tracks.put(JSONObject().put("title", t.title).put("subtitle", "%d:%02d".format(len / 60, len % 60))
                .put("length", len).put("track_id", t.id).put("quality", JSONObject.NULL))
        }
        return JSONObject().put("album", l.json()).put("tracks", tracks)
            .put("actions", JSONArray(listOf("play_now" to "Play Now", "queue" to "Queue", "play_next" to "Play Next", "shuffle" to "Shuffle")
                .map { JSONObject().put("kind", it.first).put("title", it.second) }))
            .put("offset", l.album.id).put("artists", JSONArray().put(l.album.artist))
            .put("library_moved", false).put("partial", false).put("declared_tracks", tracks.length())
    }

    // ------------------------------------------------------------ the player

    private fun player(c: Context): PhonePlayerService? {
        PhonePlayerService.current?.let { return it }
        runCatching { c.startService(Intent(c, PhonePlayerService::class.java)) }
        val until = System.currentTimeMillis() + 3000
        while (System.currentTimeMillis() < until) {
            PhonePlayerService.current?.let { return it }
            Thread.sleep(50)
        }
        return null
    }

    private fun zoneId(c: Context) = Store.phoneZone(c)

    private fun output(c: Context, st: PhonePlayerService.OfflineState?): JSONObject {
        val id = zoneId(c)
        return JSONObject().put("output_id", id).put("zone_id", id).put("display_name", "This phone")
            .put("model", "Phone").put("stereo_pair", false).put("is_muted", st?.muted ?: false)
            .put("volume", JSONObject().put("type", "number").put("min", 0).put("max", 100).put("step", 1)
                .put("value", st?.volume ?: 50).put("soft_limit", 100).put("is_muted", st?.muted ?: false))
            .put("can_group_with_output_ids", JSONArray().put(id)).put("source_controls", JSONArray())
    }

    private fun settings(st: PhonePlayerService.OfflineState?) = JSONObject()
        .put("shuffle", st?.shuffle ?: false).put("loop", st?.loop ?: "disabled").put("auto_radio", false)

    private fun zoneJson(c: Context, st: PhonePlayerService.OfflineState?): JSONObject {
        val cur = if (st == null) null else st.items.getOrNull(st.index)
        val np = if (st == null || cur == null) JSONObject.NULL else JSONObject()
            .put("line1", cur.title).put("line2", cur.artist).put("line3", cur.album)
            .put("artists", JSONArray().put(JSONObject().put("name", cur.artist).put("linkable", true)))
            .put("image_key", cur.imageKey ?: (if (cur.albumId >= 0) "al-${cur.albumId}" else JSONObject.NULL))
            .put("length", (if (st.duration > 0) st.duration else cur.duration).toInt())
            .put("seek_position", st.position.toInt())
            .put("track_id", cur.trackId ?: JSONObject.NULL)
            .put("album_offset", if (cur.albumId >= 0) cur.albumId else JSONObject.NULL)
        val count = st?.items?.size ?: 0
        val index = st?.index ?: -1
        val state = st?.state ?: "stopped"
        return JSONObject()
            .put("zone_id", zoneId(c)).put("display_name", "This phone").put("state", state)
            .put("is_play_allowed", state != "playing").put("is_pause_allowed", state == "playing" || state == "loading")
            .put("is_next_allowed", index in 0 until count - 1 || (st?.loop ?: "disabled") != "disabled")
            .put("is_previous_allowed", count > 0).put("is_seek_allowed", (st?.duration ?: 0.0) > 0)
            .put("settings", settings(st)).put("outputs", JSONArray().put(output(c, st)))
            .put("now_playing", np)
    }

    private fun command(c: Context, op: String, fill: (Phone.Command) -> Phone.Command = { it }): Response {
        val p = player(c) ?: return error("The phone's player didn't start")
        p.offlineCommand(fill(Phone.Command(seq = 0, op = op)))
        return json(JSONObject().put("ok", true))
    }

    private fun normalise(kind: String?) = when (kind) {
        "queue", "add_to_queue" -> "queue"
        "play_next", "add_next", "next" -> "add_next"
        else -> "play_now"
    }

    private fun play(c: Context, ids: List<Int>, kind: String?, start: Int = 0, only: Int? = null): Response {
        val p = player(c) ?: return error("The phone's player didn't start")
        if (!p.offlinePlay(ids, start, normalise(kind), only)) return error("That album isn't on this phone", 404)
        if (kind == "shuffle") p.offlineCommand(Phone.Command(seq = 0, op = "mode", shuffle = true, loop = p.offlineState()?.loop ?: "disabled"))
        return json(JSONObject().put("ok", true).put("action", kind ?: "play_now"))
    }

    // ------------------------------------------------------------ GET

    private fun get(c: Context, path: String, q: Map<String, String>): Response {
        when (path) {
            "/api/health" -> return json(JSONObject().put("ok", true).put("version", BuildConfig.VERSION_NAME)
                .put("albums", library(c).size).put("rooms", 0).put("offline", true))
            "/api/status" -> {
                val n = library(c).size
                return json(JSONObject().put("offline", true).put("away", true).put("paired", true)
                    .put("core_id", "musicd-server").put("core_name", "MusicD Server").put("zone_count", 1)
                    .put("library_importing", false).put("index_count", n)
                    .put("sonos", JSONObject().put("rooms", 0).put("discovered", 0).put("searching", false))
                    .put("music_dir_exists", true).put("data_persistent", true)
                    .put("scan", JSONObject().put("running", false).put("progress", 0).put("files_seen", 0)
                        .put("last", JSONObject().put("status", "ok")))
                    .put("version", BuildConfig.VERSION_NAME))
            }
            "/api/auth/status" -> return json(JSONObject().put("setup_required", false).put("can_setup", false)
                .put("away", true).put("signed_in", true).put("username", Store.username(c) ?: ""))
            "/api/zones" -> {
                val st = PhonePlayerService.current?.offlineState()
                return json(JSONObject().put("away", true).put("zones", JSONArray().put(JSONObject()
                    .put("zone_id", zoneId(c)).put("display_name", "This phone").put("state", st?.state ?: "stopped")
                    .put("settings", settings(st)).put("outputs", JSONArray().put(output(c, st))).put("is_phone", true))))
            }
            "/api/shortcut/zones" -> {
                val st = PhonePlayerService.current?.offlineState()
                return json(JSONObject().put("zones", JSONArray().put(JSONObject().put("zone_id", zoneId(c))
                    .put("display_name", "This phone").put("state", st?.state ?: "stopped").put("is_phone", true)))
                    .put("last_zone", zoneId(c)))
            }
            "/api/outputs" -> return json(JSONObject().put("outputs", JSONArray()))
            "/api/zone-state" -> {
                val p = player(c)
                val waitFor = q["wait_for"]?.toLongOrNull()
                // Held briefly: the WebView answers requests from a few threads, and this one mustn't hog them.
                if (p != null && waitFor != null) p.waitForChange(waitFor, (q["timeout"]?.toLongOrNull() ?: 1500L).coerceIn(0, 1500))
                val st = p?.offlineState()
                return json(JSONObject().put("revision", st?.revision ?: p?.revision ?: 1).put("zone", zoneJson(c, st)))
            }
            "/api/queue" -> {
                val st = PhonePlayerService.current?.offlineState()
                val items = JSONArray()
                val history = JSONArray()
                val at = st?.index ?: 0
                st?.items?.forEachIndexed { i, it ->
                    val key = it.imageKey ?: if (it.albumId >= 0) "al-${it.albumId}" else null
                    if (i >= at) items.put(JSONObject().put("queue_item_id", i + 1).put("title", it.title)
                        .put("subtitle", it.artist).put("album", it.album).put("image_key", key ?: JSONObject.NULL)
                        .put("length", it.duration.toInt()))
                    else history.put(JSONObject().put("track", it.title).put("artist", it.artist).put("album", it.album)
                        .put("image_key", key ?: JSONObject.NULL).put("duration", it.duration.toInt())
                        .put("elapsed", it.duration.toInt()).put("played", true).put("queue_item_id", i + 1))
                }
                val h = JSONArray(); for (i in history.length() - 1 downTo 0) h.put(history.get(i))
                return json(JSONObject().put("items", items).put("history", h))
            }
            "/api/library/albums" -> {
                var list = library(c)
                list = when (q["sort"]) {
                    "artist" -> list.sortedBy { it.album.artist.lowercase() }
                    "year" -> list.sortedBy { it.album.year ?: 9999 }
                    "added" -> list.sortedBy { it.album.addedAt }
                    "random" -> list.shuffled()
                    else -> list.sortedBy { it.album.title.lowercase() }
                }
                if (q["dir"] == "desc") list = list.reversed()
                val offset = (q["offset"]?.toIntOrNull() ?: 0).coerceIn(0, list.size)
                val count = (q["count"]?.toIntOrNull() ?: 60).coerceIn(1, 200)
                return json(JSONObject().put("albums", albums(list.drop(offset).take(count)))
                    .put("offset", offset).put("total", list.size))
            }
            "/api/random-albums" -> {
                val list = library(c).shuffled().take(q["count"]?.toIntOrNull() ?: 30)
                return json(JSONObject().put("albums", albums(list)).put("total", list.size).put("filtered", false))
            }
            "/api/home/unplayed" -> {
                val list = library(c).shuffled().take(q["count"]?.toIntOrNull() ?: 12)
                return json(JSONObject().put("albums", albums(list)).put("total", list.size).put("months", 6))
            }
            "/api/home/history" -> return json(JSONObject().put("albums", JSONArray()).put("days", 30))
            "/api/home/album-of-the-day" -> return json(JSONObject().put("album", JSONObject.NULL))
            "/api/home/label-of-the-week" -> return json(JSONObject().put("label", JSONObject.NULL).put("albums", JSONArray()))
            "/api/home/genre-groups" -> return json(JSONObject().put("parent", JSONObject.NULL)
                .put("pop", JSONArray()).put("rockmetal", JSONArray()).put("flat", true))
            "/api/smart-picks" -> return json(JSONObject().put("day", "").put("enabled", false)
                .put("service_ready", false).put("building", false).put("picks", JSONArray()))
            "/api/discover" -> return json(JSONObject().put("enabled", false).put("albums", JSONArray()))
            "/api/library/facets" -> return json(JSONObject().put("facets", JSONArray()))
            "/api/filters/genres" -> return json(JSONObject().put("genres", JSONArray()))
            "/api/filters/decades" -> return json(JSONObject().put("decades", JSONArray()))
            "/api/radio" -> return json(JSONObject().put("enabled", false).put("zones", JSONArray()))
            "/api/search" -> {
                val term = (q["q"] ?: "").trim().lowercase()
                val hits = if (term.isEmpty()) emptyList() else library(c).filter {
                    it.album.title.lowercase().contains(term) || it.album.artist.lowercase().contains(term)
                }
                return json(JSONObject().put("query", q["q"] ?: "").put("count", hits.size).put("indexed", library(c).size)
                    .put("results", albums(hits)).put("artists", JSONArray()).put("labels", JSONArray()))
            }
            "/api/artist-albums" -> {
                val name = (q["artist"] ?: "").trim().lowercase()
                val hits = library(c).filter { it.album.artist.lowercase().contains(name) }
                return json(JSONObject().put("artist", q["artist"] ?: "").put("primary", albums(hits)).put("featured", JSONArray()))
            }
            "/api/album" -> {
                val l = local(c, q["offset"]?.toIntOrNull() ?: -1) ?: return error("That album isn't on this phone", 409)
                return json(albumPage(l))
            }
            "/api/album/extras" -> return json(JSONObject())
            "/api/album/now-playing" -> {
                val cur = PhonePlayerService.current?.offlineState()?.let { it.items.getOrNull(it.index) }
                val l = cur?.let { local(c, it.albumId) }
                return json(JSONObject().put("album", l?.json() ?: JSONObject.NULL))
            }
            "/api/shortcut/play-random" -> {
                val l = library(c).randomOrNull() ?: return error("Nothing downloaded to play", 404)
                val r = play(c, listOf(l.album.id), "play_now")
                return if (r.status == 200) json(JSONObject().put("ok", true).put("album", l.json())) else r
            }
        }
        if (path.startsWith("/api/image/")) return image(c, path.removePrefix("/api/image/"))
        OfflineSite.api(c, path)?.let { return Response(200, "application/json", it.toByteArray()) }
        return json(JSONObject())
    }

    /** A cover, by the key the page asks for: the downloaded album's cover.jpg. */
    private fun image(c: Context, rawKey: String): Response {
        val key = java.net.URLDecoder.decode(rawKey, "UTF-8")
        val all = DownloadStore.albums(c)
        val hit = all.firstOrNull { it.first.imageKey == key }
            ?: Regex("^al-(\\d+)").find(key)?.groupValues?.get(1)?.toIntOrNull()?.let { id -> all.firstOrNull { it.first.id == id } }
        val f = hit?.let { File(it.second, "cover.jpg") }
        return if (f != null && f.exists()) Response(200, "image/jpeg", f.readBytes()) else Response(404, "text/plain", ByteArray(0))
    }

    // ------------------------------------------------------------ POST

    private fun post(c: Context, path: String, b: JSONObject): Response {
        when (path) {
            "/api/play" -> return play(c, listOf(b.optInt("offset", -1)), b.optString("kind", "play_now"))
            "/api/play-track" -> {
                val album = b.optInt("offset", -1)
                val index = if (b.has("track")) b.optInt("track") else b.optInt("track_index")
                val kind = normalise(b.optString("kind", "play_now"))
                return if (kind == "play_now") play(c, listOf(album), "play_now", start = index)
                else play(c, listOf(album), kind, only = index)
            }
            "/api/play-multi" -> {
                val ids = ArrayList<Int>()
                b.optJSONArray("items")?.let { a -> for (i in 0 until a.length()) ids += a.getJSONObject(i).optInt("offset") }
                b.optJSONArray("offsets")?.let { a -> for (i in 0 until a.length()) ids += a.optInt(i) }
                val on = ids.filter { id -> local(c, id) != null }
                if (on.isEmpty()) return error("None of those albums are on this phone", 404)
                val r = play(c, on, b.optString("kind", "play_now"))
                return if (r.status == 200) json(JSONObject().put("ok", true).put("queued", on.size)
                    .put("failed", ids.size - on.size).put("total", ids.size)) else r
            }
            "/api/play-unheard" -> {
                val l = library(c).randomOrNull() ?: return error("Nothing downloaded to play", 404)
                val r = play(c, listOf(l.album.id), "play_now")
                return if (r.status == 200) json(JSONObject().put("ok", true).put("album", l.json())) else r
            }
            "/api/control" -> {
                val cmd = b.optString("command")
                val op = when (cmd) {
                    "playpause" -> if (PhonePlayerService.current?.offlineState()?.state == "playing") "pause" else "play"
                    "play", "pause", "stop", "next", "previous" -> cmd
                    else -> return error("invalid command", 400)
                }
                return command(c, op)
            }
            "/api/seek" -> {
                val secs = b.optDouble("seconds", 0.0)
                val now = PhonePlayerService.current?.offlineState()?.position ?: 0.0
                val to = if (b.optString("how") == "relative") now + secs else secs
                return command(c, "seek") { Phone.Command(seq = 0, op = "seek", seconds = maxOf(0.0, to)) }
            }
            "/api/volume" -> {
                if (b.has("mute")) return command(c, "mute") { Phone.Command(seq = 0, op = "mute", muted = b.optBoolean("mute")) }
                val v = b.optDouble("value", 0.0)
                val now = PhonePlayerService.current?.offlineState()?.volume ?: 50
                val to = if (b.optString("how") == "relative" || b.optString("how") == "relative_step") now + v else v
                return command(c, "volume") { Phone.Command(seq = 0, op = "volume", value = to.toInt().coerceIn(0, 100)) }
            }
            "/api/zone-settings" -> {
                val st = PhonePlayerService.current?.offlineState()
                val shuffle = if (b.has("shuffle")) b.optBoolean("shuffle") else st?.shuffle ?: false
                val loop = if (b.has("loop")) b.optString("loop") else st?.loop ?: "disabled"
                command(c, "mode") { Phone.Command(seq = 0, op = "mode", shuffle = shuffle, loop = loop) }
                return json(JSONObject().put("ok", true).put("random_album_radio_stands_down", false))
            }
            "/api/play-from-here" -> {
                val n = b.optInt("queue_item_id", 0)
                if (n < 1) return error("queue_item_id is required", 400)
                return command(c, "jump") { Phone.Command(seq = 0, op = "jump", index = n - 1) }
            }
            "/api/download/albums" -> {
                val ids = b.optJSONArray("ids") ?: JSONArray()
                val out = JSONArray()
                for (i in 0 until ids.length()) {
                    val id = ids.optInt(i)
                    val l = DownloadStore.albums(c).firstOrNull { it.first.id == id }?.let { Local(it.first, it.second) }
                    if (l == null) { out.put(JSONObject().put("id", id).put("exists", false)); continue }
                    val j = l.json()
                    out.put(JSONObject().put("id", id).put("exists", true).put("title", l.album.title)
                        .put("artist", l.album.artist).put("year", l.album.year ?: JSONObject.NULL)
                        .put("image_key", j.optString("image_key")).put("art_url", "/api/image/" + j.optString("image_key"))
                        .put("album", j))
                }
                return json(JSONObject().put("albums", out))
            }
        }
        return error(OFFLINE)
    }
}
