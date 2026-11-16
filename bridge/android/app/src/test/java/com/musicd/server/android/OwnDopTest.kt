package com.musicd.server.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer

/** DSD to a player's own DAC as DoP (item 438): the frames as Mandarin's USB driver makes them, as float. */
class OwnDopTest {
    @Test fun ratesAndMultiples() {
        assertEquals(176400, OwnDop.pcmRate(64 * 44100))
        assertEquals(352800, OwnDop.pcmRate(128 * 44100))
        assertEquals(64, OwnDop.multiple(176400))
        assertEquals(128, OwnDop.multiple(352800))
        // The R7's way reaches 44.1 to 384 kHz: DSD64 and DSD128 as DoP, not DSD256 (705.6 kHz).
        assertEquals(listOf(64, 128), OwnDop.multiples(listOf(44100, 88200, 176400, 192000, 352800, 384000)))
        assertEquals(emptyList<Int>(), OwnDop.multiples(listOf(44100, 48000)))
    }

    @Test fun oneSampleAsDoP() {
        // 0x05 over 0xAB 0xCD: 0x05ABCD, positive.
        assertEquals(0x05ABCD / 8388608f, OwnDop.sample(0x05, 0xAB, 0xCD), 0f)
        // 0xFA over 0x00 0x00: 0xFA0000, negative in 24 bits: 0xFA0000 - 2^24.
        assertEquals((0xFA0000 - 0x1000000) / 8388608f, OwnDop.sample(0xFA, 0x00, 0x00), 0f)
    }

    @Test fun framesAsTheUsbDriverMakesThem() {
        // L R L R … a byte each: L0 R0 L1 R1 L2 R2 L3 R3. Frame one: L0 L1 and R0 R1 under 0x05; frame two: L2 L3, R2 R3 under 0xFA.
        val src = ByteBuffer.wrap(byteArrayOf(0x11, 0x21, 0x12, 0x22, 0x13, 0x23, 0x14, 0x24))
        val (out, next) = OwnDop.pack(src, OwnDop.FIRST)
        val want = floatArrayOf(OwnDop.sample(0x05, 0x11, 0x12), OwnDop.sample(0x05, 0x21, 0x22), OwnDop.sample(0xFA, 0x13, 0x14), OwnDop.sample(0xFA, 0x23, 0x24))
        assertArrayEquals(want, out, 0f)
        assertEquals("the marker the next frame takes", OwnDop.FIRST, next)
        assertEquals("the buffer left as it was: the sink spends it", 0, src.position())
    }

    @Test fun theMarkerGoesOnAcrossBuffers() {
        val (_, next) = OwnDop.pack(ByteBuffer.wrap(ByteArray(8)), 0xFA)
        assertEquals(0xFA, next)   // two frames: FA, 05, and FA next
        val (out, _) = OwnDop.pack(ByteBuffer.wrap(ByteArray(12)), OwnDop.FIRST)
        assertEquals("bytes past the last whole eight left", 4, out.size)
    }

    @Test fun everyDoPSampleWholeInFloat() {
        // Float carries 24 bits: every marker and DSD byte pair comes back exactly.
        for (m in listOf(0x05, 0xFA)) for (hi in listOf(0, 0x7F, 0x80, 0xFF)) for (lo in listOf(0, 1, 0xFE, 0xFF)) {
            val f = OwnDop.sample(m, hi, lo)
            val back = Math.round(f * 8388608f) and 0xFFFFFF
            assertEquals((m shl 16) or (hi shl 8) or lo, back)
        }
    }
}
