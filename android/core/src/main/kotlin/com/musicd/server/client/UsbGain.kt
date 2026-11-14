package com.musicd.server.client

/**
 * The gain the USB sink puts on PCM (the app's UsbDriver.softwareGain: Mandarin's own USB direct, and Mandarin Bridge
 * for Android, which plays through the same driver). 1 is bit-perfect: nothing touched. A DAC with its own volume
 * control, fixed volume, and DSD are never scaled; nor, since item 418, a track Mandarin sends untouched to a DAC that
 * decodes MQA ([untouched]: its request said X-Mandarin-Untouched), whose signalling a gain would break: it plays at
 * 100% whatever the slider says, and is only ever silenced (muted). Otherwise the slider's loudness curve,
 * (level/100)³, and 0 muted.
 */
object UsbGain {
    fun software(volumeControl: Boolean, dsd: Boolean, fixed: Boolean, muted: Boolean, level: Int, untouched: Boolean = false): Float {
        if (volumeControl || dsd || fixed) return 1f
        if (muted) return 0f
        if (untouched) return 1f
        val l = level / 100.0
        return (l * l * l).toFloat()
    }
}
