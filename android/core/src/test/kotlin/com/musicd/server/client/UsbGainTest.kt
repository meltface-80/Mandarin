package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The USB sink's software gain (UsbGain, the app's UsbDriver.softwareGain; Mandarin Bridge for Android plays through
 * it too): the slider's curve on a DAC with no volume of its own, nothing where the DAC has its own, the volume is
 * fixed or it plays DSD, and nothing on a track sent untouched to a DAC that decodes MQA (item 418), at any level
 * (silent only when muted).
 */
class UsbGainTest {
    @Test
    fun the_slider_scales_a_DAC_without_its_own_volume() {
        assertEquals(0.125f, UsbGain.software(volumeControl = false, dsd = false, fixed = false, muted = false, level = 50), 1e-6f)
        assertEquals(0f, UsbGain.software(volumeControl = false, dsd = false, fixed = false, muted = true, level = 50), 0f)
        assertEquals(1f, UsbGain.software(volumeControl = true, dsd = false, fixed = false, muted = false, level = 50), 0f)
        assertEquals(1f, UsbGain.software(volumeControl = false, dsd = false, fixed = true, muted = false, level = 50), 0f)
        assertEquals(1f, UsbGain.software(volumeControl = false, dsd = true, fixed = false, muted = false, level = 50), 0f)
    }

    @Test
    fun an_MQA_track_sent_untouched_is_never_scaled_only_silenced() {
        for (level in listOf(0, 10, 50, 99)) assertEquals(1f, UsbGain.software(volumeControl = false, dsd = false, fixed = false, muted = false, level = level, untouched = true), 0f)
        assertEquals("muted, it is silent", 0f, UsbGain.software(volumeControl = false, dsd = false, fixed = false, muted = true, level = 50, untouched = true), 0f)
    }
}
