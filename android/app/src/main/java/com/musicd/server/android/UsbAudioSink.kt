package com.musicd.server.android

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The audio sink that plays through the app's USB driver (Stage 9.2).
 *
 * Sits under the DSP sink, so what arrives is float: the decoder's samples
 * untouched when the DSP is off (a 16- or 24-bit sample is exact in float),
 * or the DSP's output. With USB direct on and a DAC on the port that takes
 * the track's rate, the stream is opened on the DAC and every buffer is
 * packed to its depth and written to the driver; the position comes from the
 * frames the DAC has taken. Otherwise — switch off, no DAC, a rate it doesn't
 * take, the DAC gone mid-track — the buffers go to Android's track as before.
 */
@UnstableApi
class UsbAudioSink(private val inner: AudioSink, private val context: Context) : ForwardingAudioSink(inner) {

    @Volatile var usb = false
        private set
    private var rate = 0
    private var channels = 0
    private var subslot = 0
    private var startUs = 0L
    private var startSet = false
    private var playedAtStart = 0L
    private var drained = false
    private var out: ByteBuffer = ByteBuffer.allocateDirect(0)
    private var outFor: ByteBuffer? = null
    private var outPos = 0

    private fun wantUsb(f: Format): Boolean =
        Store.usbDirect(context) && UsbDac.device() != null && f.sampleMimeType == MimeTypes.AUDIO_RAW && f.pcmEncoding == C.ENCODING_PCM_FLOAT &&
            f.channelCount == 2 && UsbDriver.streamFor(UsbDac.info(), f.sampleRate) != null

    override fun supportsFormat(format: Format): Boolean = getFormatSupport(format) != AudioSink.SINK_FORMAT_UNSUPPORTED
    override fun getFormatSupport(format: Format): Int =
        if (wantUsb(format)) AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY else inner.getFormatSupport(format)

    override fun configure(inputFormat: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
        if (wantUsb(inputFormat) && UsbDriver.open(context, inputFormat.sampleRate)) {
            usb = true
            rate = inputFormat.sampleRate; channels = inputFormat.channelCount
            subslot = UsbDriver.current?.subslot ?: 3
            startSet = false; drained = false; outFor = null
            // Android's track is left unconfigured: nothing goes to it.
            return
        }
        if (usb) { UsbDriver.close(); usb = false }
        inner.configure(inputFormat, specifiedBufferSize, outputChannels)
    }

    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        if (!usb) return inner.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
        if (UsbDriver.dead() || !UsbDriver.active) throw AudioSink.WriteException(-1, Format.Builder().setSampleRate(rate).build(), true)
        if (!startSet) { startUs = presentationTimeUs; playedAtStart = UsbDriver.played(); startSet = true }
        // The same buffer comes back until it is taken: packed once, written as the ring has room.
        if (outFor !== buffer) { pack(buffer); outFor = buffer; outPos = 0 }
        val n = UsbDriver.write(out, outPos, out.limit() - outPos)
        if (n < 0) throw AudioSink.WriteException(n, Format.Builder().setSampleRate(rate).build(), true)
        outPos += n
        if (outPos >= out.limit()) { buffer.position(buffer.limit()); outFor = null; return true }
        return false
    }

    /** Float samples packed to the DAC's subslot, little-endian, left-justified. */
    private fun pack(buffer: ByteBuffer) {
        val samples = buffer.remaining() / 4
        val need = samples * subslot
        if (out.capacity() < need) out = ByteBuffer.allocateDirect(need).order(ByteOrder.LITTLE_ENDIAN)
        out.clear()
        val src = buffer.duplicate().order(ByteOrder.nativeOrder())
        for (i in 0 until samples) {
            var v = src.getFloat()
            if (v > 1f) v = 1f else if (v < -1f) v = -1f
            when (subslot) {
                2 -> out.putShort(Math.round(v * 32767f).toShort())
                3 -> { val x = Math.round(v * 8388607f); out.put((x and 0xff).toByte()); out.put(((x shr 8) and 0xff).toByte()); out.put(((x shr 16) and 0xff).toByte()) }
                else -> { val x = (v.toDouble() * 2147483647.0).toLong().coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt(); out.putInt(x) }
            }
        }
        out.flip()
    }

    override fun play() { if (usb) UsbDriver.play() else inner.play() }
    override fun pause() { if (usb) UsbDriver.pause() else inner.pause() }
    override fun handleDiscontinuity() { if (usb) startSet = false else inner.handleDiscontinuity() }
    override fun playToEndOfStream() { if (usb) { UsbDriver.drain(); drained = true } else inner.playToEndOfStream() }
    override fun isEnded(): Boolean = if (usb) drained && UsbDriver.pending() == 0L else inner.isEnded()
    override fun hasPendingData(): Boolean = if (usb) UsbDriver.pending() > 0 else inner.hasPendingData()
    override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
        if (!usb) return inner.getCurrentPositionUs(sourceEnded)
        if (!startSet || rate <= 0) return AudioSink.CURRENT_POSITION_NOT_SET
        val played = UsbDriver.played() - playedAtStart
        return startUs + played * 1_000_000L / rate
    }
    override fun setVolume(volume: Float) { if (!usb) inner.setVolume(volume) }
    override fun flush() { if (usb) { UsbDriver.flush(); startSet = false; drained = false; outFor = null } else inner.flush() }
    override fun reset() { if (usb) { UsbDriver.flush(); startSet = false; drained = false; outFor = null } else inner.reset() }
    override fun release() { if (usb) { UsbDriver.close(); usb = false }; inner.release() }
}
