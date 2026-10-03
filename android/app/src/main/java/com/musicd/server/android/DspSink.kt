package com.musicd.server.android

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import com.musicd.server.client.Dsp
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The phone's DSP engine (Stage 3): the setting the server keeps for this
 * phone, run on every buffer the decoders hand the audio sink — the server's
 * stream, Opus away from home, a download — before Android's mixer.
 *
 * The sink is wrapped rather than an AudioProcessor added to it, because
 * Media3's DefaultAudioSink runs its processor chain only on 16-bit input;
 * a 24-bit or float decode (Stage 2's libopus) bypasses it on the way to a
 * float AudioTrack. Here every PCM buffer is turned into 64-bit float,
 * the preamp and the bands run (public/biquad.js's maths, in Dsp.kt), and
 * the result goes to the sink as float — whatever the decoder gave, so a
 * change of setting never needs the sink reconfigured. Off, the audio is
 * still passed as float: the same path, nothing done to it.
 *
 * ReplayGain (v0.6.0-RC5) is applied here too, ahead of the bands: the
 * engine's [DspEngine.gain]. The decoders run ahead of what is heard, so the
 * next track's gain is taken up when the decoders move on to it (Media3
 * reports that to the sink as a discontinuity), not when it is heard.
 */
@UnstableApi
class DspSink(private val inner: AudioSink, private val engine: DspEngine) : ForwardingAudioSink(inner) {

    private var pcm = false
    private var rate = 0
    private var channels = 0
    private var encoding = C.ENCODING_INVALID
    private var pending: ByteBuffer? = null
    private var pendingFor: ByteBuffer? = null
    private var out: ByteBuffer = ByteBuffer.allocateDirect(0)

    // DSD (DsdRenderer, Stage 9.3) is raw to the sinks but not PCM: passed by untouched.
    private fun linearPcm(f: Format) = f.sampleMimeType == MimeTypes.AUDIO_RAW && isPcm(f.pcmEncoding) && !DsdRenderer.isDsd(f)
    private fun isPcm(e: Int) = e == C.ENCODING_PCM_16BIT || e == C.ENCODING_PCM_16BIT_BIG_ENDIAN ||
        e == C.ENCODING_PCM_24BIT || e == C.ENCODING_PCM_24BIT_BIG_ENDIAN ||
        e == C.ENCODING_PCM_32BIT || e == C.ENCODING_PCM_32BIT_BIG_ENDIAN ||
        e == C.ENCODING_PCM_FLOAT || e == C.ENCODING_PCM_8BIT
    private fun asFloat(f: Format) = f.buildUpon().setPcmEncoding(C.ENCODING_PCM_FLOAT).build()

    override fun supportsFormat(format: Format) = getFormatSupport(format) != AudioSink.SINK_FORMAT_UNSUPPORTED

    /** Any PCM is taken: it reaches the sink as float, which is what the decoders are asked for. */
    override fun getFormatSupport(format: Format): Int =
        if (linearPcm(format)) inner.getFormatSupport(asFloat(format)) else inner.getFormatSupport(format)

    override fun configure(inputFormat: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
        pcm = linearPcm(inputFormat)
        pending = null; pendingFor = null
        if (!pcm) { inner.configure(inputFormat, specifiedBufferSize, outputChannels); return }
        rate = inputFormat.sampleRate; channels = inputFormat.channelCount; encoding = inputFormat.pcmEncoding
        engine.prepare(rate, channels)
        inner.configure(asFloat(inputFormat), specifiedBufferSize, outputChannels)
    }

    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        if (!pcm) return inner.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
        // The same input buffer comes back until it is taken: its processed
        // form is kept and offered again.
        if (pendingFor !== buffer || pending == null) {
            pending = convert(buffer)
            pendingFor = buffer
        }
        val done = inner.handleBuffer(pending!!, presentationTimeUs, encodedAccessUnitCount)
        if (done) { buffer.position(buffer.limit()); pending = null; pendingFor = null }
        return done
    }

    /** [buffer] (the decoder's PCM) as float, through the engine. */
    private fun convert(buffer: ByteBuffer): ByteBuffer {
        val bytesPer = when (encoding) {
            C.ENCODING_PCM_8BIT -> 1
            C.ENCODING_PCM_16BIT, C.ENCODING_PCM_16BIT_BIG_ENDIAN -> 2
            C.ENCODING_PCM_24BIT, C.ENCODING_PCM_24BIT_BIG_ENDIAN -> 3
            else -> 4
        }
        val samples = buffer.remaining() / bytesPer
        val need = samples * 4
        if (out.capacity() < need) out = ByteBuffer.allocateDirect(need).order(ByteOrder.nativeOrder())
        out.clear()
        val big = encoding == C.ENCODING_PCM_16BIT_BIG_ENDIAN || encoding == C.ENCODING_PCM_24BIT_BIG_ENDIAN || encoding == C.ENCODING_PCM_32BIT_BIG_ENDIAN
        val src = buffer.duplicate().order(if (big) ByteOrder.BIG_ENDIAN else if (encoding == C.ENCODING_PCM_FLOAT) ByteOrder.nativeOrder() else ByteOrder.LITTLE_ENDIAN)
        val chain = engine.chain
        val gain = engine.gain
        var ch = 0
        for (i in 0 until samples) {
            var v: Double = when (encoding) {
                C.ENCODING_PCM_FLOAT -> src.getFloat().toDouble()
                C.ENCODING_PCM_16BIT, C.ENCODING_PCM_16BIT_BIG_ENDIAN -> src.getShort() / 32768.0
                C.ENCODING_PCM_24BIT, C.ENCODING_PCM_24BIT_BIG_ENDIAN -> {
                    val b0 = src.get().toInt() and 0xff; val b1 = src.get().toInt() and 0xff; val b2 = src.get().toInt() and 0xff
                    val raw = if (big) (b0 shl 16) or (b1 shl 8) or b2 else (b2 shl 16) or (b1 shl 8) or b0
                    ((raw shl 8) shr 8) / 8388608.0
                }
                C.ENCODING_PCM_8BIT -> ((src.get().toInt() and 0xff) - 128) / 128.0
                else -> src.getInt() / 2147483648.0
            }
            if (gain != 1.0) v *= gain
            if (chain != null) v = chain.process(ch, v)
            out.putFloat(v.toFloat())
            ch++; if (ch == channels) ch = 0
        }
        out.flip()
        return out
    }

    /** The decoders have moved on to the next track (gapless): its ReplayGain from here. */
    override fun handleDiscontinuity() { engine.streamChanged(); inner.handleDiscontinuity() }

    override fun flush() { inner.flush(); engine.reset(); pending = null; pendingFor = null }
    override fun reset() { inner.reset(); engine.reset(); pending = null; pendingFor = null }
}

