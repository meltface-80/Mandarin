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
 *
 * DSD (Stage 9.3) arrives from DsdRenderer as 32-bit words of DSD bits, and
 * goes to the DAC natively — its DSD alternate setting, four (or two) bytes
 * of each channel in time order per slot — or as DoP, two bytes of DSD in
 * each 24-bit PCM sample under the alternating 0x05/0xFA marker, at a
 * sixteenth of the DSD rate. A DSD track the DAC can't be given is an error
 * the player sees ([DsdUnplayable]); the service then has the server send
 * it as PCM.
 */
@UnstableApi
class UsbAudioSink(private val inner: AudioSink, private val context: Context) : ForwardingAudioSink(inner) {

    /** A DSD track the DAC can't be given: a ConfigurationException the service recognises by its message. */
    object DsdUnplayable {
        fun make(why: String, f: Format) = AudioSink.ConfigurationException("DSD: $why", f)
        fun matches(t: Throwable) = t is AudioSink.ConfigurationException && t.message?.startsWith("DSD:") == true
    }

    @Volatile var usb = false
        private set
    /**
     * Whether the player is playing. ExoPlayer says play() once, when the
     * renderer starts, not again when the sink is configured for the next
     * track — so a stream opened then must be started here, as Android's own
     * sink restarts its track. Without this the ring filled and nothing played.
     */
    private var playing = false
    private var rate = 0            // the stream's rate on the DAC (frames per second it is fed)
    private var channels = 0
    private var subslot = 0
    private var mode = "pcm"        // pcm, dsd (native, time order), dsd_le (words reversed), dop
    private var dopMarker = 0x05
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
    override fun getFormatSupport(format: Format): Int = when {
        DsdRenderer.isDsd(format) -> if (dsdPlan(format) != null) AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY else AudioSink.SINK_FORMAT_UNSUPPORTED
        wantUsb(format) -> AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY
        else -> inner.getFormatSupport(format)
    }

    /** How this DSD format would go to the DAC: (mode, stream rate), or null when it can't. */
    private fun dsdPlan(f: Format): Pair<String, Int>? {
        if (!Store.usbDirect(context) || UsbDac.device() == null || f.channelCount != 2) return null
        val info = UsbDac.info() ?: return null
        val hz = DsdRenderer.dsdRate(f)
        val setting = Store.usbDsd(context)
        if (setting == "pcm") return null
        if (setting != "dop") {
            val s = UsbDriver.streamFor(info, hz / 32, true)
            if (s != null && s.subslot == 4) return Pair(if (setting == "native_le") "dsd_le" else "dsd", hz / 32)
            val s16 = UsbDriver.streamFor(info, hz / 16, true)
            if (s16 != null && s16.subslot == 2) return Pair(if (setting == "native_le") "dsd_le" else "dsd", hz / 16)
        }
        val p = UsbDriver.streamFor(info, hz / 16)
        if (p != null && p.bits >= 24) return Pair("dop", hz / 16)
        return null
    }

    override fun configure(inputFormat: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
        if (DsdRenderer.isDsd(inputFormat)) {
            val plan = dsdPlan(inputFormat) ?: run {
                if (usb) { UsbDriver.close(); usb = false }
                throw DsdUnplayable.make(if (!Store.usbDirect(context)) "USB direct is off" else if (UsbDac.device() == null) "no DAC on the port" else "the DAC doesn't take DSD${DsdExtractor.multiple(DsdRenderer.dsdRate(inputFormat))}", inputFormat)
            }
            val kind = if (plan.first == "dop") "dop" else "dsd"
            val probe = UsbDriver.streamFor(UsbDac.info(), plan.second, kind == "dsd") ?: throw DsdUnplayable.make("no stream", inputFormat)
            val sil = silence(kind, probe.channels * probe.subslot, probe.subslot)
            if (!UsbDriver.open(context, plan.second, kind, sil)) {
                usb = false
                throw DsdUnplayable.make(UsbDriver.lastError ?: "the stream couldn't be opened", inputFormat)
            }
            usb = true; mode = plan.first; rate = plan.second; channels = 2
            subslot = UsbDriver.current?.subslot ?: 4
            dopMarker = 0x05
            startSet = false; drained = false; outFor = null
            if (playing) UsbDriver.play()
            return
        }
        if (wantUsb(inputFormat) && UsbDriver.open(context, inputFormat.sampleRate)) {
            usb = true; mode = "pcm"
            rate = inputFormat.sampleRate; channels = inputFormat.channelCount
            subslot = UsbDriver.current?.subslot ?: 3
            startSet = false; drained = false; outFor = null
            if (playing) UsbDriver.play()
            // Android's track is left unconfigured: nothing goes to it.
            return
        }
        if (usb) { UsbDriver.close(); usb = false }
        inner.configure(inputFormat, specifiedBufferSize, outputChannels)
    }

