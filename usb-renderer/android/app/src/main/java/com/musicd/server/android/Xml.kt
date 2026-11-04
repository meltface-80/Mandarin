package com.musicd.server.android

import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.StringReader

/** The little XML the renderer reads and writes: escaping, a SOAP action's arguments, a DIDL-Lite item's words. */
object Xml {
    fun escape(s: String): String {
        val sb = StringBuilder(s.length + 16)
        for (ch in s) when (ch) {
            '&' -> sb.append("&amp;"); '<' -> sb.append("&lt;"); '>' -> sb.append("&gt;"); '"' -> sb.append("&quot;"); '\'' -> sb.append("&apos;")
            else -> sb.append(ch)
        }
        return sb.toString()
    }

    private fun parser(text: String): XmlPullParser = XmlPullParserFactory.newInstance().apply { isNamespaceAware = true }.newPullParser().apply { setInput(StringReader(text)) }

    /** A SOAP request's one action: its name, its namespace (the service type) and its arguments by name. */
    class Action(val name: String, val service: String, val args: Map<String, String>)

    fun parseSoap(text: String): Action? {
        val p = parser(text)
        var depth = 0
        var inBody = false
        var action: String? = null; var service = ""
        val args = LinkedHashMap<String, String>()
        var argName: String? = null
        val sb = StringBuilder()
        var ev = p.eventType
        while (ev != XmlPullParser.END_DOCUMENT) {
            when (ev) {
                XmlPullParser.START_TAG -> {
                    depth++
                    if (p.name == "Body" && action == null) inBody = true
                    else if (inBody && action == null) { action = p.name; service = p.namespace ?: "" }
                    else if (action != null && argName == null && depth == 4) { argName = p.name; sb.setLength(0) }
                }
                XmlPullParser.TEXT -> if (argName != null) sb.append(p.text)
                XmlPullParser.END_TAG -> {
                    if (argName != null && p.name == argName && depth == 4) { args[argName] = sb.toString(); argName = null }
                    depth--
                }
            }
            ev = p.next()
        }
        return action?.let { Action(it, service, args) }
    }

    /** What a DIDL-Lite item says of a track. */
    class Didl(val title: String, val artist: String, val album: String, val artUri: String, val durationSeconds: Double)

    fun parseDidl(text: String): Didl {
        if (text.isBlank()) return Didl("", "", "", "", 0.0)
        var title = ""; var artist = ""; var creator = ""; var album = ""; var art = ""; var dur = 0.0
        try {
            val p = parser(text)
            var ev = p.eventType
            var tag: String? = null
            val sb = StringBuilder()
            while (ev != XmlPullParser.END_DOCUMENT) {
                when (ev) {
                    XmlPullParser.START_TAG -> {
                        tag = p.name; sb.setLength(0)
                        if (p.name == "res") p.getAttributeValue(null, "duration")?.let { dur = hmsToSeconds(it) }
                    }
                    XmlPullParser.TEXT -> sb.append(p.text)
                    XmlPullParser.END_TAG -> {
                        val t = sb.toString().trim()
                        when (p.name) { "title" -> title = t; "artist" -> artist = t; "creator" -> creator = t; "album" -> album = t; "albumArtURI" -> art = t }
                        tag = null
                    }
                }
                ev = p.next()
            }
        } catch (e: Exception) { /* not DIDL-Lite: what was read stands */ }
        return Didl(title, if (artist.isNotEmpty()) artist else creator, album, art, dur)
    }

    /** "H:MM:SS" (or any number of parts) as seconds; anything unreadable 0. */
    fun hmsToSeconds(s: String): Double {
        val t = s.trim()
        if (t.isEmpty() || t == "NOT_IMPLEMENTED") return 0.0
        var acc = 0.0
        for (part in t.split(':')) { val n = part.toDoubleOrNull() ?: return 0.0; acc = acc * 60 + n }
        return acc
    }

    /** Whole seconds as H:MM:SS. */
    fun hms(seconds: Double): String {
        val s = if (seconds.isNaN() || seconds < 0) 0L else seconds.toLong()
        return "%d:%02d:%02d".format(s / 3600, s % 3600 / 60, s % 60)
    }
}
