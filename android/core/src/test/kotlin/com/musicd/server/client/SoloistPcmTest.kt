package com.musicd.server.client

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class SoloistPcmTest {
    private fun float32(vararg x: Float) = ByteBuffer.allocate(x.size * 4).order(ByteOrder.LITTLE_ENDIAN).apply { x.forEach { putFloat(it) } }.array()
    private fun s32(vararg x: Int) = ByteBuffer.allocate(x.size * 4).order(ByteOrder.LITTLE_ENDIAN).apply { x.forEach { putInt(it) } }.array()

    /** Half a second and a little more of stereo, each sample [f] of its index. */
    private fun heard(proof: SoloistPcm.Proof, f: (Int) -> Float) {
        val n = 50_000
        val b = float32(*FloatArray(n) { f(it) })
        proof.see(b, b.size, 5)
    }

    @Test fun `lossless proven from the samples, 24-bit FLAC on the 24-bit grid, 16-bit on the 16-bit grid, Vorbis anywhere`() {
        val p24 = SoloistPcm.Proof()
        heard(p24) { ((it % 4000) - 2000 + 1) / 8388608f * 37 }
        assertEquals("lossless 24-bit", p24.says())
        val p16 = SoloistPcm.Proof()
        heard(p16) { ((it % 4000) - 2000 + 1) / 32768f }
        assertEquals("lossless 16-bit", p16.says())
        val lossy = SoloistPcm.Proof()
        heard(lossy) { (Math.sin(it * 0.0123) * 0.4).toFloat() }
        assertEquals("lossy", lossy.says())
        val short = SoloistPcm.Proof()
        val b = float32(*FloatArray(1000) { (it + 1) / 32768f })
        short.see(b, b.size, 5)
        assertEquals("not heard enough yet", "", short.says())
        val silence = SoloistPcm.Proof()
        heard(silence) { 0f }
        assertEquals("silence proves nothing", "", silence.says())
    }

    @Test fun `32-bit integers read by their low bytes, as the server reads its pipe`() {
        val p = SoloistPcm.Proof()
        val b = s32(*IntArray(50_000) { ((it % 300) + 1) shl 8 })
        p.see(b, b.size, 7)
        assertEquals("lossless 24-bit", p.says())
        val off = s32(*IntArray(10) { 0x12345 })
        p.see(off, off.size, 7)
        assertEquals("one off the grid: lossy", "lossy", p.says())
        val p2 = SoloistPcm.Proof()
        p2.see(ByteArray(8), 8, 3)
        assertEquals("can't tell from S16LE", p2.says())
    }

    @Test fun `blocks as floats, whatever the format`() {
        assertArrayEquals(floatArrayOf(0.5f, -0.25f), SoloistPcm.floats(float32(0.5f, -0.25f), 8, 5), 0f)
        val s16 = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putShort(16384).putShort(-32768).array()
        assertArrayEquals(floatArrayOf(0.5f, -1f), SoloistPcm.floats(s16, 4, 3), 0f)
        assertArrayEquals(floatArrayOf(-0.5f), SoloistPcm.floats(s32(Int.MIN_VALUE / 2), 4, 7), 0f)
        assertArrayEquals(floatArrayOf(-0.5f), SoloistPcm.floats(s32(0xC00000), 4, 11), 0f)
        assertArrayEquals(floatArrayOf(0.5f), SoloistPcm.floats(byteArrayOf(0, 0, 0x40), 3, 9), 0f)
        assertEquals(0, SoloistPcm.floats(ByteArray(4), 4, 1).size)
    }

    @Test fun `an acknowledgement as the stand-in reads it`() {
        val a = ByteBuffer.wrap(SoloistPcm.ack(123_456_789_012L, 250_000, 7)).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(6, a.get().toInt()); assertEquals(16, a.getInt()); assertEquals(123_456_789_012L, a.getLong())
        assertEquals(250_000, a.getInt()); assertEquals(7, a.getInt())
        assertEquals(0x04030201, SoloistPcm.le32(byteArrayOf(1, 2, 3, 4), 0))
    }
}
