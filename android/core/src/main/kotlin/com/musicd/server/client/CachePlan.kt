package com.musicd.server.client

/**
 * Playing on the phone: which of the upcoming tracks to keep on the phone
 * ahead of time, and the choices for how many.
 *
 * Like Plexamp: a number of tracks for Wi-Fi and a (smaller) one for mobile
 * data, and a limit on the space the cache takes. Tracks already cached
 * stay until the space is needed, so a track played again costs nothing.
 */
object CachePlan {
    /** Tracks cached ahead on Wi-Fi: 5 to 45 in fives, 20 unless chosen. */
    val WIFI_CHOICES = (5..45 step 5).toList()
    const val WIFI_DEFAULT = 20

    /** Tracks cached ahead on mobile data: 5, 10 or 15, 10 unless chosen. */
    val MOBILE_CHOICES = listOf(5, 10, 15)
    const val MOBILE_DEFAULT = 10

    /** The cache's size limit in GB. */
    val SIZE_CHOICES_GB = listOf(2, 4, 6, 8, 10)
    const val SIZE_DEFAULT_GB = 2

    /** [chosen] if it's one of [choices], else [default] (a stored value from another version). */
    fun pick(chosen: Int, choices: List<Int>, default: Int) = if (chosen in choices) chosen else default

    /**
     * The tracks to fetch, nearest first: the next [count] tracks in play
     * order (shuffle and repeat already applied in [upcoming], the playing
     * track not in it), leaving out those already cached and those that aren't
     * the server's (downloads, other addresses — null keys). A track that comes
     * up twice (repeat) is fetched once.
     */
    fun toFetch(upcoming: List<String?>, count: Int, cached: (String) -> Boolean): List<String> {
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        for (key in upcoming.take(maxOf(0, count))) {
            if (key == null || !seen.add(key)) continue
            if (!cached(key)) out += key
        }
        return out
    }

    /** The track id in a server stream address (".../stream/t12.flac?s=..."), or null. */
    fun trackIdOf(url: String): Long? =
        Regex("/stream/t(\\d+)(?:[./?]|$)").find(url)?.groupValues?.get(1)?.toLongOrNull()

    /**
     * A cached track's name: the track and its format, so the same track as
     * the original and as Opus are two entries — and whichever is on the phone
     * can be played wherever the phone is.
     */
    fun key(trackId: Long, opus: Boolean, variant: String = "") = "t$trackId:" + (if (opus) "opus" else "orig") + (if (variant.isEmpty() || opus) "" else ":$variant")

    /**
     * What a server stream address says it carries (Stage 9.3): "orig" (the
     * file as it is), "96000-24" (a conversion to that), or "" (the Sonos
     * rule, as the addresses were). Part of the cache name: the same track
     * planned two ways is two entries.
     */
    fun variantOf(url: String): String =
        Regex("/stream/t\\d+\\.(orig|\\d+-\\d+)\\.").find(url)?.groupValues?.get(1) ?: ""
}
