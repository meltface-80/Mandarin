package com.musicd.server.client

/**
 * A track's waveform as Now playing draws it under the seek bar, as the
 * page's does (public/app/mini-transport-progress.js): the server's stored
 * levels (/api/waveform, 0–255 each) folded into as many bars as there is
 * room for. They are RMS levels, so each bar is the RMS of the levels it
 * covers: the height it would have if the track had been analysed straight
 * into that many buckets. Silence is a sliver, never a gap.
 */
object Waveform {
    /** [count] bar heights, 0 to 1, from the stored [levels]. */
    fun bars(levels: ByteArray, count: Int): FloatArray {
        if (levels.isEmpty() || count <= 0) return FloatArray(0)
        return FloatArray(count) { i ->
            val a = (i.toLong() * levels.size / count).toInt()
            val b = minOf(levels.size, maxOf(a + 1, ((i + 1).toLong() * levels.size / count).toInt()))
            var sum = 0.0
            for (j in a until b) { val v = levels[j].toInt() and 0xFF; sum += v * v }
            (Math.sqrt(sum / (b - a)) / 255.0).toFloat()
        }
    }
}