    /** What the engine sends with nothing to play: DSD silence (0x69), or DoP frames of it under both markers. */
    private fun silence(kind: String, frameBytes: Int, slot: Int): ByteArray {
        if (kind == "dsd") return ByteArray(frameBytes) { 0x69 }
        val b = ByteArray(frameBytes * 2)
        var k = 0
        for (marker in intArrayOf(0x05, 0xFA)) for (ch in 0 until 2) {
            if (slot == 4) b[k++] = 0
            b[k++] = 0x69; b[k++] = 0x69; b[k++] = marker.toByte()
        }
        return b
    }

    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        if (!usb) return inner.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
        if (UsbDriver.dead() || !UsbDriver.active) throw AudioSink.WriteException(-1, Format.Builder().setSampleRate(rate).build(), true)
        if (!startSet) { startUs = presentationTimeUs; playedAtStart = UsbDriver.played(); startSet = true; if (playing) UsbDriver.play() }
        // The same buffer comes back until it is taken: packed once, written as the ring has room.
        if (outFor !== buffer) { if (mode == "pcm") pack(buffer) else packDsd(buffer); outFor = buffer; outPos = 0 }
        val n = UsbDriver.write(out, outPos, out.limit() - outPos)
        if (n < 0) throw AudioSink.WriteException(n, Format.Builder().setSampleRate(rate).build(), true)
        outPos += n
        if (outPos >= out.limit()) { buffer.position(buffer.limit()); outFor = null; return true }
        return false
    }

    private fun room(need: Int) {
        if (out.capacity() < need) out = ByteBuffer.allocateDirect(need).order(ByteOrder.LITTLE_ENDIAN)
        out.clear()
    }

    /** Float samples packed to the DAC's subslot, little-endian, left-justified. */
    private fun pack(buffer: ByteBuffer) {
        val samples = buffer.remaining() / 4
        room(samples * subslot)
        val src = buffer.duplicate().order(ByteOrder.nativeOrder())
        // 1 (the usual: a DAC with its own volume control, or fixed volume) leaves the samples untouched.
        val gain = UsbDriver.softwareGain()
        for (i in 0 until samples) {
            var v = src.getFloat() * gain
            if (v > 1f) v = 1f else if (v < -1f) v = -1f
            when (subslot) {
                2 -> out.putShort(Math.round(v * 32767f).toShort())
                3 -> { val x = Math.round(v * 8388607f); out.put((x and 0xff).toByte()); out.put(((x shr 8) and 0xff).toByte()); out.put(((x shr 16) and 0xff).toByte()) }
                else -> { val x = (v.toDouble() * 2147483647.0).toLong().coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt(); out.putInt(x) }
            }
        }
        out.flip()
    }

    /**
     * DSD from the renderer — the channels' bytes interleaved, each byte's
     * MSB the oldest bit — packed for the DAC:
     *   dsd     32-bit slots: L0 L1 L2 L3 R0 R1 R2 R3 (time order; 16-bit slots: L0 L1 R0 R1)
     *   dsd_le  the same words reversed: L3 L2 L1 L0 R3 R2 R1 R0
     *   dop     24-bit PCM frames (in the DAC's slot, left-justified): marker, L0, L1 — then R —
     *           the marker 0x05 on one frame and 0xFA on the next, two DSD bytes a frame.
     */
    private fun packDsd(buffer: ByteBuffer) {
        val src = buffer.duplicate()
        val n = src.remaining() - src.remaining() % 8
        when (mode) {
            "dop" -> {
                room(n / 4 * subslot)
                var i = 0
                while (i < n) {
                    // Four bytes a channel in: two DoP frames out.
                    for (half in 0 until 2) {
                        for (ch in 0 until 2) {
                            val b0 = src.get(src.position() + i + ch + half * 4)
                            val b1 = src.get(src.position() + i + ch + half * 4 + 2)
                            if (subslot == 4) out.put(0.toByte())
                            out.put(b1); out.put(b0); out.put(dopMarker.toByte())
                        }
                        dopMarker = if (dopMarker == 0x05) 0xFA else 0x05
                    }
                    i += 8
                }
            }
            else -> {
                val le = mode == "dsd_le"
                if (subslot == 2) {
                    room(n)
                    var i = 0
                    while (i < n) {
                        for (half in 0 until 2) for (ch in 0 until 2) {
                            val a = src.get(src.position() + i + ch + half * 4); val b = src.get(src.position() + i + ch + half * 4 + 2)
                            if (le) { out.put(b); out.put(a) } else { out.put(a); out.put(b) }
                        }
                        i += 8
                    }
                } else {
                    room(n)
                    var i = 0
                    while (i < n) {
                        for (ch in 0 until 2) {
                            if (le) for (k in 3 downTo 0) out.put(src.get(src.position() + i + ch + k * 2))
                            else for (k in 0 until 4) out.put(src.get(src.position() + i + ch + k * 2))
                        }
                        i += 8
                    }
                }
            }
        }
        out.flip()
    }

    override fun play() { playing = true; if (usb) UsbDriver.play() else inner.play() }
    override fun pause() { playing = false; if (usb) UsbDriver.pause() else inner.pause() }
    override fun handleDiscontinuity() { if (usb) startSet = false else inner.handleDiscontinuity() }
    override fun playToEndOfStream() { if (usb) { UsbDriver.drain(); drained = true } else inner.playToEndOfStream() }
    override fun isEnded(): Boolean = if (usb) drained && UsbDriver.pending() == 0L else inner.isEnded()
    override fun hasPendingData(): Boolean = if (usb) UsbDriver.pending() > 0 else inner.hasPendingData()
    override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
        if (!usb) return inner.getCurrentPositionUs(sourceEnded)
        if (!startSet || rate <= 0) return AudioSink.CURRENT_POSITION_NOT_SET
        // Frames the DAC has taken at the stream's own rate: with DoP that is twice the renderer's frames.
        val played = UsbDriver.played() - playedAtStart
        return startUs + played * 1_000_000L / rate
    }
    override fun setVolume(volume: Float) { if (!usb) inner.setVolume(volume) }
    override fun flush() { if (usb) { UsbDriver.flush(); startSet = false; drained = false; outFor = null } else inner.flush() }
    override fun reset() { if (usb) { UsbDriver.flush(); startSet = false; drained = false; outFor = null } else inner.reset() }
    override fun release() { if (usb) { UsbDriver.close(); usb = false }; inner.release() }
}
