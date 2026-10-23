package com.musicd.server.android

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.musicd.server.client.SoloistPcm
import com.musicd.server.client.SoloistPcm.le32
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.EOFException
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket

/**
 * Soloist on the phone's sound (bug list item 148, [SoloistPhone]): what Soloist plays, from Spotifast's PulseAudio
 * stand-in (android/soloist/shim) over 127.0.0.1, played through the phone's own audio as 32-bit float, untouched.
 *
 * The stand-in's messages (core SoloistPcm): FORMAT (pa_sample_format, rate, channels, stream id), PCM, FLUSH, CORK
 * (1 paused), VOLUME (65536 is 100 %), CLOSE; this side answers each FORMAT and each block played with an ACK (bytes
 * taken, µs still held, stream id), so the phone's own output clock sets Soloist's pace. And whether it's lossless, from
 * the samples (SoloistPcm.Proof, as the server's SoloistProof.cs).
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
    private val proof = SoloistPcm.Proof()
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
                    SoloistPcm.FORMAT -> {
                        fmt = le32(buf, 0); rate = le32(buf, 4); ch = le32(buf, 8); id = le32(buf, 12)
                        track?.release()
                        track = open(rate, ch)
                        taken = 0; written = 0; streams++
                        format = "${SoloistPcm.NAMES[fmt] ?: "format $fmt"} · $rate Hz · $ch ch"
                        SoloistPhone.note("sound: stream $id: $format")
                        ack(out, 0, 0, id)
                    }
                    SoloistPcm.PCM -> {
                        val t = track ?: continue
                        val f = SoloistPcm.floats(buf, len, fmt)
                        proof.see(buf, len, fmt)
                        t.write(f, 0, f.size, AudioTrack.WRITE_BLOCKING)
                        taken += len; written += f.size / ch; bytes += len; frames += f.size / ch
                        underruns = t.underrunCount
                        val held = ((written - t.playbackHeadPosition).coerceAtLeast(0) * 1_000_000 / rate)
                        ack(out, taken, held, id)
                    }
                    SoloistPcm.FLUSH -> track?.let { it.pause(); it.flush(); written = 0; if (!corked) it.play() }
                    SoloistPcm.CORK -> { corked = buf[0].toInt() == 1; track?.let { if (corked) it.pause() else it.play() } }
                    SoloistPcm.VOLUME -> { volume = (le32(buf, 0).toLong() * 100 / 65536).toInt(); track?.setVolume((volume / 100f).coerceIn(0f, 1f)) }
                    SoloistPcm.CLOSE -> { SoloistPhone.note("sound: stream $id closed"); break }
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

    private fun ack(out: OutputStream, taken: Long, heldUs: Long, id: Int) { out.write(SoloistPcm.ack(taken, heldUs, id)); out.flush() }
}
