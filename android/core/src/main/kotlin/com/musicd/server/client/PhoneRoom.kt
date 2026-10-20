package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * This phone as the one room offline (bug list item 107, O1 in old/plan-android-native.md; what the app's
 * OfflineApi answered the page with): its zone and output as the server shapes them, what it plays and its queue, and
 * the play and transport requests sent to its player. The library it plays from is the phone's ([PhoneShelf]).
 */

/** A track on the phone's player: its album (a download's id, or the phone's own album's [albumKey]) and what it is. */
data class DeckItem(val trackId: Long?, val albumId: Int, val title: String, val artist: String, val album: String,
                    val imageKey: String?, val duration: Double, val albumKey: String? = null)

/** The phone's player as it is: [format] its track's (for the badge), [dsp] at work, [usb] the DAC's "rate/bits" through the USB driver. */
data class DeckState(val state: String, val index: Int, val position: Double, val duration: Double, val shuffle: Boolean, val loop: String,
                     val volume: Int, val muted: Boolean, val items: List<DeckItem>, val revision: Long,
                     val format: String? = null, val dsp: Boolean = false, val usb: String? = null)

/** The phone's player, as the answers drive it. */
interface Deck {
    /** Started if it wasn't (it may take a moment): false when it didn't start. */
    fun ready(): Boolean
    /** What it plays now; null before it has started. */
    fun state(): DeckState?
    /** Its revision, bumped at each change. */
    fun revision(): Long
    /** Held until the revision moves past [since], or [ms] pass. */
    fun waitForChange(since: Long, ms: Long)
    /** Downloads [albumIds] played ([kind] play_now, queue, add_next) from track [start], or only track [only]: false when none is on the phone. */
    fun play(albumIds: List<Int>, start: Int, kind: String, only: Int?): Boolean
    /** A transport command, as the server's phone commands are. */
    fun command(c: Phone.Command)
}

/** The phone as the room [zoneId], playing through [deck] from the phone's [shelf]. */
class PhoneRoom(private val zoneId: String, private val deck: Deck, private val shelf: () -> PhoneShelf) {

    /** The answer to GET [path], or null when it isn't the room's. */
    fun get(path: String, q: Map<String, String>): Answer? = when (path) {
        "/api/zones" -> {
            val st = deck.state()
            Answer.ok(JSONObject().put("away", true).put("zones", JSONArray().put(JSONObject().put("zone_id", zoneId).put("display_name", NAME)
                .put("state", st?.state ?: "stopped").put("settings", settings(st)).put("outputs", JSONArray().put(output(st))).put("is_phone", true))))
        }
        "/api/shortcut/zones" -> Answer.ok(JSONObject().put("zones", JSONArray().put(JSONObject().put("zone_id", zoneId).put("display_name", NAME)
            .put("state", deck.state()?.state ?: "stopped").put("is_phone", true))).put("last_zone", zoneId))
        "/api/outputs" -> Answer.ok(JSONObject().put("outputs", JSONArray()))
        "/api/zone-state" -> {
            val ready = deck.ready()
            // Held briefly: a long hold would keep the asker's thread from everything else.
            q["wait_for"]?.toLongOrNull()?.let { if (ready) deck.waitForChange(it, (q["timeout"]?.toLongOrNull() ?: 1500L).coerceIn(0, 1500)) }
            val st = deck.state()
            Answer.ok(JSONObject().put("revision", st?.revision ?: deck.revision()).put("zone", zone(st)))
        }
        "/api/queue" -> Answer.ok(queue(deck.state()))
        "/api/album/now-playing" -> {
            val cur = deck.state()?.let { it.items.getOrNull(it.index) }
            val s = shelf()
            val album = cur?.albumKey?.let { k -> s.phoneAlbum(k)?.let { PhoneShelf.phoneJson(it) } }
                ?: cur?.let { s.download(it.albumId) }?.let { PhoneShelf.json(it) }
            Answer.ok(JSONObject().put("album", album ?: JSONObject.NULL))
        }
        "/api/shortcut/play-random" -> playRandom()
        else -> null
    }

