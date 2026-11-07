package com.musicd.server.android

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput

/**
 * Mandarin's continuous PCM (item 322): a run, one stream of samples alone, little-endian, with no header to say what
 * they are; its address says it after "#pcm=" ([Slim] puts it there from the strm: "…/3.pcm?s=…#pcm=s24le:96000:2",
 * as Mandarin Bridge for Linux hands its engine). ExoPlayer is given the samples as they come, a tenth of a second at
 * a time, timed from the frames before them, as raw PCM of that depth, rate and channels: the USB sink plays them as
 * it plays a WAV's. The part after '#' never goes to the server. A run can't be sought within; Mandarin makes it again.
 */
@UnstableApi
class RawPcmExtractor(private val rate: Int, private val bits: Int, private val channels: Int) : Extractor {
    companion object {
        private val SAID = Regex("#pcm=s(16|24|32)le:([0-9]+):([1-8])$")

        /** The extractor for [uri]'s raw samples, where its address says what they are; null for any other. */
        fun of(uri: Uri): RawPcmExtractor? {
            val m = SAID.find(uri.toString()) ?: return null
            val rate = m.groupValues[2].toIntOrNull()?.takeIf { it in 8000..1536000 } ?: return null
            return RawPcmExtractor(rate, m.groupValues[1].toInt(), m.groupValues[3].toInt())
        }
    }

    private val frameBytes = bits / 8 * channels
    private val target = (rate / 10).coerceAtLeast(1) * frameBytes
    private lateinit var track: TrackOutput
    private var pending = 0
    private var frames = 0L

    override fun sniff(input: ExtractorInput): Boolean = true

    override fun init(output: ExtractorOutput) {
        track = output.track(0, C.TRACK_TYPE_AUDIO)
        val encoding = when (bits) { 16 -> C.ENCODING_PCM_16BIT; 24 -> C.ENCODING_PCM_24BIT; else -> C.ENCODING_PCM_32BIT }
        track.format(Format.Builder().setSampleMimeType(MimeTypes.AUDIO_RAW).setPcmEncoding(encoding).setSampleRate(rate).setChannelCount(channels)
            .setAverageBitrate(rate * frameBytes * 8).setPeakBitrate(rate * frameBytes * 8).setMaxInputSize(target).build())
        output.endTracks()
        output.seekMap(SeekMap.Unseekable(C.TIME_UNSET))
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder): Int {
        val n = track.sampleData(input, target - pending, true)
        val ended = n == C.RESULT_END_OF_INPUT
        if (!ended) pending += n
        // Whole frames only, a tenth of a second at a time (all there is at the end); a part-frame waits for the rest.
        val whole = pending - pending % frameBytes
        if (whole > 0 && (pending >= target || ended)) {
            track.sampleMetadata(frames * 1_000_000L / rate, C.BUFFER_FLAG_KEY_FRAME, whole, pending - whole, null)
            frames += whole / frameBytes
            pending -= whole
        }
        return if (ended) Extractor.RESULT_END_OF_INPUT else Extractor.RESULT_CONTINUE
    }

    override fun seek(position: Long, timeUs: Long) { pending = 0; frames = timeUs * rate / 1_000_000L }

    override fun release() {}
}
