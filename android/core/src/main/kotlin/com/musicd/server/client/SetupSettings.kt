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

/** A service or a review site the share card can link to, and whether it is on. */
data class LinkToggle(val id: String, val name: String, val on: Boolean)

/** What the share card links to (/api/settings/share-links): the services and the review sites, each on or off, and whether the card carries the review. */
data class ShareLinkSettings(val services: List<LinkToggle>, val reviews: List<LinkToggle>, val cardReview: Boolean) {
    /** The services switched on: the default's choices. */
    val onServices: List<LinkToggle> get() = services.filter { it.on }

    companion object {
        fun parse(j: JSONObject): ShareLinkSettings {
            fun group(o: JSONObject?): List<LinkToggle> {
                val on = o?.optJSONArray("enabled")?.let { a -> (0 until a.length()).map { a.optString(it) }.toSet() } ?: emptySet()
                val all = o?.optJSONArray("all") ?: return emptyList()
                return (0 until all.length()).mapNotNull { all.optJSONObject(it) }.map { x ->
                    // The chip's words where it has them, as the row it controls reads ("AllMusic artist").
                    val words = x.optString("chip").takeIf { it.isNotEmpty() && !x.isNull("chip") } ?: x.optString("name")
                    LinkToggle(x.optString("id"), words, x.optString("id") in on)
                }
            }
            return ShareLinkSettings(group(j.optJSONObject("services")), group(j.optJSONObject("reviews")), !(j.optJSONObject("card")?.let { it.has("review") && it.opt("review") == false } ?: false))
        }

        /** What is said under the card's Review switch. */
        fun reviewNote(on: Boolean): String = if (on) "On. The card carries the write-up about the album under the cover." else "Off. The card shows the cover, title, artist and year — no write-up."
    }
}

/** The server's built-in Tailscale (/api/tailscale), as Away from home shows it. */
data class AwayState(val available: Boolean, val enabled: Boolean, val state: String, val serving: Boolean, val online: Boolean?, val health: List<String>,
                     val dnsName: String, val address: String, val hostname: String, val authUrl: String, val error: String) {
    /** Its status in words; "off" while switched off. */
    val status: String get() = when (if (!enabled) "off" else state) {
        "off" -> "Off"; "Stopped", "Starting", "NoState" -> "Starting…"; "Downloading" -> "Getting Tailscale…"; "NeedsLogin" -> "Not signed in yet"
        "NeedsMachineAuth" -> "Waiting for approval in the Tailscale admin console"; "Running" -> if (serving) "Connected" else "Connecting…"; else -> state
    }
    val running: Boolean get() = enabled && state == "Running"
    /** Tailscale's own word that something is wrong while it runs, or none. */
    val warning: String? get() = if (!running) null else if (online == false) "Running, but not online on the tailnet — the server is rebinding it, then starting it afresh"
        else if (health.isNotEmpty()) "Tailscale warns: " + health.joinToString("; ") else null
    /** The address without its scheme, as the page writes it. */
    val shownAddress: String get() = address.removePrefix("http://")

    /** The help behind the note once connected: how the app, and anything else, reaches it. */
    fun connectedInfo(inApp: Boolean): String = "The Mandarin app on your Android phone uses it by itself away from home (after being home once, to learn the address); sign the phone in to Tailscale " +
        (if (inApp) "under This phone below" else "in the app, under Settings → Setup → Away from home") + ". Anything else with Tailscale — an iPhone, a laptop — opens " + address.ifEmpty { "the address above" } + "."
    val signInInfo: String get() = "Opens Tailscale’s sign-in page. The server then joins your tailnet as “$hostname” — nothing else to install. Free for personal use."

    companion object {
        const val UNREACHABLE = "Couldn’t ask the server."
        const val UNAVAILABLE = "Tailscale can’t be built in here — it runs in the Docker image (Linux, x64 or ARM64). Tailscale on the machine the server runs on works as before."
        const val PHONE_INFO = "The app has its own Tailscale — no Tailscale app needed. Sign it in once, with the same account as the server; away from home the app then reaches the server by itself."

        fun parse(j: JSONObject): AwayState {
            fun str(k: String) = if (j.isNull(k)) "" else j.optString(k)
            val h = j.optJSONArray("health")
            return AwayState(j.optBoolean("available"), j.optBoolean("enabled"), str("state"), j.optBoolean("serving"),
                if (j.has("online") && !j.isNull("online")) j.optBoolean("online") else null, if (h == null) emptyList() else (0 until h.length()).map { h.optString(it) },
                str("dns_name"), str("address"), str("hostname"), str("auth_url"), str("error"))
        }
    }
}