    /** The answer to POST [path] with [b], or null when it isn't the room's. */
    fun post(path: String, b: JSONObject): Answer? = when (path) {
        "/api/play" -> play(listOf(b.optInt("offset", -1)), b.optString("kind", "play_now"))
        "/api/play-track" -> {
            val album = b.optInt("offset", -1)
            val index = if (b.has("track")) b.optInt("track") else b.optInt("track_index")
            val kind = normalise(b.optString("kind", "play_now"))
            if (kind == "play_now") play(listOf(album), "play_now", start = index) else play(listOf(album), kind, only = index)
        }
        "/api/play-multi" -> {
            // The albums once: the items (each with its title and artist) when sent, else the offsets; the app sends both.
            val ids = ArrayList<Int>()
            val items = b.optJSONArray("items")
            if (items != null && items.length() > 0) for (i in 0 until items.length()) ids += items.getJSONObject(i).optInt("offset")
            else b.optJSONArray("offsets")?.let { a -> for (i in 0 until a.length()) ids += a.optInt(i) }
            val s = shelf()
            val on = ids.filter { s.download(it) != null }
            if (on.isEmpty()) Answer.error(404, "None of those albums are on this phone")
            else play(on, b.optString("kind", "play_now")).let { r ->
                if (r.status != 200) r else Answer.ok(JSONObject().put("ok", true).put("queued", on.size).put("failed", ids.size - on.size).put("total", ids.size))
            }
        }
        "/api/play-unheard" -> playRandom()
        "/api/control" -> when (val cmd = b.optString("command")) {
            "playpause" -> command(Phone.Command(seq = 0, op = if (deck.state()?.state == "playing") "pause" else "play"))
            "play", "pause", "stop", "next", "previous" -> command(Phone.Command(seq = 0, op = cmd))
            else -> Answer.error(400, "invalid command")
        }
        "/api/seek" -> {
            val secs = b.optDouble("seconds", 0.0)
            val to = if (b.optString("how") == "relative") (deck.state()?.position ?: 0.0) + secs else secs
            command(Phone.Command(seq = 0, op = "seek", seconds = maxOf(0.0, to)))
        }
        "/api/volume" -> {
            if (b.has("mute")) command(Phone.Command(seq = 0, op = "mute", muted = b.optBoolean("mute")))
            else {
                val v = b.optDouble("value", 0.0)
                val to = if (b.optString("how") == "relative" || b.optString("how") == "relative_step") (deck.state()?.volume ?: 50) + v else v
                command(Phone.Command(seq = 0, op = "volume", value = to.toInt().coerceIn(0, 100)))
            }
        }
        "/api/zone-settings" -> {
            val st = deck.state()
            val shuffle = if (b.has("shuffle")) b.optBoolean("shuffle") else st?.shuffle ?: false
            val loop = if (b.has("loop")) b.optString("loop") else st?.loop ?: "disabled"
            command(Phone.Command(seq = 0, op = "mode", shuffle = shuffle, loop = loop))
            Answer.ok(JSONObject().put("ok", true).put("random_album_radio_stands_down", false))
        }
        "/api/play-from-here" -> {
            val n = b.optInt("queue_item_id", 0)
            if (n < 1) Answer.error(400, "queue_item_id is required") else command(Phone.Command(seq = 0, op = "jump", index = n - 1))
        }
        else -> null
    }

    private fun playRandom(): Answer {
        val a = shelf().all().randomOrNull() ?: return Answer.error(404, "Nothing downloaded to play")
        val r = play(listOf(a.id), "play_now")
        return if (r.status == 200) Answer.ok(JSONObject().put("ok", true).put("album", PhoneShelf.json(a))) else r
    }

    private fun play(ids: List<Int>, kind: String?, start: Int = 0, only: Int? = null): Answer {
        if (!deck.ready()) return Answer.error(503, NOT_STARTED)
        if (!deck.play(ids, start, normalise(kind), only)) return Answer.error(404, "That album isn't on this phone")
        if (kind == "shuffle") deck.command(Phone.Command(seq = 0, op = "mode", shuffle = true, loop = deck.state()?.loop ?: "disabled"))
        return Answer.ok(JSONObject().put("ok", true).put("action", kind ?: "play_now"))
    }

