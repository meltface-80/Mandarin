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
