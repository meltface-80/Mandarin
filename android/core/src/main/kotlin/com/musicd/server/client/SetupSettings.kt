package com.musicd.server.client

import org.json.JSONObject

/*
 * Setup's small pages of Settings, typed (the group T of docs/specs/plan-android-native.md, T2; bug list item 78):
 * Smart Picks, Record labels, UI Settings, Wall Display and Shelf, with what each list offers and what the page says
 * (settings-views.js, settings-home.js, settings-services.js, settings-ui.js, features.js). What is kept on the server
 * is asked for and saved there; what the page keeps on this device (the UI Settings, a label's order and minimum) is
 * handed to the page, which keeps it, and read back with its prefs ([WallPrefs]).
 */

/** One of a list's choices: its value, and the words it shows. */
data class Choice(val value: String, val words: String)

object SetupSettings {
    /** The text sizes a phone is offered (+75% and +100% are a desktop's). */
    val TEXT = listOf(Choice("1", "Normal"), Choice("1.1", "+10%"), Choice("1.25", "+25%"), Choice("1.5", "+50%"))
    val LAYOUT = listOf(Choice("auto", "Auto"), Choice("3", "3 columns"), Choice("2", "2 columns"), Choice("list", "List"))
    val TILE = listOf(Choice("0.5", "−50%"), Choice("0.75", "−25%"), Choice("0.9", "−10%"), Choice("1", "Normal"), Choice("1.1", "+10%"), Choice("1.25", "+25%"), Choice("1.5", "+50%"))
    val LABEL_ORDER = listOf(Choice("alpha", "Alphabetical"), Choice("random", "Random"))
    val LABEL_MIN = listOf(Choice("1", "Show all"), Choice("2", "2 or more"), Choice("5", "5 or more"), Choice("10", "10 or more"))
    /** The hours the day's picks can be built at: 00:00 to 23:00. */
    val HOURS = (0 until 24).map { Choice(it.toString(), (if (it < 10) "0$it" else "$it") + ":00") }

    /** A multiplier as the page's list has it: 1.0 is "1", 1.25 is "1.25". */
    fun num(d: Double): String = if (d % 1.0 == 0.0) d.toLong().toString() else d.toString()

    /** What [prefs] says for one of UI Settings' lists ([key]: "text", "title", "menu", "layout", "tile"). */
    fun uiValue(prefs: WallPrefs, key: String): String = when (key) {
        "text" -> num(prefs.text); "title" -> num(prefs.title); "menu" -> num(prefs.menu); "layout" -> prefs.layout; else -> num(prefs.tile)
    }

    /** The page's prefs as JSON ([json]: as it last handed them, or none) with [name] now [value], for the native screens to draw to. */
    fun prefsWith(json: String?, name: String, value: String): String =
        (runCatching { JSONObject(json ?: "{}") }.getOrNull() ?: JSONObject()).put(name, value).toString()

    /** What is said under Record labels: how many labels and logos while on, how many albums carry one either way. */
    fun labelsNote(j: JSONObject): String {
        val tagged = j.optInt("tagged"); val untagged = j.optInt("untagged"); val lookedUp = j.optInt("looked_up")
        val count = j.optInt("count"); val on = j.optBoolean("enabled"); val scanning = j.optBoolean("scanning")
        val have = "$tagged album" + (if (tagged == 1) "" else "s") + " name" + (if (tagged == 1) "s" else "") + " a label in " + (if (tagged == 1) "its" else "their") + " tags" +
            (if (lookedUp > 0) ", $lookedUp " + (if (lookedUp == 1) "has" else "have") + " one looked up" else "") + "; " +
            "$untagged " + (if (untagged == 1) "has" else "have") + " none" + (if (on && untagged > 0 && !scanning && lookedUp == 0) " (MusicBrainz and Discogs didn't know them)" else "") + "."
        val logos = if (count == 0) "" else if (scanning) " Looking up labels and logos now…"
            else if (j.optBoolean("discogs") || j.optBoolean("fanart")) " ${j.optInt("logos")} logo" + (if (j.optInt("logos") == 1) "" else "s") + "."
            else " Logos need a Discogs token or a FanArt.tv key (Settings → Setup → API Keys)."
        return if (!on) "Off. $have"
            else if (count > 0) "$count label" + (if (count == 1) "" else "s") + ". " + have + logos
            else "No labels yet: none of the albums' files carry a LABEL tag."
    }

    /** What Force rescan's answer says: the labels re-read at once (and how many), or a full rescan started. */
    fun rescanSaid(j: JSONObject): String = if (j.has("started") && !j.optBoolean("started", true)) {
        "Labels re-read from the library's tags and folders" + (if (j.has("count") && !j.isNull("count")) j.optInt("count").let { ": $it label" + (if (it == 1) "" else "s") + "." } else ".")
    } else "Full rescan started — this may take several minutes. Label data will update as results come in."

    /** Force rescan's own words once answered: "Done" when re-read at once, else "Rescan started". */
    fun rescanWord(j: JSONObject): String = if (j.has("started") && !j.optBoolean("started", true)) "Done" else "Rescan started"

    /** Under the folder depth: what is used. */
    fun depthStatus(depth: Int): String = if (depth > 0) "Using folder depth $depth" else "Off — using file label tags"

    /** What Smart Picks' switch says once saved. */
    fun picksSaid(on: Boolean): String = if (on) "Smart Picks on — the first set builds at the scheduled hour" else "Smart Picks off — nothing runs in the background"
    fun hourSaid(hour: Int): String = "Smart Picks will build at " + (if (hour < 10) "0$hour" else "$hour") + ":00"
}
