package com.musicd.server.android

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.SeekPoint
import androidx.media3.extractor.TrackOutput
import java.io.IOException

/**
 * DSF and DFF files for the player (Stage 9.3).
 *
 * Media3 knows neither. This reads the two containers and hands the DSD out
 * in one shape — the channels interleaved byte by byte, each byte's most
 * significant bit the oldest sample (DFF's own order; a DSF's bytes, least
 * significant bit first, are reversed on the way) — as samples of
 * [CHUNK] bytes with [MIME], at the DSD rate in Hz. DsdRenderer passes them
 * to the sink, which packs them for the DAC (native DSD or DoP). A DSF's
 * data is in blocks of 4096 bytes per channel; the chunk is one block of
 * each, so a seek lands on a block boundary.
 */
@UnstableApi
class DsdExtractor : Extractor {
    companion object {
        const val MIME = "audio/x-musicd-dsd"
        const val CHUNK = 8192
        /** The DSD rate as a multiple of 44.1 kHz: 64, 128, 256 … */
        fun multiple(rateHz: Int): Int = Math.round(rateHz / 44100.0).toInt()
        private val DSF_MAGIC = "DSD ".toByteArray()
        private val DFF_MAGIC = "FRM8".toByteArray()
        private val BITREV = ByteArray(256).also { t -> for (i in 0 until 256) { var v = i; var r = 0; for (b in 0 until 8) { r = (r shl 1) or (v and 1); v = v shr 1 }; t[i] = r.toByte() } }
    }

    private var output: ExtractorOutput? = null
    private var track: TrackOutput? = null
    private var dsf = false
    private var rate = 0
    private var channels = 2
    private var blockSize = 4096          // DSF: bytes per channel per block
    private var dataStart = 0L
    private var dataEnd = 0L
    private var lsbFirst = true           // DSF: bits per sample 1 = LSB first
    private var headerDone = false
    private var pos = 0L                  // the next byte of data to read
    private val raw = ByteArray(CHUNK)
    private val out = ParsableByteArray(CHUNK)

    override fun sniff(input: ExtractorInput): Boolean {
        val h = ByteArray(4)
        if (!input.peekFully(h, 0, 4, true)) return false
        return h.contentEquals(DSF_MAGIC) || h.contentEquals(DFF_MAGIC)
    }

    override fun init(output: ExtractorOutput) {
        this.output = output
        track = output.track(0, C.TRACK_TYPE_AUDIO)
        output.endTracks()
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder): Int {
        if (!headerDone) {
            readHeader(input)
            headerDone = true
            pos = dataStart
            seekPosition.position = dataStart
            return Extractor.RESULT_SEEK
        }
        if (input.position != pos) { seekPosition.position = pos; return Extractor.RESULT_SEEK }
        val left = dataEnd - pos
        if (left <= 0) return Extractor.RESULT_END_OF_INPUT
        val chunkIn = if (dsf) blockSize * channels else CHUNK
        val want = minOf(chunkIn.toLong(), left).toInt()
        if (!input.readFully(raw, 0, want, true)) return Extractor.RESULT_END_OF_INPUT
        val n = if (dsf) deinterleave(want) else straight(want)
        val timeUs = (pos - dataStart) * 8L * 1_000_000L / (rate.toLong() * channels)
        pos += want
        val t = track ?: return Extractor.RESULT_END_OF_INPUT
        out.reset(n)
        t.sampleData(out, n)
        t.sampleMetadata(timeUs, C.BUFFER_FLAG_KEY_FRAME, n, 0, null)
        return Extractor.RESULT_CONTINUE
    }

    /** A DSF block of each channel → bytes interleaved, bits MSB first. */
    private fun deinterleave(bytes: Int): Int {
        val perCh = bytes / channels
        val o = out.data
        var k = 0
        for (i in 0 until perCh) for (c in 0 until channels) {
            val b = raw[c * perCh + i]
            o[k++] = if (lsbFirst) BITREV[b.toInt() and 0xff] else b
        }
        return k
    }

    private fun straight(bytes: Int): Int {
        val n = bytes - bytes % channels
        System.arraycopy(raw, 0, out.data, 0, n)
        return n
    }

    override fun seek(position: Long, timeUs: Long) {
        if (!headerDone) return
        pos = if (position < dataStart) dataStart else position
    }

    override fun release() {}

    // ------------------------------------------------------------ headers

    private fun readHeader(input: ExtractorInput) {
        val h = ByteArray(4)
        input.peekFully(h, 0, 4)
        input.resetPeekPosition()
        dsf = h.contentEquals(DSF_MAGIC)
        if (dsf) readDsf(input) else readDff(input)
        if (rate <= 0 || channels !in 1..2) throw IOException("DSD: unsupported ($rate Hz, $channels channels)")
        val totalBytes = dataEnd - dataStart
        val durationUs = totalBytes * 8L * 1_000_000L / (rate.toLong() * channels)
        val f = Format.Builder().setSampleMimeType(MIME).setSampleRate(rate).setChannelCount(channels)
            .setCodecs("dsd" + multiple(rate)).setMaxInputSize(CHUNK).build()
        track!!.format(f)
        val align = if (dsf) blockSize * channels else CHUNK
        output!!.seekMap(object : SeekMap {
            override fun isSeekable() = true
            override fun getDurationUs() = durationUs
            override fun getSeekPoints(timeUs: Long): SeekMap.SeekPoints {
                var off = timeUs * rate * channels / 8_000_000L
                off -= off % align
                if (off > totalBytes) off = totalBytes - totalBytes % align
                val t = off * 8L * 1_000_000L / (rate.toLong() * channels)
                return SeekMap.SeekPoints(SeekPoint(t, dataStart + off))
            }
        })
    }

