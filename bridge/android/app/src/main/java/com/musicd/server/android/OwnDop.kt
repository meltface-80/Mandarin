package com.musicd.server.android

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * DSD to a music player's own DAC as DoP (item 438): the DSD Mandarin sends (a DSF or DFF file, as it sends a USB DAC
 * that takes DSD) packed as DoP, the frames Mandarin's USB driver makes for a DAC that takes DSD only that way
 * (UsbAudioSink: sixteen DSD bits a channel under a marker byte, 0x05 and 0xFA in turn), and played through the way the
 * device's own output follows a track's rate (OwnDacWays) at DSD's rate over 16: DSD64 at 176.4 kHz, DSD128 at 352.8.
 * Each 24-bit DoP sample goes as 32-bit float, which carries it whole. Whether the device's DAC takes it as DSD is the
 * device's: a DAC that doesn't hears a quiet signal far above hearing, so it is a switch, off until it is tried
 * (Settings → This device's own DAC). Plain Kotlin but for the sink, so the packing is tested on the JVM (OwnDopTest).
 */
object OwnDop {
    /** The DoP markers, in turn, a frame each. */
    const val FIRST = 0x05
    private const val SECOND = 0xFA

    /** The PCM rate DSD at [dsdHz] rides at as DoP: its rate over 16. */
    fun pcmRate(dsdHz: Int): Int = dsdHz / 16

    /** The DSD multiple (64, 128, 256) a DoP stream at [pcmRate] carries. */
    fun multiple(pcmRate: Int): Int = pcmRate * 16 / 44100

    /** The DSD multiples whose DoP rates the device's own output reaches ([rates]). */
    fun multiples(rates: List<Int>): List<Int> = listOf(64, 128, 256)   // BROKEN ON PURPOSE: only those reached

    /**
     * DSD as the renderer hands it (two channels, a byte each in turn: L R L R …, eight bytes two DoP frames) packed as
     * DoP, [marker] the first frame's; the frames as float, L R in turn, and the marker the next frame takes. Bytes past
     * the last whole eight are left (the renderer's chunks are whole).
     */
    fun pack(src: ByteBuffer, marker: Int): Pair<FloatArray, Int> {
        val p = src.position()
        val n = src.remaining() - src.remaining() % 8
        val out = FloatArray(n / 2)
        var m = marker
        var o = 0
        var i = 0
        while (i < n) {
            for (half in 0 until 2) {
                for (ch in 0 until 2) {
                    val hi = src.get(p + i + ch + half * 4).toInt() and 0xFF
                    val lo = src.get(p + i + ch + half * 4 + 2).toInt() and 0xFF
                    out[o++] = sample(m, hi, lo)
                }
                m = m   // BROKEN ON PURPOSE: the marker must alternate
            }
            i += 8
        }
        return Pair(out, m)
    }

    /** One DoP sample: [marker] over the DSD bits [hi] then [lo], as a signed 24-bit value over 2^23. */
    fun sample(marker: Int, hi: Int, lo: Int): Float {
        var v = (marker shl 16) or (hi shl 8) or lo
        // BROKEN ON PURPOSE: the sign must be kept
        return v / 8388608f
    }

    /** The PCM format a DoP stream at [pcmRate] is played as: stereo float. */
    @OptIn(UnstableApi::class)
    fun format(pcmRate: Int): Format = Format.Builder().setSampleMimeType(MimeTypes.AUDIO_RAW).setPcmEncoding(C.ENCODING_PCM_FLOAT)
        .setSampleRate(pcmRate).setChannelCount(2).build()
}

/**
 * The sink a DSD track meets first (item 438): while [on] (the device's own DAC played, DoP on there, its rate reached),
 * a stereo DSD track is packed as DoP ([OwnDop]) and handed on as float PCM at its rate over 16, which the rest of the
 * Bridge's sinks play as any track to the device's own DAC; anything else is handed on as it is.
 */
@UnstableApi
class OwnDopSink(inner: AudioSink, private val on: (dopRate: Int) -> Boolean) : ForwardingAudioSink(inner) {
    /** The DSD multiple going out as DoP now; 0 while nothing does. */
    @Volatile var multiple = 0
        private set
    private var marker = OwnDop.FIRST
    private var packed: ByteBuffer? = null
    private var packedFrom: ByteBuffer? = null

    private fun dop(f: Format) = DsdRenderer.isDsd(f) && f.channelCount == 2 && on(OwnDop.pcmRate(DsdRenderer.dsdRate(f)))

    override fun supportsFormat(format: Format): Boolean = dop(format) || super.supportsFormat(format)
    override fun getFormatSupport(format: Format): Int = if (dop(format)) AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY else super.getFormatSupport(format)

    override fun configure(inputFormat: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
        packed = null; packedFrom = null; marker = OwnDop.FIRST
        if (dop(inputFormat)) {
            val rate = OwnDop.pcmRate(DsdRenderer.dsdRate(inputFormat))
            super.configure(OwnDop.format(rate), 0, null)
            multiple = OwnDop.multiple(rate)
            return
        }
        multiple = 0
        super.configure(inputFormat, specifiedBufferSize, outputChannels)
    }

    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        if (multiple == 0) return super.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
        // Packed once; handed on until the sink under it has taken it all, then the DSD it came from is spent.
        if (packed == null || packedFrom !== buffer) {
            val (floats, next) = OwnDop.pack(buffer, marker)
            marker = next
            packed = ByteBuffer.allocateDirect(floats.size * 4).order(ByteOrder.nativeOrder()).also { b -> b.asFloatBuffer().put(floats) }
            packedFrom = buffer
        }
        val done = super.handleBuffer(packed!!, presentationTimeUs, encodedAccessUnitCount)
        if (done) { buffer.position(buffer.limit()); packed = null; packedFrom = null }
        return done
    }

    override fun flush() { packed = null; packedFrom = null; marker = OwnDop.FIRST; super.flush() }
    override fun reset() { packed = null; packedFrom = null; multiple = 0; super.reset() }
}
