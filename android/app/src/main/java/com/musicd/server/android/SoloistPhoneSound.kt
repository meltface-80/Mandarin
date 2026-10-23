package com.musicd.server.android

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.EOFException
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The Soloist test build's sound (bug list item 148, [SoloistPhone]): what Soloist plays, from Spotifast's PulseAudio
 * stand-in (android/soloist/shim) over 127.0.0.1, played through the phone's own audio as 32-bit float, untouched.
 *
 * The stand-in's messages, little-endian, each a type byte and a u32 length: 1 FORMAT (pa_sample_format, rate,
 * channels, stream id), 2 PCM, 3 FLUSH, 4 CORK (1 paused), 5 VOLUME (65536 is 100 %), 7 CLOSE; this side answers each
 * FORMAT and each block played with 6 ACK (u64 bytes taken, u32 µs still held, u32 stream id), so the phone's own
 * output clock sets Soloist's pace. And whether it's lossless, from the samples, as the server's SoloistProof.cs says it.
 */
internal class SoloistPhoneSound {
    private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = server.localPort
    @Volatile private var closed = false

    @Volatile var format = ""
    @Volatile var bytes = 0L
    @Volatile var frames = 0L
    @Volatile var streams = 0
    @Volatile var underruns = 0
    @Volatile var volume = 100
    @Volatile var corked = false
    private val proof = Proof()
    val verdict: String get() = proof.says()

    fun start() {
        Thread({
            while (!closed) {
                val s = runCatching { server.accept() }.getOrNull() ?: break
                runCatching { serve(s) }.onFailure { if (it !is EOFException) SoloistPhone.note("sound: ${it.javaClass.simpleName}: ${it.message}") }
                runCatching { s.close() }
            }
        }, "soloist-sound").apply { isDaemon = true; start() }
    }

    fun close() { closed = true; runCatching { server.close() } }

    private fun serve(s: Socket) {
        s.tcpNoDelay = true
        val input = DataInputStream(BufferedInputStream(s.getInputStream(), 64 * 1024))
        val out = s.getOutputStream()
        val head = ByteArray(5)
        var buf = ByteArray(16 * 1024)
        var track: AudioTrack? = null
        var fmt = 0; var rate = 44100; var ch = 2; var id = 0; var taken = 0L; var written = 0L
        SoloistPhone.note("sound: Soloist connected")
        try {
            while (true) {
                input.readFully(head)
                val len = le32(head, 1)
                if (len > buf.size) buf = ByteArray(len)
                input.readFully(buf, 0, len)
                when (head[0].toInt()) {
                    1 -> {
                        fmt = le32(buf, 0); rate = le32(buf, 4); ch = le32(buf, 8); id = le32(buf, 12)
                        track?.release()
                        track = open(rate, ch)
                        taken = 0; written = 0; streams++
                        format = "${NAMES[fmt] ?: "format $fmt"} · $rate Hz · $ch ch"
                        SoloistPhone.note("sound: stream $id: $format")
                        ack(out, 0, 0, id)
                    }
                    2 -> {
                        val t = track ?: continue
                        val f = floats(buf, len, fmt)
                        proof.see(buf, len, fmt)
                        t.write(f, 0, f.size, AudioTrack.WRITE_BLOCKING)
                        taken += len; written += f.size / ch; bytes += len; frames += f.size / ch
                        underruns = t.underrunCount
                        val held = ((written - t.playbackHeadPosition).coerceAtLeast(0) * 1_000_000 / rate)
                        ack(out, taken, held, id)
                    }
                    3 -> track?.let { it.pause(); it.flush(); written = 0; if (!corked) it.play() }
                    4 -> { corked = buf[0].toInt() == 1; track?.let { if (corked) it.pause() else it.play() } }
                    5 -> { volume = (le32(buf, 0).toLong() * 100 / 65536).toInt(); track?.setVolume((volume / 100f).coerceIn(0f, 1f)) }
                    7 -> { SoloistPhone.note("sound: stream $id closed"); break }
                }
            }
        } finally {
            track?.let { t -> runCatching { t.stop() }; Thread { Thread.sleep(1_000); t.release() }.start() }
        }
    }

    private fun open(rate: Int, ch: Int): AudioTrack {
        val mask = if (ch == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
        val min = AudioTrack.getMinBufferSize(rate, mask, AudioFormat.ENCODING_PCM_FLOAT)
        return AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(rate).setChannelMask(mask).build())
            .setBufferSizeInBytes(maxOf(min * 2, rate * ch * 4 / 5))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build().also { it.setVolume((volume / 100f).coerceIn(0f, 1f)); if (!corked) it.play() }
    }

    private fun ack(out: OutputStream, taken: Long, heldUs: Long, id: Int) {
        val b = ByteBuffer.allocate(21).order(ByteOrder.LITTLE_ENDIAN)
        b.put(6).putInt(16).putLong(taken).putInt(heldUs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()).putInt(id)
        out.write(b.array()); out.flush()
    }

    companion object {
        private val NAMES = mapOf(3 to "S16LE", 5 to "FLOAT32LE", 7 to "S32LE", 9 to "S24LE", 11 to "S24_32LE")
        fun le32(b: ByteArray, at: Int) = (b[at].toInt() and 0xff) or ((b[at + 1].toInt() and 0xff) shl 8) or ((b[at + 2].toInt() and 0xff) shl 16) or (b[at + 3].toInt() shl 24)

        /** The block as floats, whatever Soloist asked for. */
        fun floats(b: ByteArray, len: Int, fmt: Int): FloatArray {
            val bb = ByteBuffer.wrap(b, 0, len).order(ByteOrder.LITTLE_ENDIAN)
            return when (fmt) {
                5 -> FloatArray(len / 4).also { bb.asFloatBuffer().get(it) }
                3 -> FloatArray(len / 2) { bb.getShort(it * 2) / 32768f }
                7 -> FloatArray(len / 4) { bb.getInt(it * 4) / 2147483648f }
                11 -> FloatArray(len / 4) { ((bb.getInt(it * 4) shl 8) shr 8) / 8388608f }
                9 -> FloatArray(len / 3) { val i = it * 3; (((b[i].toInt() and 0xff) or ((b[i + 1].toInt() and 0xff) shl 8) or (b[i + 2].toInt() shl 16))) / 8388608f }
                else -> FloatArray(0)
            }
        }
    }

    /**
     * Lossless or not, from the samples (as the server's SoloistProof.cs): Spotify's lossless is 16- or 24-bit FLAC, so
     * every sample of it sits on the 24-bit grid; decoded Ogg Vorbis lands anywhere. Half a second on the grid proves it.
     */
    class Proof {
        private var exact = 0L
        private var any24 = false
        private var said = ""
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
