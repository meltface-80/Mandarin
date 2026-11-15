package com.musicd.server.android

import java.net.URLDecoder

/**
 * What Mandarin says of a track in the request its strm s gives the Bridge, or in an mtrk as a run of its PCM comes to
 * the next track (Slim.kt): headers of its own, each percent-encoded (a header is ASCII). X-Mandarin-Title, -Artist and
 * -Album for the screen and the notification; X-Mandarin-Art the album's cover (item 430), at the signed address Mandarin
 * gives a renderer, fetched with no sign-in; X-Mandarin-Untouched an MQA track to a DAC that decodes it (item 418).
 * Plain Kotlin, no Android, so it is unit-tested on the JVM (SaidTest).
 */
object Said {
    /** The value of header [name] in [lines] (case aside), decoded; "" where it isn't there. */
    fun header(lines: List<String>, name: String): String = lines.firstOrNull { it.startsWith("$name:", ignoreCase = true) }?.substringAfter(':')?.trim()
        ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrDefault(it) } ?: ""

    /** The cover's address in [lines]: http or https only, else "" (the Bridge fetches nothing else). */
    fun art(lines: List<String>): String = header(lines, "X-Mandarin-Art").takeIf { it.startsWith("http://") || it.startsWith("https://") } ?: ""

    /** A request's or an mtrk's text as its lines. */
    fun lines(text: String): List<String> = text.split("\r\n")
}