/**
 * The setting and the chain built from it for the stream at hand. [apply]
 * may be called from any thread (the server's command loop); the playback
 * thread picks the new chain up at its next buffer. Filter state restarts
 * with a new chain — a click-free crossfade is not worth the complexity for
 * a setting changed by hand.
 */
class DspEngine {
    @Volatile var setting: Dsp.Setting = Dsp.Setting.OFF
        private set
    @Volatile var chain: Dsp.Chain? = null
        private set
    private var rate = 0
    private var channels = 0

    /** Is the engine changing the sound right now? */
    val active: Boolean get() = chain != null

    /** ReplayGain as a multiplier on what is being fed now; 1 for none. */
    @Volatile var gain: Double = 1.0
        private set
    private var upcoming = 1.0
    private var armed = false

    /** The track heard now and the one after it (the service, at each transition). */
    @Synchronized fun gains(current: Double, next: Double) { gain = current; upcoming = next; armed = true }
    /** The track after this one changed (the queue edited, shuffle turned on). */
    @Synchronized fun nextGain(next: Double) { upcoming = next }
    /** The decoders moved on: the next track's gain, once per transition. */
    @Synchronized fun streamChanged() { if (armed) { gain = upcoming; armed = false } }

    @Synchronized fun apply(s: Dsp.Setting) {
        setting = s
        rebuild()
    }

    @Synchronized fun prepare(rate: Int, channels: Int) {
        this.rate = rate; this.channels = channels
        rebuild()
    }

    @Synchronized fun reset() { chain?.reset() }

    private fun rebuild() {
        chain = if (setting.active && rate > 0 && channels > 0) Dsp.Chain(setting, rate.toDouble(), channels) else null
    }
}
