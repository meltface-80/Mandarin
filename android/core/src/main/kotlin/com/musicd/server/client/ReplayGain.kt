package com.musicd.server.client

import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * ReplayGain on the phone (v0.6.0-RC5): the same choice as the server's
 * lib/loudness.js. What the server queues comes with its gain worked out
 * (Phone.Item.gainDb); what the phone plays by itself — its downloads,
 * offline — is worked out here from the numbers in the album's download
 * (album.json's "replaygain") and the setting the server last sent.
 */
object ReplayGain {

    /** Off, track, album or auto, and the pre-amp in dB. */
    class Setting(val mode: String, val preamp: Double) {
        val on: Boolean get() = mode != "off"
        fun toJson(): JSONObject = JSONObject().put("mode", mode).put("preamp", preamp)

        companion object {
            val OFF = Setting("off", 0.0)
            private val MODES = setOf("off", "track", "album", "auto")

            fun parse(o: JSONObject?): Setting {
                if (o == null) return OFF
                val mode = o.optString("mode", "off").takeIf { it in MODES } ?: "off"
                val pre = o.optDouble("preamp", 0.0).let { if (it.isNaN()) 0.0 else max(-12.0, min(12.0, it)) }
                return Setting(mode, pre)
            }
        }
    }

    /** A track's four numbers, as album.json carries them; null where unknown. */
    class Info(val trackGain: Double?, val trackPeak: Double?, val albumGain: Double?, val albumPeak: Double?) {
        companion object {
            private fun num(o: JSONObject, k: String): Double? =
                if (!o.has(k) || o.isNull(k)) null else o.optDouble(k).takeIf { !it.isNaN() }

            fun parse(o: JSONObject?): Info? =
                o?.let { Info(num(it, "track_gain"), num(it, "track_peak"), num(it, "album_gain"), num(it, "album_peak")) }
        }
    }

    /** "track" or "album" for one track under [mode]; Auto: the album's in order beside its own record. */
    fun kindFor(mode: String, shuffled: Boolean, sameAlbumBeside: Boolean): String =
        if (mode == "auto") (if (!shuffled && sameAlbumBeside) "album" else "track") else mode

    /** The gain in dB, capped by the peak so it never clips; null for none. */
    fun gainDb(info: Info?, kind: String, preamp: Double = 0.0): Double? {
        if (info == null) return null
        val album = kind == "album"
        val g0 = if (album) info.albumGain ?: info.trackGain else info.trackGain ?: info.albumGain
        val p = if (album) (if (info.albumGain != null) info.albumPeak else info.trackPeak)
                else (if (info.trackGain != null) info.trackPeak else info.albumPeak)
        if (g0 == null) return null
        var g = g0 + preamp
        if (p != null && p > 0) g = min(g, -20 * log10(p))
        g = max(-24.0, min(12.0, (g * 10).roundToInt() / 10.0))
        return if (abs(g) < 0.05) null else g
    }

    /** dB as a multiplier; 1 for none. */
    fun linear(db: Double?): Double = if (db == null) 1.0 else 10.0.pow(db / 20.0)
}
