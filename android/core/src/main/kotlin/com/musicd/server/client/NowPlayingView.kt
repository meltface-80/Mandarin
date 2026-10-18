package com.musicd.server.client

/**
 * What the native Now playing shows of a room (stage N2 of
 * docs/specs/plan-android-native.md): its track, cover and transport, and
 * where the track is. The server says where it was when it answered
 * ([Zone]'s seek); between answers, while it plays, the screen moves it on by
 * the clock itself, never past the track's end.
 */
data class NowPlayingView(
    val zoneName: String,
    val title: String,
    val artist: String,
    val album: String,
    val imageKey: String?,
    val playing: Boolean,
    /** Where the track was when the server answered, in seconds. */
    val seekSeconds: Double,
    val lengthSeconds: Double?,
    val canNext: Boolean,
    val canPrevious: Boolean,
    /** When the answer came ([System.currentTimeMillis] then). */
    val answeredAtMs: Long
) {
    /** Where the track is at [nowMs]: moved on by the clock while it plays. */
    fun position(nowMs: Long): Double {
        val p = if (playing) seekSeconds + (nowMs - answeredAtMs).coerceAtLeast(0) / 1000.0 else seekSeconds
        return lengthSeconds?.let { p.coerceAtMost(it) } ?: p
    }

    /** How far through the track, 0 to 1; 0 when its length isn't known. */
    fun fraction(nowMs: Long): Float = lengthSeconds?.takeIf { it > 0 }?.let { (position(nowMs) / it).toFloat().coerceIn(0f, 1f) } ?: 0f

    companion object {
        /** The room's answer as the screen shows it; null when nothing is playing there. */
        fun of(state: ZoneState, answeredAtMs: Long): NowPlayingView? {
            val z = state.zone ?: return null
            val np = z.nowPlaying ?: return null
            return NowPlayingView(
                zoneName = z.name, title = np.title, artist = np.artist, album = np.album, imageKey = np.imageKey,
                playing = z.isPlaying, seekSeconds = (np.seekSeconds ?: 0).toDouble(), lengthSeconds = np.lengthSeconds?.toDouble(),
                canNext = z.nextAllowed, canPrevious = z.previousAllowed, answeredAtMs = answeredAtMs
            )
        }

        /** A time as the page writes it: "0:03", "4:05", "1:02:03". */
        fun clock(seconds: Double): String {
            val s = seconds.coerceAtLeast(0.0).toLong()
            val h = s / 3600; val m = (s % 3600) / 60; val sec = s % 60
            return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%d:%02d".format(m, sec)
        }
    }
}
