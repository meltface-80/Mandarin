package com.musicd.server.client

import org.json.JSONObject
import java.util.Locale

/**
 * Upload bandwidth (item 479): the home's upload speed as its internet provider gives it, and the share of it the
 * upload to iBroadcast may use (GET /api/settings/ibroadcast's upload_speed), as the page says them
 * (settings-ibroadcast-bandwidth.js). [speed]: Mbps, none given (no limit); [percent]: 25, 50, 75 or 100; [limit]: what
 * the upload may send (Mbps); [fastest]: the fastest an upload has sent from here (Mbps), none yet.
 */
data class IBroadcastBandwidth(val speed: Double?, val percent: Int, val limit: Double?, val fastest: Double?) {
    /** What iBroadcast's page says on the row that opens it (ibroadcastBandwidthSaid): "No limit", "Up to 81 Mbps". */
    val said: String get() = if (speed == null || limit == null) "No limit" else "Up to " + IBroadcastBandwidthWords.mbps(limit)
    /** Under the speed (ibroadcastSpeedNote): as the provider gives it, and the fastest an upload has sent. */
    val speedNote: String get() = IBroadcastBandwidthWords.SPEED_NOTE + (fastest?.let { " The fastest an upload has sent from here: " + IBroadcastBandwidthWords.mbps(it) + "." } ?: "")
    /** What the upload may use, and what it leaves (ibroadcastLimitWords). */
    val limitWords: String get() = when {
        speed == null || limit == null -> "No limit: uploads use as much of your upload as they can. Enter your upload speed to set one."
        percent >= 100 -> "Uploads use up to " + IBroadcastBandwidthWords.mbps(limit) + ": all of your upload."
        else -> "Uploads use up to " + IBroadcastBandwidthWords.mbps(limit) + ", leaving " + IBroadcastBandwidthWords.mbps(speed - limit) + " for everything else."
    }
    /** The speed as its box shows it: "108", "2.5"; "" none given. */
    val speedText: String get() = speed?.let { IBroadcastBandwidthWords.number(it) } ?: ""
}

object IBroadcastBandwidthWords {
    /** The shares offered, as (value, label). */
    val SHARES = listOf(SegChoice("25", "25%"), SegChoice("50", "50%"), SegChoice("75", "75%"), SegChoice("100", "100%"))

    /** The state's upload_speed ([j]: GET /api/settings/ibroadcast). */
    fun parse(j: JSONObject?): IBroadcastBandwidth {
        val s = j?.optJSONObject("upload_speed") ?: JSONObject()
        fun num(k: String) = if (s.isNull(k)) null else s.optDouble(k).takeIf { !it.isNaN() && it > 0 }
        return IBroadcastBandwidth(num("speed_mbps"), s.optInt("percent", 100), num("limit_mbps"), num("fastest_mbps"))
    }

    /** A number as the page writes it: whole from 10 up, else to a tenth ("81", "2.5", "0.5"). */
    fun number(n: Double): String = if (n >= 10 || n == Math.floor(n)) Math.round(n).toString() else String.format(Locale.ROOT, "%.1f", n)

    /** A speed in Mbps as the page says it ("81 Mbps"). */
    fun mbps(n: Double): String = number(n) + " Mbps"

    /** A speed in bytes a second as the page says it, in Mbps as internet providers do (ibroadcastMbps): "98 Mbps". */
    fun ofBytes(bytesPerSecond: Double): String = mbps(bytesPerSecond * 8 / 1e6)

    /** What is typed in the speed's box ([text]) as the server takes it: a number, or none (blank: no limit); null where it isn't one. */
    fun typed(text: String): Any? {
        val t = text.trim().replace(',', '.')
        if (t.isEmpty()) return JSONObject.NULL
        return t.toDoubleOrNull()?.takeIf { it > 0 }
    }

    const val SPEED_NOTE = "As your internet provider gives it: your plan's upload, or a speed test's."
    const val INFO = "How much of your home's internet upload the upload to iBroadcast may use. Enter your upload speed as your internet provider gives it, and choose how much of it to use: the upload sends no faster than that, however many files go at once, and the rest is left for everything else (pages, calls, music played away from home). An upload that fills the whole of it slows everything else down. It holds at once, an upload under way included. With no speed, there is no limit."
}
