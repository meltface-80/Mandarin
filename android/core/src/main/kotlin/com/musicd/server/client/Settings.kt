package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * Settings, typed (the group T of old/plan-android-native.md, T1; bug list item 76): the list and Setup's list
 * as the page has them, the server's version at the list's foot (settings.js's loadVersion), the devices signed in to the
 * account (settings-account.js) and the API keys with what the server says of each (settings.js's wireKey).
 */

/** A row of a Settings list: the page it opens ([pane], the page's own name for it) and its title. */
data class SettingsRow(val pane: String, val title: String)

object SettingsLists {
    /** The Settings list, in the page's order. */
    val HOME = listOf(SettingsRow("account", "Account"), SettingsRow("folders", "Music Folders"), SettingsRow("streaming", "Services"),
        SettingsRow("playback", "Audio Devices"), SettingsRow("identify", "Library Scanner"), SettingsRow("setup", "Setup"),
        SettingsRow("backup", "Backup & restore"), SettingsRow("system", "Updates"))

    /** Setup's list, the app's Downloads before Away from home, as the page puts it in the app. */
    val SETUP = listOf(SettingsRow("smartpicks", "Smart Picks"), SettingsRow("labels", "Record labels"), SettingsRow("homescreen", "Home Screen"),
        SettingsRow("ui", "UI Settings"), SettingsRow("display", "Wall Display"), SettingsRow("shelfset", "Shelf"), SettingsRow("sharecard", "Share Card"),
        SettingsRow("downloads", "Downloads"), SettingsRow("away", "Away from home"), SettingsRow("metadata", "API Keys"))

    const val SETUP_DESC = "Smart Picks, record labels, the Home screen, the look, the wall display and Shelf, sharing, away from home, API keys"
    const val REPO = "https://github.com/meltface-80/Mandarin"

    /**
     * The version at the list's foot, from /api/update/status: "Mandarin v1.0 (Build 17)", and its C# server's when that
     * is another (being brought up to date, or to be pulled again); null when there is none to say.
     */
    fun version(j: JSONObject?): String? {
        val current = j?.optString("current").orEmpty().takeIf { it.isNotEmpty() && !j!!.isNull("current") } ?: return null
        val parts = current.split(".")
        var t = if (parts.size >= 3) "Mandarin v${parts[0]}.${parts[1]} (Build ${parts[2]})" else "Mandarin v$current"
        val cs = j?.optJSONObject("csharp")
        if (cs != null && cs.optString("version").isNotEmpty() && cs.has("matched") && !cs.optBoolean("matched", true)) {
            t += if (cs.optString("phase") in setOf("asking", "fetching", "downloading", "restarting")) " · bringing its C# server up to date"
                else " · C# server v" + cs.optString("version") + if (j.optBoolean("is_docker")) " (pull the image again to update it)" else ""
        }
        return t
    }
}

/** A device signed in to the account: its name, an Android app's or a browser, this one or when it was last seen. */
data class SignedInDevice(val id: String, val name: String, val android: Boolean, val current: Boolean, val lastSeenMs: Long) {
    /** The line under its name: "Android app · this device", "Browser · 3 hours ago". */
    fun sub(nowMs: Long): String = (if (android) "Android app" else "Browser") + " · " + if (current) "this device" else ago(lastSeenMs, nowMs)

    companion object {
        /** How long ago, as the page says it: "active now", "12 min ago", "1 hour ago", "3 days ago". */
        fun ago(ms: Long, nowMs: Long): String {
            val m = Math.round((nowMs - ms) / 60000.0)
            if (m < 2) return "active now"
            if (m < 60) return "$m min ago"
            val h = Math.round(m / 60.0)
            if (h < 48) return h.toString() + if (h == 1L) " hour ago" else " hours ago"
            return "${Math.round(h / 24.0)} days ago"
        }
    }
}

/** Who is signed in, and the devices signed in to the account (/api/auth/devices). */
data class AccountDevices(val username: String, val devices: List<SignedInDevice>) {
    val who: String get() = "Signed in as " + username.ifEmpty { "?" }

    companion object {
        const val FAILED = "Couldn't load the account"

        fun parse(j: JSONObject): AccountDevices = AccountDevices(j.optString("username").takeIf { !j.isNull("username") }.orEmpty(),
            objs(j.optJSONArray("devices")).map {
                SignedInDevice(it.optString("id"), it.optString("name"), it.optString("kind") == "android", it.optBoolean("current"), it.optLong("last_seen"))
            })

        /** What Ask for a sign-in means, on ([open] false) or off (item 161), as the page says it (settings-account.js). */
        fun askNote(open: Boolean, hasAccount: Boolean): String = if (open)
            "Off: anything on your home network or your Tailscale network uses Mandarin without signing in — a TV showing the shelf or the wall, say. Anywhere else still can't. " +
                (if (hasAccount) "Switch it on to ask for the username and password again." else "Switching it on makes the account first.")
        else "Every device signs in with the username and password. Switch it off to use Mandarin on a TV or a wall display without typing them: anything on your home network or your Tailscale network then comes straight in."

        /** Why a new password can't be set yet (null: it can be tried), as the page says it. */
        fun passwordProblem(current: String, new: String, again: String): String? = when {
            current.isEmpty() -> "Enter your current password."
            new.length < 8 -> "Use at least 8 characters for the new password."
            new != again -> "The two new passwords don't match."
            else -> null
        }
    }
}

/** One of the API keys: whether one is saved, its first and last letters, and what its service said of it ("ok", "invalid", or not asked). */
data class ApiKey(val set: Boolean, val masked: String, val check: String?) {
    val ok: Boolean get() = set && check == "ok"
    val bad: Boolean get() = set && check == "invalid"
    /** The ✓ or ✕ in the box, once checked. */
    val badge: String? get() = if (ok) "✓" else if (bad) "✕" else null

    /** What the empty box says. */
    fun placeholder(emptyHint: String): String = when {
        !set -> emptyHint
        ok -> "Checked and working — $masked"
        bad -> "Not accepted — paste a new one"
        else -> "Saved — $masked"
    }

    /** The line under the box. */
    val status: String get() = when {
        !set -> "Not set"
        ok -> "✓ Checked and working: $masked"
        bad -> "The service refused this key ($masked). Check it was copied in full."
        else -> "Current: $masked — couldn’t reach the service to check it."
    }

    companion object {
        fun parse(j: JSONObject): ApiKey = ApiKey(j.optBoolean("set"), j.optString("masked"), j.optString("check").takeIf { it.isNotEmpty() && !j.isNull("check") })
    }
}

/** A key the page asks for: its route and field, its name, the empty box's words, its service and what it is called, its ⓘ. */
data class ApiKeySpec(val route: String, val field: String, val name: String, val emptyHint: String, val service: String, val noun: String, val info: String) {
    /** What is said once it is saved ([k]: the server's answer): refused, or saved (and checked). */
    fun saved(k: ApiKey): String = if (k.bad) "Saved, but $service refused this $noun" else "$service $noun saved" + if (k.ok) " — checked and working" else ""

    companion object {
        const val DESC = "Discogs token — record label logos and label lookups; FanArt.tv key — artist photos on the wall display and label logos; Last.fm key — similar artists and albums in the album view. All optional."
        val ALL = listOf(
            ApiKeySpec("discogs-token", "token", "Discogs token", "Paste personal access token…", "Discogs", "token",
                "A personal access token from discogs.com/settings/developers. Finds record label logos, and the label of albums whose files carry none. Not required, but recommended."),
            ApiKeySpec("fanart-key", "key", "FanArt.tv key", "Paste FanArt.tv API key…", "FanArt.tv", "key",
                "A free API key from fanart.tv. Artist photos on the wall display, and record label logos where Discogs has none. Get one at fanart.tv/get-an-api-key — free registration required."),
            ApiKeySpec("lastfm-key", "key", "Last.fm key", "Paste Last.fm API key…", "Last.fm", "key",
                "A free API key from last.fm/api/account/create (any application name will do). The album view then shows the artist's similar artists and similar albums from Last.fm, under the review: the ones in your library open here, the others on Last.fm. Read-only: nothing is ever sent to Last.fm but the artist's name, and nothing is scrobbled."))
    }
}

private fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
