package com.musicd.server.android

import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.musicd.server.client.NowPlayingView
import com.musicd.server.client.Retry
import com.musicd.server.client.RoomFollowed
import com.musicd.server.client.ServerClient
import com.musicd.server.client.VolumeScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

/*
 * A room followed, for the native screens that show it (Now playing, the
 * mini player): as the notification follows it, each answer waits on the
 * room's next change (the server holds it up to 20 s), and between answers
 * the clock moves the track on. Nothing is drawn here (the screens contract's
 * shell, docs/specs/screens.json).
 */

/** What the room is doing, as last answered. */
internal class RoomState {
    /** The track playing there, null while nothing is (or before the first answer). */
    var view by mutableStateOf<NowPlayingView?>(null)
    /** The room's name, once the server has answered. */
    var zoneName by mutableStateOf<String?>(null)
    /** The room's volume, from its first speaker that has one; null: fixed. */
    var volume by mutableStateOf<VolumeScale?>(null)
    var muted by mutableStateOf(false)
    /** The server has answered at least once. */
    var answered by mutableStateOf(false)
    /** The clock, moved on twice a second while the track plays. */
    var now by mutableLongStateOf(System.currentTimeMillis())
}

/**
 * Each room's state as last answered, kept while the app runs (bug list item 113): every screen draws its mini player,
 * and a screen opened started from nothing, so the bar was drawn without its cover and room line for a moment, a little
 * shorter, then grew back: moving between screens, it moved. Now a screen starts from what the last one knew.
 */
private val kept = HashMap<String, RoomState>()

/**
 * The room of the screen opened in [zoneId], followed while this is on screen; its state the one kept for it, so a new
 * screen starts as the last left it. Offline that room is the phone's, the one room there, kept as the phone's own; and
 * while the server is still looked for as the app comes back on screen, the screen's own, as the server last told it and
 * not asked for ([RoomFollowed], item 485: the phone's own queue was shown, and kept, as the server's room's).
 */
@Composable
internal fun followRoom(zoneId: String, client: () -> ServerClient?): RoomState {
    val offline = OfflineNow.kind.value != null
    val followed = RoomFollowed.of(zoneId, offline, OfflineNow.looking.value, OfflineNow.phone)
    val id = followed.id
    val room = remember(id) { kept.getOrPut(id) { RoomState() } }
    // Followed while the app is on screen (item 120: it was all night too, beside the notification's own following);
    // back on screen, asked for at once. Asked afresh too when the phone's answers give way to the server's or the
    // server's to the phone's (item 485: a room waited on the phone's answer, held 20 s, after the server was back).
    val onScreen by NativeShell.onScreen
    LaunchedEffect(followed, offline, onScreen) {
        if (!followed.ask || !onScreen) return@LaunchedEffect
        var revision: Long? = null
        var missed = 0
        while (isActive) {
            val c = client()
            val st = if (c == null) null else withContext(Dispatchers.IO) { runCatching { c.zoneState(id, revision) }.getOrNull() }
            // Not answered (the server away, or a room it won't offer: a Sonos room away from home): asked again less
            // and less often, 2 s up to half a minute (item 119: it was every 2 s for as long as the screen was up).
            if (st == null) { delay(Retry.ms(++missed)); continue }
            missed = 0
            revision = st.revision
            room.zoneName = st.zone?.name
            room.volume = st.zone?.outputs?.firstNotNullOfOrNull { it.scale }
            room.muted = st.zone?.outputs?.any { it.muted } ?: false
            room.view = NowPlayingView.of(st, System.currentTimeMillis())
            room.answered = true
        }
    }
    LaunchedEffect(room.view) {
        room.now = System.currentTimeMillis()
        while (room.view?.playing == true) { delay(500); room.now = System.currentTimeMillis() }
    }
    return room
}

/** The cover [key] at [size] pixels, once fetched; null until then, or with no key. */
@Composable
internal fun rememberCover(key: String?, size: Int, client: () -> ServerClient?): ImageBitmap? = rememberTileCover(key, size, client)

/**
 * The picture at [url] on the server, once fetched; null until then, or with no address. Kept as the tiles' covers are
 * (Covers), so a screen opened draws a picture already fetched at once, rather than a moment later (item 113).
 */
@Composable
internal fun rememberImage(url: String?, client: () -> ServerClient?): ImageBitmap? {
    var image by remember(url) { mutableStateOf(url?.let { Covers.get(it) }) }
    LaunchedEffect(url) {
        val c = client() ?: return@LaunchedEffect
        if (url == null || image != null) return@LaunchedEffect
        val got = withContext(Dispatchers.IO) {
            runCatching { c.bytes(url).let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull()
        }
        if (got != null) { Covers.put(url, got); image = got }
    }
    return image
}
