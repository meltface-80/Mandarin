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
) {
    /** The address of a sign-in under way, without its scheme. */
    val linkText: String get() = pendingUrl?.replace(Regex("^https?://"), "") ?: ""
    /** Whether to look again shortly: a sign-in waited for. */
    val again: Boolean get() = pendingUrl != null
}

object IBroadcastSettings {
    /** The account [j] as the server answered it. */
    fun parse(j: JSONObject): IBroadcastAccount {
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
            j.opt("premium") == "yes" -> "Yes: your files play as they are"
            j.opt("premium") == false -> "No: iBroadcast plays everything as 128 kbps MP3"
            else -> "iBroadcast didn't say"
        }
        val list = j.optJSONArray("formats")
        val formats = if (!on) "" else (0 until (list?.length() ?: 0)).map { list!!.optString(it).uppercase() }.filter { it.isNotEmpty() }
            .joinToString(", ").ifEmpty { "iBroadcast didn't say" }
        return IBroadcastAccount(on, status, premium, formats, pending?.optString("url")?.takeIf { it.isNotEmpty() }, pending?.optString("code").orEmpty(),
            pending?.optString("error").orEmpty().isNotEmpty())
    }

    const val INFO = "Your iBroadcast account: your own music, uploaded to iBroadcast's servers. Sign in shows a link and a code: open the link on any device, sign in to iBroadcast there and approve Mandarin with the code. Mandarin keeps iBroadcast's sign-in token, never a password, and asks only to read your account and library, change your library and upload to it. Premium is needed to play your files as they are (lossless), rather than as 128 kbps MP3."
    const val NOTE = "Open this link, sign in to iBroadcast there, approve Mandarin with this code, and come back. Mandarin notices by itself."
}
