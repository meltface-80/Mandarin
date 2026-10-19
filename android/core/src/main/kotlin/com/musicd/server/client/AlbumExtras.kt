package com.musicd.server.client

import org.json.JSONObject
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * What an album's page shows under its artists once the extras come
 * (/api/album/extras, as the page asks: the day looked up when only the
 * year is known): its release date, its label, a Pitchfork score.
 */
data class AlbumExtras(val releaseDate: String?, val year: String?, val label: String?, val score: Double?, val bestNewMusic: Boolean) {
    /** The date line's date, as the page writes it: the day where it is known, else the month, else the year. */
    fun date(locale: Locale = Locale.getDefault()): String = ReleaseDate.format(releaseDate, locale).ifEmpty { year.orEmpty() }

    /** The score as the page writes it: "8.0", "7.4". */
    val scoreText: String? get() = score?.let { if (it % 1.0 == 0.0) "%.1f".format(Locale.ROOT, it) else it.toString() }

    companion object {
        fun parse(j: JSONObject): AlbumExtras {
            val a = j.optJSONObject("album")
            val year = j.optString("year", "").ifEmpty { a?.optInt("year", 0)?.takeIf { it > 0 }?.toString().orEmpty() }
            return AlbumExtras(
                releaseDate = j.optString("release_date", "").takeIf { it.isNotEmpty() && !j.isNull("release_date") },
                year = year.ifEmpty { null },
                label = a?.optString("label", "")?.takeIf { it.isNotEmpty() },
                score = a?.takeIf { it.has("score") && !it.isNull("score") }?.optDouble("score")?.takeIf { !it.isNaN() },
                bestNewMusic = a?.optBoolean("isBestNewMusic", false) ?: false
            )
        }
    }
}

/** A release date ("2006", "2006-11", "2006-11-20") written as the page writes it, in the phone's language. */
object ReleaseDate {
    fun format(s: String?, locale: Locale): String {
        val m = Regex("^(\\d{4})(?:-(\\d{2})(?:-(\\d{2}))?)?$").find(s.orEmpty()) ?: return ""
        val (y, mo, d) = m.destructured
        if (mo.isEmpty()) return y
        return runCatching {
            if (d.isEmpty()) YearMonth.of(y.toInt(), mo.toInt()).format(DateTimeFormatter.ofPattern("LLLL yyyy", locale))
            else LocalDate.of(y.toInt(), mo.toInt(), d.toInt()).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale))
        }.getOrDefault(y)   // "2026-13-40" is no date: the year is still right
    }
}

/** An album's length as its page writes it: 47:01, or 1:02:15 past the hour. */
fun albumLength(tracks: List<Track>): String {
    val secs = tracks.sumOf { it.length }
    return if (secs > 0) NowPlayingView.clock(Math.round(secs).toDouble()) else ""
}
