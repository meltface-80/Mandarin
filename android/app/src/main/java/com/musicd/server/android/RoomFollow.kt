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

/** The room [zoneId] followed while this is on screen; a new state for a new room. */
@Composable
internal fun followRoom(zoneId: String, client: () -> ServerClient?): RoomState {
    val room = remember(zoneId) { RoomState() }
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

/** The picture at [url] on the server, once fetched; null until then, or with no address. */
@Composable
internal fun rememberImage(url: String?, client: () -> ServerClient?): ImageBitmap? {
    var image by remember(url) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(url) {
        val c = client() ?: return@LaunchedEffect
        if (url == null) return@LaunchedEffect
        image = withContext(Dispatchers.IO) {
            runCatching { c.bytes(url).let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull()
        }
    }
    return image
}
