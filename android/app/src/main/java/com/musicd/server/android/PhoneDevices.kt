package com.musicd.server.android

import android.content.Context
import com.musicd.server.client.Answer
import com.musicd.server.client.PhoneAnswers
import org.json.JSONArray
import org.json.JSONObject

/*
 * Settings → Audio Devices offline (bug list item 107, moved from OfflineApi): this phone, the one player there is, as
 * the server shows it — its page, its DSP and (from the app itself) the USB DAC on its port. Before v0.5.55 the list was
 * empty offline.
 */
internal object PhoneDevices {
    /** The answer to [method] on [path] when it is Settings → Audio Devices', else null. */
    fun answer(c: Context, method: String, path: String, b: JSONObject): Answer? = when {
        method == "GET" && path == "/api/audio-devices" -> devices(c)
        method == "GET" && path.startsWith("/api/audio-devices/") -> device(c, path.removePrefix("/api/audio-devices/"))
        method != "GET" && path == "/api/audio-devices/rescan" -> devices(c)
        method != "GET" && path.startsWith("/api/audio-devices/") -> changeDevice(c, path.removePrefix("/api/audio-devices/"), b)
        else -> null
    }

    private val RATES = listOf(44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000)
    private val BITS = listOf(16, 24, 32)
    private val DSD = listOf(64, 128, 256)
    private val NO_DSP get() = JSONObject().put("enabled", false).put("headphone", JSONObject.NULL).put("peq", JSONObject.NULL).put("headroom", "auto")

    private fun dspOf(c: Context): JSONObject = Store.dsp(c)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: NO_DSP

    private fun phoneDevice(c: Context, full: Boolean): JSONObject {
        val st = PhonePlayerService.current?.offlineState()
        val name = PhonePlayerService.phoneName()
        val dsp = dspOf(c)
        val bands = dsp.optJSONObject("peq")?.optJSONArray("bands")?.length() ?: 0
        val o = JSONObject().put("id", Store.phoneZone(c)).put("kind", "phone").put("family", "")
            .put("name", name).put("network_name", name).put("renamed", false)
            .put("manufacturer", "").put("model", "Phone").put("model_number", "").put("firmware", "").put("ip", "")
            .put("online", true).put("state", st?.state ?: "stopped").put("enabled", true).put("can_toggle", false)
            .put("profile", JSONObject().put("id", "phone").put("label", "Phone")).put("editable", false).put("playable", true)
            .put("rates", JSONArray(RATES.map { JSONObject().put("hz", it).put("on", it <= 192000).put("source", if (it <= 192000) "phone" else "off") }))
            .put("bits", JSONArray(BITS.map { JSONObject().put("n", it).put("on", it <= 24).put("source", if (it <= 24) "phone" else "off") }))
            .put("dsd", JSONArray(DSD.map { JSONObject().put("n", it).put("on", false).put("source", "off") }))
            .put("containers", JSONArray(listOf("flac", "mp3", "alac", "aac", "ogg", "opus", "wav")))
            .put("dsp", dsp)
            .put("dsp_info", JSONObject().put("active", dsp.optBoolean("enabled") && (bands > 0 || !dsp.isNull("headphone"))).put("bands", bands))
        if (full) o.put("found_by", "The Mandarin app").put("location", "").put("settings", JSONObject())
            .put("last_error", JSONObject.NULL).put("openhome", false).put("events", JSONObject.NULL)
            .put("volume_fixed", false).put("can_fix_volume", false).put("takes_flac", true)
        return o
    }

    private fun devices(c: Context) =
        Answer.ok(JSONObject().put("away", true).put("offline", true).put("devices", JSONArray().put(phoneDevice(c, false))))

    private fun device(c: Context, rawId: String): Answer {
        val id = java.net.URLDecoder.decode(rawId, "UTF-8")
        return if (id == Store.phoneZone(c)) Answer.ok(phoneDevice(c, true)) else Answer.error(404, "That device is shown when Mandarin can be reached")
    }

    /** This phone's page: its DSP changes here and now (and reaches the server later); the rest waits for the server. */
    private fun changeDevice(c: Context, rawId: String, b: JSONObject): Answer {
        val id = java.net.URLDecoder.decode(rawId, "UTF-8")
        if (id != Store.phoneZone(c)) return Answer.error(404, "That device is shown when Mandarin can be reached")
        val patch = b.optJSONObject("dsp") ?: return Answer.error(503, PhoneAnswers.OFFLINE)
        val next = dspOf(c)
        for (k in listOf("enabled", "headphone", "peq", "headroom")) if (patch.has(k)) next.put(k, patch.get(k))
        if (next.isNull("headroom")) next.put("headroom", "auto")
        val p = PhonePlayerService.current
        if (p != null) p.setDspOffline(next) else { Store.setDsp(c, next.toString()); Store.setDspPending(c, true) }
        return Answer.ok(phoneDevice(c, true))
    }
}
