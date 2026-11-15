package com.musicd.server.client

import org.json.JSONObject

/**
 * MQA (bug list item 418): what a track's or album's signalling says, as the server found it in its samples
 * (`mqa: { studio, original_rate, bits }`, `untouched` on Now playing where the room sends it untouched to a DAC that
 * decodes MQA), and the words for it, the page's too (public/app/mqa.js). Mandarin decodes no MQA itself.
 */
data class Mqa(val studio: Boolean, val originalRate: Int, val bits: Int, val untouched: Boolean = false) {
    /** "MQA · 24/352.8 original", "MQA Studio · 24/192 original"; the name alone where no rate was read. */
    val label: String get() = (if (studio) "MQA Studio" else "MQA") + (if (originalRate > 0) " · " + (if (bits > 0) "$bits/" else "") + khz(originalRate) + " original" else "")

    companion object {
        /** Now playing's line where the room sends the track untouched to its MQA DAC. */
        const val UNTOUCHED = "MQA: sent untouched to the DAC"

        /** The server's `mqa`, or null where there is none. */
        fun parse(j: JSONObject?): Mqa? = j?.let { Mqa(it.optBoolean("studio"), it.optInt("original_rate", 0), it.optInt("bits", 0), it.optBoolean("untouched")) }

        /** "352.8" from 352800, "192" from 192000. */
        fun khz(hz: Int): String { val tenths = Math.round(hz / 100.0); return if (tenths % 10 == 0L) "${tenths / 10}" else "${tenths / 10}.${tenths % 10}" }

        /** Audio Devices' This DAC decodes MQA, its note on or off. */
        fun dacNote(on: Boolean): String = if (on) "An MQA track goes to this DAC untouched, for it to decode: no upsampling, DSD, DSP, ReplayGain or dither, and Mandarin’s volume fixed at 100% for it. Set the level on the DAC or amplifier. Other tracks are played as set above."
            else "Off, an MQA track plays as the PCM it is, undecoded, with this device’s processing as set above. Turn on for a DAC that decodes MQA itself."

        /** The change the switch makes: PATCH {output: {mqa_dac}}. */
        fun dacPatch(on: Boolean): JSONObject = JSONObject().put("output", JSONObject().put("mqa_dac", on))
    }
}