    private fun command(c: Phone.Command): Answer {
        if (!deck.ready()) return Answer.error(503, NOT_STARTED)
        deck.command(c)
        return Answer.ok(JSONObject().put("ok", true))
    }

    private fun output(st: DeckState?): JSONObject = JSONObject().put("output_id", zoneId).put("zone_id", zoneId).put("display_name", NAME)
        .put("model", "Phone").put("stereo_pair", false).put("is_muted", st?.muted ?: false)
        .put("volume", JSONObject().put("type", "number").put("min", 0).put("max", 100).put("step", 1)
            .put("value", st?.volume ?: 50).put("soft_limit", 100).put("is_muted", st?.muted ?: false))
        .put("can_group_with_output_ids", JSONArray().put(zoneId)).put("source_controls", JSONArray())

    private fun settings(st: DeckState?) = JSONObject().put("shuffle", st?.shuffle ?: false).put("loop", st?.loop ?: "disabled").put("auto_radio", false)

    private fun zone(st: DeckState?): JSONObject {
        val cur = st?.items?.getOrNull(st.index)
        val np = if (st == null || cur == null) JSONObject.NULL else JSONObject()
            .put("line1", cur.title).put("line2", cur.artist).put("line3", cur.album)
            .put("artists", JSONArray().put(JSONObject().put("name", cur.artist).put("linkable", true)))
            .put("image_key", cur.imageKey ?: (if (cur.albumId >= 0) "al-${cur.albumId}" else JSONObject.NULL))
            .put("length", (if (st.duration > 0) st.duration else cur.duration).toInt())
            .put("seek_position", st.position.toInt())
            .put("track_id", cur.trackId ?: JSONObject.NULL)
            .put("album_offset", if (cur.albumKey != null) "phone:${cur.albumKey}" else if (cur.albumId >= 0) cur.albumId else JSONObject.NULL)
            .put("format", PhoneFormat.badge(st.format, st.dsp, st.usb))
        val count = st?.items?.size ?: 0
        val index = st?.index ?: -1
        val state = st?.state ?: "stopped"
        return JSONObject().put("zone_id", zoneId).put("display_name", NAME).put("state", state)
            .put("is_play_allowed", state != "playing").put("is_pause_allowed", state == "playing" || state == "loading")
            .put("is_next_allowed", index in 0 until count - 1 || (st?.loop ?: "disabled") != "disabled")
            .put("is_previous_allowed", count > 0).put("is_seek_allowed", (st?.duration ?: 0.0) > 0)
            .put("settings", settings(st)).put("outputs", JSONArray().put(output(st))).put("now_playing", np)
    }

    private fun queue(st: DeckState?): JSONObject {
        val items = JSONArray()
        val history = ArrayList<JSONObject>()
        val at = st?.index ?: 0
        st?.items?.forEachIndexed { i, it ->
            val key = it.imageKey ?: if (it.albumId >= 0) "al-${it.albumId}" else null
            if (i >= at) items.put(JSONObject().put("queue_item_id", i + 1).put("title", it.title).put("subtitle", it.artist).put("album", it.album)
                .put("image_key", key ?: JSONObject.NULL).put("length", it.duration.toInt()))
            else history += JSONObject().put("track", it.title).put("artist", it.artist).put("album", it.album).put("image_key", key ?: JSONObject.NULL)
                .put("duration", it.duration.toInt()).put("elapsed", it.duration.toInt()).put("played", true).put("queue_item_id", i + 1)
        }
        return JSONObject().put("items", items).put("history", JSONArray(history.reversed()))
    }

    companion object {
        const val NAME = "This phone"
        const val NOT_STARTED = "The phone's player didn't start"

        /** A play's kind as the phone's player takes it. */
        fun normalise(kind: String?) = when (kind) {
            "queue", "add_to_queue" -> "queue"
            "play_next", "add_next", "next" -> "add_next"
            else -> "play_now"
        }
    }
}
