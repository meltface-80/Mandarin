package com.musicd.server.client

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * The few calls the native parts of the app make. Everything a person sees in
 * the main window is the server's own page in a WebView; this is only for the
 * lock screen, the notification, the widget and the Quick Settings tile, which
 * have no page to ask.
 *
 * Plain HttpURLConnection, no library: seven GETs and POSTs of small JSON.
 */
class ServerClient(
    val address: ServerAddress,
    private val timeoutMs: Int = 6000,
    /** This phone's sign-in (see [Account]); sent with every request. */
    val token: String? = null
) {

    /** The server is busy with something else; ask again in a moment. */
    class Busy : IOException("busy")

    class ServerException(val status: Int, message: String) : IOException(message) {
        /** Signed out: the account was reset, or this phone was signed out in Settings. */
        val signedOut get() = status == 401
    }

    fun health(): Health = Health.parse(getJson("/api/health"))

    fun zones(): Zones = Zones.parse(getJson("/api/shortcut/zones"))

    /** The rooms, as the page's Play on list has them. */
    fun rooms(): List<Room> = Room.list(getJson("/api/zones"))

    /**
     * The zone's state. With [waitFor] the server holds the request until
     * something changes (or ~20 s pass), which is how the notification follows
     * the speaker without polling.
     */
    fun zoneState(zoneId: String, waitFor: Long? = null): ZoneState {
        val q = StringBuilder("/api/zone-state?zone=").append(enc(zoneId))
        var timeout = timeoutMs
        if (waitFor != null) {
            q.append("&wait_for=").append(waitFor).append("&timeout=20000")
            timeout = 30_000
        }
        return ZoneState.parse(getJson(q.toString(), timeout))
    }

    fun control(zoneId: String, command: String) {
        post("/api/control", JSONObject().put("zone_or_output_id", zoneId).put("command", command))
    }

    /** The room's track moved to [seconds] from its start. */
    fun seek(zoneId: String, seconds: Double) {
        post("/api/seek", JSONObject().put("zone_or_output_id", zoneId).put("how", "absolute").put("seconds", seconds))
    }

    /** Shuffle and repeat ([loop]: disabled, loop, loop_one), as the page's buttons set them; null leaves one as it is. */
    fun zoneSettings(zoneId: String, shuffle: Boolean? = null, loop: String? = null) {
        val b = JSONObject().put("zone_or_output_id", zoneId)
        if (shuffle != null) b.put("shuffle", shuffle)
        if (loop != null) b.put("loop", loop)
        post("/api/zone-settings", b)
    }

    /** The room's volume to [value] on its own scale, as the page's slider sets it. */
    fun zoneVolume(zoneId: String, value: Double) {
        post("/api/volume", JSONObject().put("zone_or_output_id", zoneId).put("value", value))
    }

    /** A nudge up (1) or down (-1), for a speaker with no scale. */
    fun zoneVolumeStep(zoneId: String, direction: Int) {
        post("/api/volume", JSONObject().put("zone_or_output_id", zoneId).put("relative", if (direction > 0) 1 else -1))
    }

    /** Whether the server draws waveforms (Settings), as the page asks before it does. */
    fun waveformOn(): Boolean = getJson("/api/settings/waveform").optBoolean("enabled", false)

    /**
     * The track's stored levels (see [Waveform]), found by its title, album,
     * artist and length as the page finds it; null when there are none (a
     * stream the server can't match, a file it can't read); [Busy] when the
     * server is drawing another track's and wants asking again.
     */
    fun waveform(track: String, album: String, artist: String, lengthSeconds: Double?): ByteArray? {
        val j = getJson("/api/waveform?track=" + enc(track) + "&album=" + enc(album) + "&artist=" + enc(artist) + "&length=" + (lengthSeconds ?: 0.0).toLong(), 30_000)
        if (j.optString("reason", "") == "busy") throw Busy()
        val peaks = j.optString("peaks", "").takeIf { it.isNotEmpty() && !j.isNull("peaks") } ?: return null
        return java.util.Base64.getDecoder().decode(peaks)
    }

    /** The room's queue (see [QueueView]). */
    fun queue(zoneId: String): QueueView = QueueView.parse(getJson("/api/queue?zone=" + enc(zoneId)))

    /** The room plays on from the queue's track [queueItemId]. */
    fun playFromHere(zoneId: String, queueItemId: Long) {
        post("/api/play-from-here", JSONObject().put("zone_or_output_id", zoneId).put("queue_item_id", queueItemId))
    }

    /** The picked tracks, in the order picked: played now or next ([kind] play_now, play_next), or removed (remove). */
    fun queueAct(zoneId: String, kind: String, queueItemIds: List<Long>) {
        val ids = org.json.JSONArray().also { a -> queueItemIds.forEach { a.put(it) } }
        post(if (kind == "remove") "/api/queue/remove" else "/api/queue/move", JSONObject().put("zone_or_output_id", zoneId).put("queue_item_ids", ids).put("kind", kind))
    }

    /** The room's queue emptied; it stops. */
    fun queueClear(zoneId: String) { post("/api/queue/clear", JSONObject().put("zone_or_output_id", zoneId)) }

    /** A played track put back, next ([kind] play_next) or at the end (queue); several in the order picked. The server's answer. */
    fun queuePlayed(zoneId: String, kind: String, tracks: List<Played>): JSONObject {
        if (tracks.size == 1 && kind == "play_next") {
            val t = tracks[0]
            return post("/api/queue/play-history-next", JSONObject().put("zone_or_output_id", zoneId).put("track", t.track).put("artist", t.artist).put("album", t.album))
        }
        val list = org.json.JSONArray().also { a -> tracks.forEach { t -> a.put(JSONObject().put("track", t.track).put("artist", t.artist).put("album", t.album)) } }
        return post("/api/queue/history-multi", JSONObject().put("zone_or_output_id", zoneId).put("kind", kind).put("tracks", list))
    }

    /** An album to the room ([kind]: play_now, queue, play_next, shuffle, radio), its title and artist with it so a stale offset is found again, as the page sends it. The server's answer. */
    fun playAlbum(offset: Long, title: String, subtitle: String, zoneId: String, kind: String): JSONObject =
        post("/api/play", JSONObject().put("offset", offset).put("title", title).put("subtitle", subtitle).put("zone_or_output_id", zoneId).put("kind", kind)
            .put("filter_type", "").put("filter_value", "").put("filter_parent", ""))

    /** One of an album's tracks (its place, from 0) to the room: play_now, play_next, queue. */
    fun playTrack(offset: Long, index: Int, title: String, albumTitle: String, albumSubtitle: String, zoneId: String, kind: String): JSONObject =
        post("/api/play-track", JSONObject().put("offset", offset).put("track", index).put("title", title).put("zone_or_output_id", zoneId).put("kind", kind)
            .put("album_title", albumTitle).put("album_subtitle", albumSubtitle).put("filter_type", "").put("filter_value", "").put("filter_parent", ""))

    /** The heart on an album, or off. */
    fun favourite(offset: Long, on: Boolean) { post("/api/favourites", JSONObject().put("offset", offset).put("on", on)) }

    /** An album onto Listen later, or off it. */
    fun listenLater(offset: Long, on: Boolean) { listenLater(listOf(offset), on) }

    /** Albums onto Listen later, or off it (item 52: a selection). */
    fun listenLater(offsets: List<Long>, on: Boolean) { post("/api/listen-later", JSONObject().put("offsets", org.json.JSONArray().also { a -> offsets.forEach { a.put(it) } }).put("on", on)) }

    /**
     * Albums selected on a wall to the room (item 52; the page's invokeAlbumMulti): [kind] play_now, play_next or
     * queue; each album's title and artist with it, so a stale offset is found again. The server's answer: queued,
     * failed, total.
     */
    fun playMulti(albums: List<AlbumSummary>, zoneId: String, kind: String): JSONObject {
        val items = org.json.JSONArray().also { a -> albums.forEach { al -> a.put(JSONObject().put("offset", al.offset).put("title", al.title).put("subtitle", al.subtitle)) } }
        val offsets = org.json.JSONArray().also { a -> albums.forEach { a.put(it.offset) } }
        return post("/api/play-multi", JSONObject().put("offsets", offsets).put("items", items).put("zone_or_output_id", zoneId).put("kind", kind)
            .put("filter_type", "").put("filter_value", "").put("filter_parent", ""))
    }

    /** Every room paused. */
    fun pauseAll() { post("/api/pause-all", JSONObject()) }

    /** Every room muted ([mute]) or unmuted. */
    fun muteAll(mute: Boolean) { post("/api/mute-all", JSONObject().put("how", if (mute) "mute" else "unmute")) }

    fun volumeRelative(outputId: String, delta: Int) {
        post("/api/volume", JSONObject().put("output_id", outputId).put("how", "relative").put("value", delta))
    }

    fun volumeAbsolute(outputId: String, value: Int) {
        post("/api/volume", JSONObject().put("output_id", outputId).put("how", "absolute").put("value", value))
    }

    /** A random album in [zoneId] (or the server's own choice of room). Returns the album title. */
    fun playRandom(zoneId: String?): String {
        val path = "/api/shortcut/play-random" + (zoneId?.let { "?zone=" + enc(it) } ?: "")
        val j = getJson(path, 20_000)
        return j.optJSONObject("album")?.optString("title", "") ?: ""
    }

    /** A streamed album added to ([on]) or taken off your favourites on its service ("qobuz", "tidal"), by its id there; the service's answer. */
    /** The phone's downloaded albums as the server has them now ([ids] the downloads' ids, the server's album ids): each with its album, or none when it has gone. */
    fun downloadAlbums(ids: List<Int>): List<DownloadedAlbum> =
        DownloadedAlbum.list(post("/api/download/albums", JSONObject().put("ids", org.json.JSONArray().also { a -> ids.forEach { a.put(it) } })))

    /** Never this artist again in Smart Picks (the page's "Not for me"). */
    fun blockSmartPick(artist: String) { post("/api/smart-picks/block", JSONObject().put("artist", artist)) }

    /** A Dynamic Playlist deleted (item 66), for good. */
    fun deleteSmartPlaylist(id: String) { post("/api/smart-playlists/delete", JSONObject().put("id", id)) }

    /** Every output with its room, what it may join and its power controls (item 68: Group zones, Device power). */
    fun outputs(): List<Speaker> = Speaker.list(getJson("/api/outputs"))
    /** Outputs split off their groups, then a group made, the first output's queue kept (Roon's group_outputs). */
    fun ungroupOutputs(ids: List<String>) { post("/api/ungroup-outputs", JSONObject().put("output_ids", org.json.JSONArray(ids))) }
    fun groupOutputs(ids: List<String>) { post("/api/group-outputs", JSONObject().put("output_ids", org.json.JSONArray(ids))) }
    /** A device's power: one control's standby toggled, or (no [key]) the whole device's; its input chosen. */
    fun standby(outputId: String, key: String?, mode: String) { post("/api/output/standby", JSONObject().put("output_id", outputId).put("mode", mode).also { if (key != null) it.put("control_key", key) }) }
    fun convenienceSwitch(outputId: String, key: String) { post("/api/output/convenience-switch", JSONObject().put("output_id", outputId).put("control_key", key)) }
    /** Whether [zoneId] is playing an album (the room-move question's ask), and what's playing moved from one room to another. */
    fun playingAlbum(zoneId: String): Boolean = RoomMove.playing(getJson("/api/album/now-playing?zone=" + enc(zoneId)))
    fun transferZone(from: String, to: String) { post("/api/transfer-zone", JSONObject().put("from", from).put("to", to)) }

    /** Labels (item 71): a logo saved for one (the address the server kept), labels merged into the first, one taken out again, the scan run again, its log. */
    fun saveLabelLogo(label: String, url: String): String {
        val j = post("/api/labels/logo", JSONObject().put("label", label).put("url", url))
        if (!j.optBoolean("ok")) throw IOException(j.optString("error").ifEmpty { "Failed to save logo" })
        return j.optString("storedUrl").ifEmpty { url }
    }
    fun mergeLabels(items: List<MergedLabel>) { post("/api/labels/merge", JSONObject().put("items", org.json.JSONArray(items.map { JSONObject().put("key", it.key).put("display", it.display) }))) }
    fun unmergeLabel(key: String) { send("DELETE", "/api/labels/merge/" + enc(key)) }
    /** One of the server's backups deleted (item 92). */
    fun deleteBackup(id: String) { send("DELETE", "/api/backup/" + enc(id)) }
    fun rescanLabels() { post("/api/labels/rescan", JSONObject()) }
    fun labelsScanLog(): String = String(bytes(address.baseUrl + "/api/labels-scan-log"), Charsets.UTF_8)

    /**
     * The album editor (item 74): the editor's view of an album; the covers found on the web and the releases
     * MusicBrainz offers (slow: a minute allowed); the corrections saved (the cover downloaded there) or all undone,
     * each answering with the editor's view again; a release applied by its id ([how] "pick"), a barcode or a link.
     */
    fun albumEditState(offset: Long): EditState = EditState.parse(getJson("/api/album/edit?offset=$offset"))
    fun albumArtSearch(offset: Long): ArtSearch = ArtSearch.parse(getJson("/api/album/art-search?offset=$offset", 60000))
    fun releaseCandidates(offset: Long): MatchSearch = MatchSearch.parse(getJson("/api/identify/candidates?offset=$offset", 60000))
    fun saveAlbumEdit(body: JSONObject): EditState = EditState.parse(post("/api/album/edit", body, 60000))
    fun resetAlbumEdit(offset: Long): EditState = EditState.parse(post("/api/album/edit/reset", JSONObject().put("offset", offset)))
    fun matchRelease(offset: Long, query: String, how: String): JSONObject =
        post("/api/identify/match", JSONObject().put("offset", offset).put("query", query).put("how", how), 60000)

    /**
     * Settings (item 76): the server's version; the devices signed in to the account, and one signed out; an API key as
     * the server has it ([route]: "discogs-token", "fanart-key", "lastfm-key"), and a new one saved (checked by its service).
     */
    fun updateStatus(): JSONObject = getJson("/api/update/status")
    fun accountDevices(): AccountDevices = AccountDevices.parse(getJson("/api/auth/devices"))
    fun revokeDevice(id: String) { post("/api/auth/devices/revoke", JSONObject().put("id", id)) }
    fun apiKey(route: String): ApiKey = ApiKey.parse(getJson("/api/settings/$route"))
    fun saveApiKey(route: String, field: String, value: String): ApiKey {
        val j = post("/api/settings/$route", JSONObject().put(field, value), 20_000)
        if (!j.optBoolean("ok")) throw IOException(j.optString("error").ifEmpty { "Failed to save" })
        return ApiKey.parse(j)
    }

    /**
     * Setup's pages (item 78): one of the server's settings as it has it ([name]: "smart-picks", "labels", "display",
     * "shelf", "label-folder-depth"), a change to it saved (its answer), today's picks built again, the labels looked
     * for again.
     */
    fun setting(name: String): JSONObject = getJson("/api/settings/$name")
    fun saveSetting(name: String, body: JSONObject): JSONObject = post("/api/settings/$name", body, 20_000)
    fun rebuildPicks(): JSONObject = post("/api/smart-picks/rebuild", JSONObject())
    fun rescanLabelsNow(): JSONObject = post("/api/labels/rescan-force", JSONObject())
    /** The server's built-in Tailscale (item 80), and [what] done to it ("enable" with {on}, "login", "logout"): its state after. */
    fun tailscale(): AwayState = AwayState.parse(getJson("/api/tailscale"))
    fun tailscaleDo(what: String, body: JSONObject = JSONObject()): AwayState = AwayState.parse(post("/api/tailscale/$what", body, 30_000))

    /** One of your playlists deleted (item 65), for good. */
    fun deletePlaylist(id: String) { post("/api/user-playlists/delete", JSONObject().put("id", id)) }

    /** A service's album made the library's (transient until it is a favourite), to open its page: its offset (item 61, the search's tiles). */
    fun serviceOpen(service: String, albumId: String): Long {
        val j = post("/api/$service/open", JSONObject().put("album_id", albumId))
        if (!j.optBoolean("ok", false) || !j.has("offset")) throw IOException(j.optString("error").ifEmpty { "Couldn't open that album" })
        return j.getLong("offset")
    }

    /** Whether a service's album is one of its favourites now (item 73: a tile's + or ✓, read again after its page closes); null signed out. */
    fun serviceFavouriteNow(service: String, albumId: String): Boolean? = getJson("/api/$service/state?album_id=" + enc(albumId)).let { if (it.optBoolean("connected")) it.optBoolean("favourite") else null }

    fun serviceFavourite(source: String, albumId: String, on: Boolean): JSONObject =
        post("/api/$source/" + (if (on) "favorite" else "unfavorite"), JSONObject().put("album_id", albumId))

    /** A page of an album's booklet, drawn [width] pixels wide (the server keeps a few widths). */
    fun bookletPageUrl(offset: Long, bookletId: String, page: Int, width: Int): String =
        address.baseUrl + "/api/booklet/page?offset=$offset&id=" + enc(bookletId) + "&page=$page&w=$width"

    fun imageUrl(imageKey: String, size: Int): String =
        address.baseUrl + "/api/image/" + enc(imageKey) + "?size=" + size

    fun bytes(url: String): ByteArray {
        val c = open(url, timeoutMs)
        try {
            if (c.responseCode != 200) throw ServerException(c.responseCode, "HTTP ${c.responseCode}")
            return c.inputStream.use { it.readBytes() }
        } finally {
            c.disconnect()
        }
    }

    // ------------------------------------------------------------------ http

    private fun open(url: String, timeout: Int): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = minOf(timeout, 5000)
            readTimeout = timeout
            useCaches = false
            setRequestProperty("Accept", "application/json")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
        }

    fun getJson(path: String, timeout: Int = timeoutMs): JSONObject {
        val c = open(address.baseUrl + path, timeout)
        try {
            return readJson(c)
        } finally {
            c.disconnect()
        }
    }

    fun post(path: String, body: JSONObject, timeout: Int = timeoutMs): JSONObject {
        val c = open(address.baseUrl + path, timeout)
        try {
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            return readJson(c)
        } finally {
            c.disconnect()
        }
    }

    /** A request with no body ([method]: DELETE), its answer. */
    private fun send(method: String, path: String): JSONObject {
        val c = open(address.baseUrl + path, timeoutMs)
        try {
            c.requestMethod = method
            return readJson(c)
        } finally {
            c.disconnect()
        }
    }

    private fun readJson(c: HttpURLConnection): JSONObject {
        val code = c.responseCode
        val stream = if (code >= 400) c.errorStream else c.inputStream
        val text = stream?.use { s ->
            val out = ByteArrayOutputStream()
            s.copyTo(out)
            out.toString("UTF-8")
        } ?: ""
        val j = try { JSONObject(text) } catch (e: Exception) { null }
        if (code >= 400) {
            throw ServerException(code, j?.optString("error")?.takeIf { it.isNotEmpty() } ?: "HTTP $code")
        }
        return j ?: throw ServerException(code, "The server answered with something that isn't JSON")
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
}
