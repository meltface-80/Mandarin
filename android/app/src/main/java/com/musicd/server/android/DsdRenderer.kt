package com.musicd.server.android

import android.os.Handler
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.CryptoConfig
import androidx.media3.decoder.DecoderException
import androidx.media3.decoder.DecoderInputBuffer
import androidx.media3.decoder.SimpleDecoder
import androidx.media3.decoder.SimpleDecoderOutputBuffer
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DecoderAudioRenderer

/**
 * DSD to the audio sink, untouched (Stage 9.3).
 *
 * The extractor's chunks go through a "decoder" that copies them, and reach
 * the sink as a raw stream the sinks recognise by its codec tag: 32-bit
 * words at a thirty-second of the DSD rate (DSD64 → 88.2 kHz), each word
 * four bytes of one channel's bits in time order, channels interleaved —
 * see [outputFormat]. Only the USB sink takes it (native DSD or DoP); the
 * DSP sink passes it by, and Android's track never sees it.
 */
@UnstableApi
class DsdRenderer(eventHandler: Handler?, eventListener: AudioRendererEventListener?, audioSink: AudioSink) :
    DecoderAudioRenderer<DsdRenderer.Pass>(eventHandler, eventListener, audioSink) {

    companion object {
        const val CODEC = "dsd"
        fun isDsd(f: Format) = f.sampleMimeType == MimeTypes.AUDIO_RAW && f.codecs == CODEC
        /** The DSD rate in Hz of a sink format made here. */
        fun dsdRate(f: Format) = f.sampleRate * 32
        fun outputFormat(dsdRateHz: Int, channels: Int): Format = Format.Builder()
            .setSampleMimeType(MimeTypes.AUDIO_RAW).setPcmEncoding(C.ENCODING_PCM_32BIT)
            .setSampleRate(dsdRateHz / 32).setChannelCount(channels).setCodecs(CODEC).build()
    }

    class PassException(msg: String, cause: Throwable? = null) : DecoderException(msg, cause)

    /** The copy. */
    @Suppress("UNCHECKED_CAST")
    class Pass(private val rate: Int, val channels: Int) : SimpleDecoder<DecoderInputBuffer, SimpleDecoderOutputBuffer, PassException>(
        arrayOfNulls<DecoderInputBuffer>(8) as Array<DecoderInputBuffer>, arrayOfNulls<SimpleDecoderOutputBuffer>(8) as Array<SimpleDecoderOutputBuffer>) {
        init { setInitialInputBufferSize(DsdExtractor.CHUNK) }
        override fun getName() = "musicd-dsd"
        override fun createInputBuffer() = DecoderInputBuffer(DecoderInputBuffer.BUFFER_REPLACEMENT_MODE_NORMAL)
        override fun createOutputBuffer() = SimpleDecoderOutputBuffer { releaseOutputBuffer(it) }
        override fun createUnexpectedDecodeException(error: Throwable) = PassException("DSD", error)
        override fun decode(input: DecoderInputBuffer, output: SimpleDecoderOutputBuffer, reset: Boolean): PassException? {
            // The renderer flips the input before it comes here: position 0, limit its size.
            val src = (input.data ?: return null).duplicate()
            val n = src.remaining()
            val dst = output.init(input.timeUs, n)
            dst.put(src)
            dst.flip()
            return null
        }
    }

    private var channels = 2
    private var dsdRate = 0

    override fun getName() = "DsdRenderer"

    override fun supportsFormatInternal(format: Format): Int {
        if (format.sampleMimeType != DsdExtractor.MIME) return C.FORMAT_UNSUPPORTED_TYPE
        // Taken whatever the sink says now: a DSD track the DAC can't take
        // becomes an error the player sees (and the service answers), not a
        // track skipped in silence.
        return C.FORMAT_HANDLED
    }

    override fun createDecoder(format: Format, cryptoConfig: CryptoConfig?): Pass {
        channels = format.channelCount
        dsdRate = format.sampleRate
        return Pass(dsdRate, channels)
    }

    override fun getOutputFormat(decoder: Pass): Format = outputFormat(dsdRate, channels)
}
