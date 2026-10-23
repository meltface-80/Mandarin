package com.musicd.server.client

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Soloist on the phone (bug list item 148): the sound as Spotifast's PulseAudio stand-in hands it over, read without
 * Android. Its messages are a type byte and a u32 length, little-endian; FORMAT names one of PulseAudio's sample formats.
 * [floats] turns a block into what the phone's audio plays; [Proof] says from the samples whether it is lossless.
 */
object SoloistPcm {
    const val FORMAT = 1
    const val PCM = 2
    const val FLUSH = 3
    const val CORK = 4
    const val VOLUME = 5
    const val ACK = 6
    const val CLOSE = 7

    /** PulseAudio's names for the formats read here. */
    val NAMES = mapOf(3 to "S16LE", 5 to "FLOAT32LE", 7 to "S32LE", 9 to "S24LE", 11 to "S24_32LE")

    fun le32(b: ByteArray, at: Int) = (b[at].toInt() and 0xff) or ((b[at + 1].toInt() and 0xff) shl 8) or
        ((b[at + 2].toInt() and 0xff) shl 16) or (b[at + 3].toInt() shl 24)

    /** An ACK: [taken] bytes since FORMAT, [heldUs] still to be heard, for stream [id]. */
    fun ack(taken: Long, heldUs: Long, id: Int): ByteArray = ByteBuffer.allocate(21).order(ByteOrder.LITTLE_ENDIAN)
        .put(ACK.toByte()).putInt(16).putLong(taken).putInt(heldUs.coerceIn(0, Int.MAX_VALUE.toLong()).toInt()).putInt(id).array()

    /** The block as floats, whatever format Soloist asked for (empty for one not read here). */
    fun floats(b: ByteArray, len: Int, fmt: Int): FloatArray {
        val bb = ByteBuffer.wrap(b, 0, len).order(ByteOrder.LITTLE_ENDIAN)
        return when (fmt) {
            5 -> FloatArray(len / 4).also { bb.asFloatBuffer().get(it) }
            3 -> FloatArray(len / 2) { bb.getShort(it * 2) / 32768f }
            7 -> FloatArray(len / 4) { bb.getInt(it * 4) / 2147483648f }
            11 -> FloatArray(len / 4) { ((bb.getInt(it * 4) shl 8) shr 8) / 8388608f }
            9 -> FloatArray(len / 3) { val i = it * 3; ((b[i].toInt() and 0xff) or ((b[i + 1].toInt() and 0xff) shl 8) or (b[i + 2].toInt() shl 16)) / 8388608f }
            else -> FloatArray(0)
        }
    }

    /**
     * Lossless or not, from the samples (as the server's SoloistProof.cs): Spotify's lossless is 16- or 24-bit FLAC, so
     * every sample of it sits on the 24-bit grid; decoded Ogg Vorbis lands anywhere. Half a second (44,100 samples) on
     * the grid proves it; one off it, lossy. Silence proves nothing.
     */
    class Proof {
        private var exact = 0L
        private var any24 = false
        private var said = ""

        /** "lossless 24-bit", "lossless 16-bit", "lossy", "can't tell from …", or "" before enough is heard. */
        @Synchronized fun says() = said

        @Synchronized fun see(b: ByteArray, len: Int, fmt: Int) {
            val bb = ByteBuffer.wrap(b, 0, len).order(ByteOrder.LITTLE_ENDIAN)
            when (fmt) {
                5 -> for (i in 0 until len / 4) {
                    val x = bb.getFloat(i * 4)
                    if (x == 0f) continue
                    val s = x * 8388608f
                    if (s != Math.floor(s.toDouble()).toFloat()) { off(); continue }
                    val h = x * 32768f
                    on(h != Math.floor(h.toDouble()).toFloat())
                }
                7 -> for (i in 0 until len / 4) {
                    val v = bb.getInt(i * 4)
                    if (v == 0) continue
                    if (v and 0xff != 0) { off(); continue }
                    on(v and 0xffff != 0)
                }
                else -> said = "can't tell from ${NAMES[fmt] ?: "format $fmt"}"
            }
        }

        private fun off() { exact = 0; any24 = false; said = "lossy" }
        private fun on(below16: Boolean) {
            if (below16) any24 = true
            exact++
            if (exact >= 44_100) said = if (any24 || said == "lossless 24-bit") "lossless 24-bit" else "lossless 16-bit"
        }
    }
}
