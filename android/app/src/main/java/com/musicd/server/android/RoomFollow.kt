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

/** The room [zoneId] followed while this is on screen; its state the one kept for it, so a new screen starts as the last left it. */
@Composable
internal fun followRoom(zoneId: String, client: () -> ServerClient?): RoomState {
    val room = remember(zoneId) { kept.getOrPut(zoneId) { RoomState() } }
    LaunchedEffect(zoneId) {
        if (zoneId.isEmpty()) return@LaunchedEffect
        var revision: Long? = null
        while (isActive) {
            val c = client()
            val st = if (c == null) null else withContext(Dispatchers.IO) { runCatching { c.zoneState(zoneId, revision) }.getOrNull() }
            if (st == null) { delay(2000); continue }
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
internal fun rememberCover(key: String?, size: Int, client: () -> ServerClient?): ImageBitmap? =
    rememberImage(key?.let { k -> client()?.imageUrl(k, size) }, client)

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
