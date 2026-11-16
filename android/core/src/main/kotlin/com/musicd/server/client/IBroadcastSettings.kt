package com.musicd.server.client

import org.json.JSONObject

/**
 * Settings → Services → iBroadcast as the server keeps the account (GET /api/settings/ibroadcast; item 443): the page's
 * ibroadcastWords (settings-ibroadcast.js) in what they say. Signed out, a sign-in under way: the address to open, the
 * code to approve Mandarin with there, or what went wrong. Signed in: who, whether the account is Premium, the formats
 * iBroadcast takes.
 */
data class IBroadcastAccount(
    val connected: Boolean,
    /** The line under the title: who is signed in, or how a sign-in is going; "" signed out with none under way. */
    val status: String,
    /** Whether the account is Premium, in words; "" signed out. */
    val premium: String,
    /** The formats iBroadcast takes, in capitals; "" signed out. */
    val formats: String,
    /** A sign-in under way: the address to open (as shown, [linkText]) and the code; none otherwise. */
    val pendingUrl: String?,
    val pendingCode: String,
    /** A sign-in that went wrong (no longer waited for). */
    val pendingError: Boolean,
    /** Whether iBroadcast's albums are in the library (item 444). */
    val import: Boolean = true,
    /** The library being read from iBroadcast now (asked again shortly while it is). */
    val reading: Boolean = false,
    /** What the library holds of iBroadcast; "" signed out. */
    val libraryStatus: String = "",
) {
    /** The address of a sign-in under way, without its scheme. */
    val linkText: String get() = pendingUrl?.replace(Regex("^https?://"), "") ?: ""
    /** Whether to look again shortly: a sign-in waited for, or the library being read. */
    val again: Boolean get() = (pendingUrl != null && !pendingError) || reading
}

object IBroadcastSettings {
    /** The account [j] as the server answered it; [at]: a moment (milliseconds) as the phone writes a date and time. */
    fun parse(j: JSONObject, at: (Long) -> String = { it.toString() }): IBroadcastAccount {
        val on = j.optBoolean("connected")
        val pending = if (on) null else j.optJSONObject("pending")
        val who = j.optJSONObject("user")?.optString("name").orEmpty().ifEmpty { "your account" }
        val status = when {
            on -> "Signed in as $who"
            pending != null -> pending.optString("error").ifEmpty { "Waiting for Mandarin to be approved on iBroadcast…" }
            else -> ""
        }
        val premium = when {
            !on -> ""
            j.opt("premium") == true -> "Yes: your files play as they are"
            j.opt("premium") == false -> "No: iBroadcast plays everything as 128 kbps MP3"
            else -> "iBroadcast didn't say"
        }
        val list = j.optJSONArray("formats")
        val formats = if (!on) "" else (0 until (list?.length() ?: 0)).map { list!!.optString(it).uppercase() }.filter { it.isNotEmpty() }
            .joinToString(", ").ifEmpty { "iBroadcast didn't say" }
        val l = j.optJSONObject("library")
        val import = l?.opt("import") != false
        val reading = on && l?.optBoolean("reading") == true
        return IBroadcastAccount(on, status, premium, formats, pending?.optString("url")?.takeIf { it.isNotEmpty() }, pending?.optString("code").orEmpty(),
            pending?.optString("error").orEmpty().isNotEmpty(), import, reading, if (on) libraryWords(l, at) else "")
    }

    /** What the library holds of iBroadcast ([l]: the state's library), as the page says it (ibroadcastLibraryWords). */
    fun libraryWords(l: JSONObject?, at: (Long) -> String): String {
        if (l?.opt("import") == false) return "Off: your iBroadcast albums are not in the library. Switch on to show them."
        if (l?.optBoolean("reading") == true) return READING
        if (l == null || !l.has("albums") || l.isNull("albums")) return "Your iBroadcast library is read shortly after signing in."
        val n = l.optInt("albums")
        val here = l.optInt("also_here")
        return "$n album" + (if (n == 1) "" else "s") + " in iBroadcast" + (if (here > 0) " · $here of them here as files too, shown once" else "") + " · updated " + at(l.optLong("at"))
    }

    const val READING = "Reading your iBroadcast library…"
    const val IMPORT_INFO = "Every album in your iBroadcast library as an album here: on the walls, in search, in Smart Picks and Listen later. One you also have here as files is shown once, from the files. Read again whenever iBroadcast says your library changed (Mandarin looks every ten minutes), and by Update library now. On unless you switch it off; off, none of them are in the library."

    const val INFO = "Your iBroadcast account: your own music, uploaded to iBroadcast's servers. Sign in shows a link and a code: open the link on any device, sign in to iBroadcast there and approve Mandarin with the code. Mandarin keeps iBroadcast's sign-in token, never a password, and asks only to read your account and library, change your library and upload to it. Premium is needed to play your files as they are (lossless), rather than as 128 kbps MP3."
    const val NOTE = "Open this link, sign in to iBroadcast there, approve Mandarin with this code, and come back. Mandarin notices by itself."
}
