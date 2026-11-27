package com.musicd.server.client

/**
 * An album's release date as its files' tags give it (item 541): the phone's own music has no server to ask, so the
 * day a Qobuz purchase came out is read from the files themselves.
 *
 * Android's tag reader gives two: YEAR (ID3's TDRC, MP4's ©day, a FLAC's YEAR) and DATE (a FLAC's DATE; for an MP4
 * file the day the file was made, written 20110930T000000.000Z, which is no release date and is passed over).
 */
object TagDate {
    private val DATE = Regex("^(\\d{4})(?:[-/.](\\d{2})(?:[-/.](\\d{2}))?)?(?!\\d)")

    /** "2011-09-30", "2011-09" or "2011": the fullest of [year] and [date] that agree on the year, the first where they don't; "" with neither. */
    fun of(year: String?, date: String?): String {
        val found = listOfNotNull(year, date).mapNotNull { read(it) }
        val first = found.firstOrNull() ?: return ""
        return found.filter { it.take(4) == first.take(4) }.maxByOrNull { it.length } ?: first
    }

    private fun read(s: String): String? {
        val m = DATE.find(s.trim()) ?: return null
        val (y, mo, d) = m.destructured
        if (y.toInt() < 1000) return null
        return listOf(y, mo, d).filter { it.isNotEmpty() }.joinToString("-")
    }
}