    private fun u32le(b: ByteArray, i: Int): Long = (b[i].toLong() and 0xff) or ((b[i + 1].toLong() and 0xff) shl 8) or ((b[i + 2].toLong() and 0xff) shl 16) or ((b[i + 3].toLong() and 0xff) shl 24)
    private fun u64le(b: ByteArray, i: Int): Long = u32le(b, i) or (u32le(b, i + 4) shl 32)
    private fun u32be(b: ByteArray, i: Int): Long = (b[i + 3].toLong() and 0xff) or ((b[i + 2].toLong() and 0xff) shl 8) or ((b[i + 1].toLong() and 0xff) shl 16) or ((b[i].toLong() and 0xff) shl 24)
    private fun u64be(b: ByteArray, i: Int): Long = (u32be(b, i) shl 32) or u32be(b, i + 4)
    private fun u16be(b: ByteArray, i: Int): Int = ((b[i].toInt() and 0xff) shl 8) or (b[i + 1].toInt() and 0xff)

    /** DSF: "DSD " (28 bytes), "fmt " (52), then "data". Little-endian. */
    private fun readDsf(input: ExtractorInput) {
        val head = ByteArray(28 + 52 + 12)
        input.peekFully(head, 0, head.size)
        input.resetPeekPosition()
        if (String(head, 28, 4, Charsets.US_ASCII) != "fmt ") throw IOException("DSF: no fmt chunk")
        val fmt = 28
        val formatId = u32le(head, fmt + 16)
        if (formatId != 0L) throw IOException("DSF: not raw DSD")
        channels = u32le(head, fmt + 24).toInt()
        rate = u32le(head, fmt + 28).toInt()
        val bits = u32le(head, fmt + 32).toInt()
        lsbFirst = bits != 8
        blockSize = u32le(head, fmt + 44).toInt().let { if (it <= 0) 4096 else it }
        val fmtSize = u64le(head, fmt + 4)
        val dataAt = fmt + fmtSize.toInt()
        val dh = ByteArray(12)
        input.advancePeekPosition(dataAt)
        input.peekFully(dh, 0, 12)
        input.resetPeekPosition()
        if (String(dh, 0, 4, Charsets.US_ASCII) != "data") throw IOException("DSF: no data chunk")
        val dataSize = u64le(dh, 4) - 12
        dataStart = dataAt + 12L
        dataEnd = dataStart + dataSize - dataSize % (blockSize.toLong() * channels)
        if (blockSize * channels > CHUNK) throw IOException("DSF: block size $blockSize")
    }

    /** DFF (DSDIFF): "FRM8" form with PROP (FS, CHNL, CMPR) and the DSD chunk. Big-endian. */
    private fun readDff(input: ExtractorInput) {
        val h = ByteArray(16)
        input.peekFully(h, 0, 16)
        input.resetPeekPosition()
        if (String(h, 12, 4, Charsets.US_ASCII) != "DSD ") throw IOException("DFF: not a DSD form")
        var at = 16L
        val length = input.length
        val ch = ByteArray(12)
        var found = false
        while (!found && (length == C.LENGTH_UNSET.toLong() || at + 12 <= length)) {
            input.advancePeekPosition((at - input.peekPosition).toInt())
            input.peekFully(ch, 0, 12)
            val id = String(ch, 0, 4, Charsets.US_ASCII)
            val size = u64be(ch, 4)
            when (id) {
                "PROP" -> readProp(input, at + 12, size)
                "DSD " -> { dataStart = at + 12; dataEnd = dataStart + size; found = true }
                "DST " -> throw IOException("DFF: DST-compressed DSD isn't supported")
            }
            if (!found) at += 12 + size + (size and 1L)
        }
        input.resetPeekPosition()
        if (!found) throw IOException("DFF: no DSD chunk")
        dataEnd -= (dataEnd - dataStart) % channels
    }

    private fun readProp(input: ExtractorInput, start: Long, size: Long) {
        val buf = ByteArray(minOf(size, 4096L).toInt())
        input.advancePeekPosition((start - input.peekPosition).toInt())
        input.peekFully(buf, 0, buf.size)
        if (String(buf, 0, 4, Charsets.US_ASCII) != "SND ") return
        var i = 4
        while (i + 12 <= buf.size) {
            val id = String(buf, i, 4, Charsets.US_ASCII)
            val sz = u64be(buf, i + 4).toInt()
            val body = i + 12
            when (id) {
                "FS  " -> if (body + 4 <= buf.size) rate = u32be(buf, body).toInt()
                "CHNL" -> if (body + 2 <= buf.size) channels = u16be(buf, body)
                "CMPR" -> if (body + 4 <= buf.size && String(buf, body, 4, Charsets.US_ASCII) != "DSD ") throw IOException("DFF: compressed DSD isn't supported")
            }
            i = body + sz + (sz and 1)
        }
    }
}
