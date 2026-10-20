package com.musicd.server.client

import org.json.JSONObject
import java.text.NumberFormat
import kotlin.math.roundToLong

/*
 * The side menu's words, typed (the Rooms group of docs/specs/plan-android-native.md;
 * bug list item 67): the Rescan row's line under it, what a rescan answered, and
 * which of the services' rows it shows; as the page's menu-drawer.js and
 * power.js say them, so the app's menu and the page's read alike.
 */
object Menu {
    /** Which of the rows that come and go are offered: Labels unless switched off, Qobuz and Tidal once signed in, Shelf unless switched off. */
    data class Items(val labels: Boolean = true, val qobuz: Boolean = false, val tidal: Boolean = false, val shelf: Boolean = true)

    /**
     * The rows offered, from `/api/settings/labels`, `/qobuz`, `/tidal` and `/shelf` as the page reads them
     * (labels-albums.js, settings-services.js, features.js): an answer missing (null) leaves its row as the markup has it.
     */
    fun items(labels: JSONObject?, qobuz: JSONObject?, tidal: JSONObject?, shelf: JSONObject?): Items {
        val d = Items()
        return Items(labels?.optBoolean("enabled") ?: d.labels, qobuz?.optBoolean("connected") ?: d.qobuz,
            tidal?.optBoolean("connected") ?: d.tidal, shelf?.optBoolean("enabled") ?: d.shelf)
    }

    /** Offline mode's row, on one line, with On or Off after its name (the owner's wording, item 98). */
    fun offlineSub(on: Boolean): String = "Offline Mode - " + if (on) "On" else "Off"

    /** Under Shut down when the server can't shut itself down (`/api/system/power`'s `shutdown` false); else none. */
    fun powerNote(power: JSONObject?): String = if (power != null && !power.optBoolean("shutdown")) "In Docker: docker stop musicd-server, then docker start musicd-server." else ""

    /** Shut down offered: only when the server can do it (`/api/system/power`), and while that's unknown, as the page starts. */
    fun canShutDown(power: JSONObject?): Boolean = power == null || power.optBoolean("shutdown")

    /**
     * The Rescan row's line (`/api/status`), as the page's refreshRescanSub: how many albums, then what the last check
     * was, every phrase past tense or a schedule (none of it can be a claim about this instant); "" when unknown.
     */
    fun rescanSub(status: JSONObject?, now: Long): String {
        if (status == null) return ""
        if (!status.optBoolean("paired")) return "Server not ready"
        val albums = NumberFormat.getIntegerInstance().format(status.optLong("index_count")) + " albums"
        val built = status.optLong("index_built_at")
        return when {
            status.optBoolean("library_importing") -> "$albums · scanning the music folder now"
            status.optBoolean("library_recheck_pending") -> "$albums · the library moved, checking again shortly"
            built > 0 -> "$albums · checked " + ageText(built, now)
            else -> "No snapshot yet"
        }
    }

    /** How long ago [ms] was, as the page's libraryAgeText: "just now", "5 min ago", "3 hours ago", "4 days ago". */
    fun ageText(ms: Long, now: Long): String {
        val mins = ((now - ms) / 60000.0).roundToLong()
        if (mins < 2) return "just now"
        if (mins < 60) return "$mins min ago"
        val hrs = (mins / 60.0).roundToLong()
        if (hrs < 48) return hrs.toString() + if (hrs == 1L) " hour ago" else " hours ago"
        return (hrs / 24.0).roundToLong().toString() + " days ago"
    }

    /** What a rescan answered, for its toast: the words, whether they are an error, and whether a scan goes on to be waited for. */
    data class Rescan(val text: String, val error: Boolean, val going: Boolean)

    /** `POST /api/library/rescan`'s answer as the page's rescanLibrary says it. */
    fun rescan(j: JSONObject): Rescan {
        val st = j.optString("status")
        val done = st in setOf("rebuilt", "updated", "fresh", "unchanged")
        val going = st in setOf("scanning", "running", "busy")
        val text = when {
            done -> scanDone(j)
            st == "scanning" -> "Scanning in the background — new albums appear as it goes"
            going -> "A scan is already running — you'll hear when it's done"
            st == "no-music" -> NO_MUSIC
            else -> j.optString("error").ifEmpty { "Rescan failed" }
        }
        return Rescan(text, !done && !going, going)
    }

    /** A scan waited for has ended (`/api/status`'s `scan`, no longer running): what it found, or null while it goes on. */
    fun scanEnded(status: JSONObject): Rescan? {
        val scan = status.optJSONObject("scan") ?: return null
        if (scan.optBoolean("running")) return null
        val last = scan.optJSONObject("last") ?: JSONObject()
        if (last.optString("status") == "no-music") return Rescan(NO_MUSIC, true, false)
        val j = JSONObject().put("count", status.opt("index_count"))
        for (k in last.keys()) j.put(k, last.get(k))
        return Rescan(scanDone(j), false, false)
    }

    const val NO_MUSIC = "The music folder isn't there — check the /music mount"

    /** What a finished scan found, as the page's scanDoneText: up to date, or rescanned with the new tracks, then the services next. */
    fun scanDone(j: JSONObject): String {
        val albums = if (j.has("count") && !j.isNull("count")) j.optLong("count") else j.optLong("albums")
        val added = j.optLong("added")
        val st = j.optString("status")
        if (st == "fresh" || st == "unchanged") return "Library already up to date" + (if (albums > 0) " — $albums albums" else "") + servicesNext(j)
        return "Library rescanned — $albums albums" + (if (added > 0) " ($added new " + (if (added == 1L) "track" else "tracks") + ")" else "") + servicesNext(j)
    }

    /** The streaming services the server goes on to, in order: " · now Qobuz, then Tidal". */
    private fun servicesNext(j: JSONObject): String {
        val s = j.optJSONArray("services") ?: return ""
        val names = (0 until s.length()).map { s.optString(it) }
        return if (names.isEmpty()) "" else " · now " + names[0] + names.drop(1).joinToString("") { ", then $it" }
    }
}
