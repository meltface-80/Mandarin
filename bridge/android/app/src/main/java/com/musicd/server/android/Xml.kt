package com.musicd.server.android

/** The little XML the Bridge still writes: an error's words, escaped. */
object Xml {
    fun escape(s: String): String {
        val sb = StringBuilder(s.length + 16)
        for (ch in s) when (ch) {
            '&' -> sb.append("&amp;"); '<' -> sb.append("&lt;"); '>' -> sb.append("&gt;"); '"' -> sb.append("&quot;"); '\'' -> sb.append("&apos;")
            else -> sb.append(ch)
        }
        return sb.toString()
    }
}
