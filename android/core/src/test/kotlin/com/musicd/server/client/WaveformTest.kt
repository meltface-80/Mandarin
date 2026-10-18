package com.musicd.server.client

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class WaveformTest {
    private fun levels(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    @Test fun `each bar the RMS of the levels it covers, as the page folds them`() {
        // Two bars of two levels each: RMS(0, 255) and RMS(255, 255).
        assertArrayEquals(floatArrayOf((Math.sqrt(255.0 * 255 / 2) / 255).toFloat(), 1f), Waveform.bars(levels(0, 255, 255, 255), 2), 1e-6f)
        assertEquals("a level over 127 is read unsigned", 200 / 255f, Waveform.bars(levels(200), 1)[0], 1e-6f)
    }

    @Test fun `more bars than levels, each still has one, and nothing gives nothing`() {
        assertArrayEquals(floatArrayOf(0f, 0f, 1f, 1f), Waveform.bars(levels(0, 255), 4), 1e-6f)
        assertEquals(0, Waveform.bars(ByteArray(0), 10).size)
        assertEquals(0, Waveform.bars(levels(1, 2), 0).size)
    }
}
