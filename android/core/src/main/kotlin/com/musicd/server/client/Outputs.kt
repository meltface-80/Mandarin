package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * The speakers behind the rooms, typed (the Rooms group of docs/specs/plan-android-native.md,
 * R1; bug list item 68): each output, the room it plays in and what it may join, and the
 * power controls a device has; with the page's words for Group zones and Device power
 * (zone-grouping.js, device-power.js) and for moving what's playing (album-grid.js), so
 * the app's sheets say what the page's do.
 */

/** A device's power control (`source_controls`): its [status] ("selected", "deselected", "standby", "indeterminate") and whether it has standby. */
data class SourceControl(val key: String, val name: String, val status: String, val standby: Boolean) {
    /** The line under its name, as the page's SOURCE_STATUS_LABEL: "" when Roon can't tell. */
    val statusLine: String get() = when (status) {
        "selected" -> "On — this input selected"
        "deselected" -> "On — another input selected"
        "standby" -> "In standby"
        else -> ""
    }
}

/** A speaker, an output of `/api/outputs`: the room it plays in now, the outputs it may join (null: the server doesn't say), its power controls. */
data class Speaker(val id: String, val name: String, val zoneId: String, val zoneName: String, val canGroupWith: List<String>?, val controls: List<SourceControl>) {
    companion object {
        fun list(j: JSONObject): List<Speaker> = objs(j.optJSONArray("outputs")).map { o ->
            Speaker(o.optString("output_id"), o.optString("display_name").ifEmpty { o.optString("output_id") }, o.optString("zone_id"), o.optString("zone_name"),
                o.optJSONArray("can_group_with_output_ids")?.let { a -> (0 until a.length()).map { a.optString(it) } },
                objs(o.optJSONArray("source_controls")).map { c -> SourceControl(c.optString("control_key"), c.optString("display_name"), c.optString("status"), c.optBoolean("supports_standby")) })
        }

        private fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }

        /** Where no speakers answer at all (both sheets' empty word). */
        const val NO_ROOMS = "No Sonos rooms found. The server must share a network with your speakers (host networking), or set SONOS_HOSTS to a speaker's IP."
    }
}

/**
 * Group zones around the room [anchorZone] plays in, as the page's openGroupSheet: the room's own outputs, the first of them
 * the [primary] (its queue is the one kept, so it is always ticked and always sent first), and the outputs it may join.
 */
class Grouping(val all: List<Speaker>, anchorZone: String) {
    val anchorIds: List<String> = if (anchorZone.isEmpty()) emptyList() else all.filter { it.zoneId == anchorZone }.map { it.id }
    val primary: Speaker? = all.firstOrNull { it.id == anchorIds.firstOrNull() }
    /** What the primary may join (an unknown list offers everything: offering nothing would look broken, not limited). */
    val offerable: List<Speaker> = run {
        val allowed = primary?.canGroupWith?.toSet()
        all.filter { it.id in anchorIds || allowed == null || it.id in allowed }
    }

    /** No room to build around: what the sheet says instead of its rows. */
    val emptyNote: String? get() = if (primary != null) null else if (all.isNotEmpty()) "Choose a zone first — grouping needs a zone to build the group around." else Speaker.NO_ROOMS
    /** Some outputs left out, Sonos having said they can't play with the primary. */
    val limitNote: String? get() = if (primary == null || offerable.size >= all.size) null
        else "Outputs your Core can't sync with ${primary.name} aren't listed — Sonos decides which rooms can play together."

    /** The line under [o]'s name: why the primary can't be unticked; the room it would leave. Nothing for this room's own. */
    fun note(o: Speaker): String = when {
        o.id == primary?.id -> "Keeps playing — this group's queue"
        o.id !in anchorIds && o.zoneName.isNotEmpty() && o.zoneName != o.name -> "In ${o.zoneName}"
        else -> ""
    }

    /** What Apply sends for [picked]: the outputs to split off, then the group to make (the primary first), and the outputs the room should end with; null when nothing changed. */
    data class Change(val ungroup: List<String>, val group: List<String>, val want: Set<String>)

    fun change(picked: Set<String>): Change? {
        val p = primary ?: return null
        val remove = anchorIds.filter { it !in picked }
        val add = picked.filter { it !in anchorIds }
        if (remove.isEmpty() && add.isEmpty()) return null
        val kept = anchorIds.filter { it != p.id && it !in remove }
        return Change(remove, if (add.isEmpty()) emptyList() else listOf(p.id) + kept + add, (listOf(p.id) + anchorIds.filter { it !in remove } + add).toSet())
    }

    companion object {
        /** The room that now holds [outputId] in `/api/zones`, and whether its outputs are just [want]: the app follows that room. */
        fun settled(zones: JSONObject, outputId: String, want: Set<String>): Pair<String, Boolean>? {
            val list = zones.optJSONArray("zones") ?: return null
            for (i in 0 until list.length()) {
                val z = list.optJSONObject(i) ?: continue
                val outs = z.optJSONArray("outputs") ?: continue
                val have = (0 until outs.length()).mapNotNull { outs.optJSONObject(it)?.optString("output_id") }.toSet()
                if (outputId in have) return z.optString("zone_id") to (have == want)
            }
            return null
        }
    }
}

/** Device power's words (device-power.js): what it says with no device to switch. */
object DevicePower {
    fun withControls(all: List<Speaker>): List<Speaker> = all.filter { it.controls.isNotEmpty() }
    fun emptyNote(all: List<Speaker>): String = if (all.isNotEmpty()) "None of your devices can be switched on or off from here." else Speaker.NO_ROOMS
}

/** Moving what's playing to the room just chosen (album-grid.js): asked only when the room left was playing an album. */
object RoomMove {
    /** `/api/album/now-playing`'s answer: an album playing there. */
    fun playing(j: JSONObject?): Boolean = j?.optJSONObject("album")?.optString("title").orEmpty().isNotEmpty()
    fun question(from: String, to: String): String = "Move what's playing in $from to $to?"
    fun moved(to: String): String = "Moved to $to"
}
