package com.musicd.server.client

import org.json.JSONObject

/*
 * The format badge of what the phone plays by itself (bug list item 107), as the server shapes a room's
 * (lib/server/api-playback.js formatOf, then the app's OfflineApi): the phone's own format names, the DSP at work, and the
 * depth and rate the USB DAC is fed through the app's driver.
 */
object PhoneFormat {
    /** The phone player's format names (PhonePlayerService's FORMAT_*). */
    const val ORIGINAL = "original"
    const val OPUS = "opus"
    const val OPUS24 = "opus24"
    const val LOSSLESS = "lossless"

    /** The badge for [format], with the DSP ([dsp]) and the USB DAC's "rate/bits" or "dsd64"/"dop64" ([usb]): JSON null for none. */
    fun badge(format: String?, dsp: Boolean = false, usb: String? = null): Any {
        val base = base(format, dsp)
        if (usb != null && base is JSONObject) {
            Regex("^(dsd|dop)(\\d+)$").find(usb)?.let { m ->
                return JSONObject().put("kind", base.getString("kind"))
                    .put("text", base.getString("text") + (if (m.groupValues[1] == "dop") " · USB DoP DSD" else " · USB DSD") + m.groupValues[2] + " ✓")
            }
            val parts = usb.split("/")
            if (parts.size == 2) {
                val khz = parts[0].toDouble() / 1000
                return JSONObject().put("kind", base.getString("kind")).put("text", base.getString("text") + " · USB " + parts[1] + "/" +
                    (if (khz == khz.toLong().toDouble()) khz.toLong().toString() else khz.toString()) + (if (dsp) "" else " ✓"))
            }
        }
        return base
    }

    private fun base(f: String?, dsp: Boolean): Any {
        val tag = if (dsp) " · DSP" else ""
        return when (f) {
            null, ORIGINAL -> if (dsp) JSONObject().put("kind", "lossless").put("text", "DSP") else JSONObject.NULL
            OPUS -> JSONObject().put("kind", "opus").put("text", "256kbps$tag")
            OPUS24 -> JSONObject().put("kind", "opus").put("text", "256 · 24/48$tag")
            LOSSLESS -> JSONObject().put("kind", "lossless").put("text", "Lossless$tag")
            else -> JSONObject().put("kind", "lossy").put("text", f + tag)
        }
    }
}
