package com.musicd.server.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.musicd.server.client.AlbumExtras
import com.musicd.server.client.NowPlayingView
import com.musicd.server.client.QueueItem
import com.musicd.server.client.Review
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShelfCase
import com.musicd.server.client.ShelfMore
import com.musicd.server.client.ShelfPlaying
import com.musicd.server.client.ShelfTracks
import com.musicd.server.client.ShelfZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * Playing from the native Shelf (bug list item 207; the page's shelf-player.js, shelf-back.js, shelf-about.js and
 * shelf-queue.js): the zone it plays in (the room the app's screens play in), the album in front or the tracks chosen on
 * the album view sent to it, the album view's tracks and its review and the artist's other albums read once each, and the
 * queue read while its pane is open. Nothing is drawn here.
 */
internal class ShelfPlay(private val shelf: ShelfControl, private val client: () -> ServerClient?, private val scope: CoroutineScope) {
    /** The zone played in, and its name once the server has said. */
    var zone by mutableStateOf(""); private set
    var zones by mutableStateOf<List<ShelfZone>>(emptyList()); private set
    /** Mandarin answered about the zones, so "none" means none. */
    var zonesRead by mutableStateOf(false); private set

    /** The album view's tracks, by album id: read, or what went wrong ("…" while being read). */
    val tracks = mutableStateMapOf<Long, ShelfTracks>()
    val trackTrouble = mutableStateMapOf<Long, String>()
    /** Its review and the artist's other albums, by album id, once read (both may be missing). */
    val reviews = mutableStateMapOf<Long, Review?>()
    val more = mutableStateMapOf<Long, ShelfMore>()
    /** The tracks chosen on the album open ([pickedOn]'s), the last one chosen first for a run. */
    var picks by mutableStateOf<Set<Int>>(emptySet()); private set
    var pickedOn by mutableStateOf<Long?>(null); private set
    private var busy = false

    /** The queue, while its pane is open: its tracks, what it says instead, and the one offering Play from here. */
    var queueOpen by mutableStateOf(false)
    var queue by mutableStateOf<List<QueueItem>>(emptyList()); private set
    var queueSaid by mutableStateOf(""); private set
    var armed by mutableStateOf<Long?>(null)

    /** The zone the screen was opened in ([wanted]: the app's room, or none). */
    fun start(wanted: String) { zone = wanted; readZones(wanted.ifEmpty { null }) }

    /** The zones read; with none chosen yet (or one gone), one picked as the page picks it. */
    fun readZones(wanted: String? = null, then: () -> Unit = {}) {
        scope.launch {
            val c = client() ?: return@launch
            val got = withContext(Dispatchers.IO) { runCatching { ShelfZone.list(c.getJson("/api/zones")) }.getOrNull() }
            if (got == null) { if (zones.isEmpty()) shelf.say("Mandarin didn’t answer. Try again in a moment."); return@launch }
            zones = got; zonesRead = true
            if (zone.isEmpty() || got.none { it.id == zone }) ShelfZone.pick(got, wanted ?: zone.ifEmpty { null })?.let { zone = it.id }
            then()
        }
    }

    /** A zone chosen from the list: the room the app's screens play in too. */
    fun choose(id: String) { zone = id; NativeShell.roomChosen(id); if (queueOpen) readQueue() }

    private fun send(what: String, block: suspend (ServerClient) -> Unit) {
        val c = client() ?: run { shelf.say("Mandarin didn’t answer. Try again."); return }
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { block(c) } }
            r.exceptionOrNull()?.let { e -> shelf.say((e as? ServerClient.ServerException)?.message?.takeIf { !it.startsWith("HTTP") } ?: what) }
        }
    }

    /** Play/pause, previous and next, to the zone in the bar. */
    fun control(command: String) { if (zone.isNotEmpty()) send("That didn’t work. Try again.") { it.control(zone, command) } }

    /** The zone's volume to [value] on its own scale; or, with none, a step [direction] (the page's relative step). */
    fun volumeTo(value: Double) { if (zone.isNotEmpty()) send("That didn’t work. Try again.") { it.zoneVolume(zone, value) } }
    fun volumeStep(direction: Int, step: Double) {
        if (zone.isNotEmpty()) send("That didn’t work. Try again.") { it.post("/api/volume", JSONObject().put("zone_or_output_id", zone).put("value", direction * step).put("how", "relative")) }
    }

    /** A zone to play in, or the zone list asked for ([openZones]) and false. */
    private fun needZone(openZones: () -> Unit): Boolean {
        if (zone.isNotEmpty()) return true
        shelf.say("Choose a zone to play in first"); openZones()
        return false
    }

    private fun zoneName(): String = zones.firstOrNull { it.id == zone }?.name.orEmpty()

    /** The album [a] to the zone: played now, or queued. */
    fun playAlbum(a: ShelfCase, kind: String, openZones: () -> Unit) {
        if (!needZone(openZones)) return
        val c = client() ?: return
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { c.playAlbum(a.offset, a.title, a.artist, zone, kind) } }
            val e = r.exceptionOrNull() as? ServerClient.ServerException
            when {
                r.isSuccess -> shelf.say(ShelfPlaying.albumSaid(kind, a.title, zoneName()))
                e?.status == 404 || e?.status == 409 -> { shelf.say("That album isn’t in your library any more"); shelf.load() }
                e != null -> shelf.say(e.message?.takeIf { !it.startsWith("HTTP") } ?: "That didn’t work. Try again.")
                else -> shelf.say("Mandarin didn’t answer. Try again.")
            }
            if (queueOpen) { delay(1200); readQueue() }
        }
    }

    // ---- The album view ---------------------------------------------------------------------------------------------
    /** Its tracks, its review and the artist's other albums read, once each, for [a] (none while the shelf flies past). */
    fun read(a: ShelfCase) {
        val c = client() ?: return
        if (a.offset !in tracks && trackTrouble[a.offset] == null) scope.launch {
            trackTrouble[a.offset] = "Reading the track list…"
            val r = withContext(Dispatchers.IO) { runCatching { ShelfTracks.parse(c.getJson("/api/album?offset=${a.offset}")) } }
            r.getOrNull()?.let { tracks[a.offset] = it; trackTrouble.remove(a.offset) } ?: run {
                val e = r.exceptionOrNull() as? ServerClient.ServerException
                trackTrouble[a.offset] = if (e?.status == 409 || e?.status == 404) "This album isn’t in your library any more." else "The track list couldn’t be read."
                // Shown, then forgotten, so the next opening asks again.
                delay(4000); trackTrouble.remove(a.offset)
            }
        }
        if (a.offset !in more) scope.launch {
            val q = "title=" + enc(a.title) + "&artist=" + enc(a.artist)
            val extras = withContext(Dispatchers.IO) { runCatching { AlbumExtras.parse(c.getJson("/api/album/extras?$q")) }.getOrNull() }
            val others = withContext(Dispatchers.IO) { runCatching { ShelfMore.parse(c.getJson("/api/album/more?$q"), a.artist) }.getOrNull() }
            reviews[a.offset] = extras?.review
            more[a.offset] = others ?: ShelfMore(a.artist, emptyList())
            // One that couldn't be read is asked again the next time the album opens.
            if (extras == null || others == null) { delay(4000); more.remove(a.offset); reviews.remove(a.offset) }
        }
    }

    /** Track [i] of [a] chosen ([on] true), taken back (false), or either (null); the last taken back ends the choosing. */
    fun pick(a: ShelfCase, i: Int, on: Boolean?) {
        val cur = if (pickedOn == a.offset) picks else emptySet()
        val want = on ?: (i !in cur)
        val next = if (want) cur + i else cur - i
        pickedOn = if (next.isEmpty()) null else a.offset
        picks = next
    }

    fun endPicks() { picks = emptySet(); pickedOn = null }

    /**
     * The chosen tracks to the zone, one request each (as the remote's album view sends a selection): Play now plays the
     * first and queues the rest behind it, Play next sends them last to first so they land in album order.
     */
    fun playPicks(a: ShelfCase, kind: String, openZones: () -> Unit) {
        if (busy || pickedOn != a.offset || picks.isEmpty()) return
        val st = tracks[a.offset] ?: run { shelf.say("Turn the case over again to read its tracks."); endPicks(); return }
        if (!needZone(openZones)) return
        val c = client() ?: return
        busy = true
        val order = ShelfPlaying.sendOrder(picks, kind)
        scope.launch {
            val sent = ArrayList<Int>(); var why = ""; var stale = false
            for ((k, i) in order.withIndex()) {
                val t = st.titles.getOrNull(i) ?: continue
                if (order.size > 3) shelf.say("Adding track ${k + 1} of ${order.size}…")
                val body = JSONObject().put("offset", a.offset).put("track", i).put("title", t).put("zone_or_output_id", zone)
                    .put("kind", ShelfPlaying.kindFor(kind, sent.size)).put("only", true)
                val r = withContext(Dispatchers.IO) { runCatching { c.post("/api/play-track", body) } }
                if (r.isSuccess) { sent += i; continue }
                val e = r.exceptionOrNull() as? ServerClient.ServerException
                if (e == null) { why = "Mandarin didn’t answer."; break }
                if (e.status == 404 || e.status == 409) { why = "This album’s tracks have changed — open the album again."; tracks.remove(a.offset); stale = true; break }
                if (why.isEmpty()) why = e.message?.takeIf { !it.startsWith("HTTP") } ?: "A track couldn’t be played."
            }
            busy = false
            if (stale) endPicks()
            if (sent.isEmpty()) { shelf.say(why.ifEmpty { "That didn’t work. Try again." }); return@launch }
            shelf.say(ShelfPlaying.tracksSaid(kind, sent.size, order.size, zoneName(), why))
            // What went is done with; what didn't stays chosen, to try again.
            if (pickedOn == a.offset) { picks = picks - sent.toSet(); if (picks.isEmpty()) pickedOn = null }
            if (queueOpen) { delay(1200); readQueue() }
        }
    }

    // ---- The queue --------------------------------------------------------------------------------------------------
    /** Read while its pane is open: the zone's queue, or what is said instead. */
    fun readQueue() {
        if (!queueOpen) return
        if (zone.isEmpty()) { queue = emptyList(); queueSaid = if (!zonesRead) "Reading the queue…" else if (zones.isNotEmpty()) "Choose a zone in the player below to see its queue." else "No zones found."; return }
        val c = client() ?: return
        val z = zone
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { c.queue(z) } }
            if (!queueOpen || z != zone) return@launch
            r.getOrNull()?.let { queue = it.items; queueSaid = if (it.items.isEmpty()) "Nothing is queued." else "" } ?: run {
                val e = r.exceptionOrNull() as? ServerClient.ServerException
                if (queue.isNotEmpty() && e?.status != 404) return@launch   // a blip under a list shown: kept
                queue = emptyList(); queueSaid = if (e?.status == 404) "That zone isn’t there any more." else "The queue couldn’t be read."
            }
        }
    }

    /** The queue plays on from [item]. */
    fun playFrom(item: QueueItem) {
        val c = client() ?: return
        val z = zone
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { c.playFromHere(z, item.id) } }
            shelf.say(if (r.isSuccess) "Playing from ${item.title.ifEmpty { "here" }}" else "That didn’t work. Try again.")
            armed = null
            delay(600); readQueue()
        }
    }

    /** The playing record brought to the front of the shelf, where it is on it ([view]: what the zone plays). */
    fun toPlaying(view: NowPlayingView?) {
        if (zone.isEmpty()) { shelf.say("Choose a zone to play in first"); return }
        if (view == null) { shelf.say("Nothing is playing"); return }
        if (view.album.isEmpty()) { shelf.say("What’s playing isn’t an album on this shelf"); return }
        val i = ShelfPlaying.index(shelf.list, view.albumId, view.album, view.artist)
        if (i < 0) { shelf.say("The playing record isn’t on this shelf"); return }
        shelf.bringTo(i)
    }

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")
}
