package com.musicd.server.android

import android.graphics.BitmapFactory
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Album
import com.musicd.server.client.AlbumExtras
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.ServerClient
import com.musicd.server.client.albumLength
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * An album's page, natively (stage N3 of docs/specs/plan-android-native.md, a
 * preview: Settings → Setup → UI Settings), as the page's sleeve has it
 * (docs/specs/screens.json, album): the 160px cover with the title, the
 * artists, the date and its label and the rate and length beside it, the
 * cover's glow behind; the heart, Play Now, Queue and ⋯; the tracks. Its
 * buttons play in [zoneId], the room the page had chosen, or the one chosen
 * since on the mini player's Play on ([onRoom] tells the page). The mini
 * player sits at its foot as the page's does; its tap opens Now playing
 * ([onNowPlaying], with the room). What the page does with its own sheets
 * (Share card, Add to playlist, Edit album) and screens (an artist's, a
 * label's) it is asked for ([onPage]).
 */
@Composable
internal fun AlbumScreen(offset: Long, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onPage: (String, String?) -> Unit,
                         onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var zone by remember(offset) { mutableStateOf(zoneId) }
    var album by remember(offset) { mutableStateOf<Album?>(null) }
    var extras by remember(offset) { mutableStateOf<AlbumExtras?>(null) }
    var failed by remember(offset) { mutableStateOf<String?>(null) }
    var favourite by remember(offset) { mutableStateOf(false) }
    var later by remember(offset) { mutableStateOf(false) }
    BackHandler(onBack = onBack)

    LaunchedEffect(offset) {
        val c = client() ?: return@LaunchedEffect
        val lib = LibraryClient { c.getJson(it) }
        withContext(Dispatchers.IO) { runCatching { lib.album(offset) } }
            .onSuccess { album = it; favourite = it.album.favourite; later = it.album.later }
            .onFailure { failed = it.message ?: "Couldn't load the album" }
        val a = album ?: return@LaunchedEffect
        extras = withContext(Dispatchers.IO) { runCatching { lib.albumExtras(a.album.title, a.album.subtitle) }.getOrNull() }
    }
    val key = album?.album?.imageKey
    var cover by remember(key) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(key) {
        val c = client() ?: return@LaunchedEffect
        if (key == null) return@LaunchedEffect
        cover = withContext(Dispatchers.IO) { runCatching { c.bytes(c.imageUrl(key, 640)).let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull() }
    }
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    // To the room: what came of it said as the page says it.
    fun play(said: String, block: (ServerClient) -> JSONObject?) {
        val c = client() ?: return
        if (zone.isEmpty()) { toast("Pick a zone first"); return }
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { block(c) } }
            toast(r.exceptionOrNull()?.message ?: said)
        }
    }
    fun mark(block: (ServerClient) -> Unit) {
        val c = client() ?: return
        scope.launch { withContext(Dispatchers.IO) { runCatching { block(c) } }.exceptionOrNull()?.let { toast(it.message ?: "Couldn't reach the server") } }
    }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize()) {
            // The cover's colours washing the top of the page, as the page's glow does (a blur from Android 12).
            cover?.let {
                Image(it, contentDescription = null, contentScale = ContentScale.Crop,
                    modifier = Modifier.parity("album.glow").fillMaxWidth().height(420.dp).alpha(0.26f).let { m -> if (Build.VERSION.SDK_INT >= 31) m.blur(40.dp) else m })
            }
            // The foot keeps room for the mini player, as the page's does.
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 18.dp), contentPadding = PaddingValues(bottom = 118.dp)) {
                item {
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onBack, modifier = Modifier.parity("album.back", Contract.label("album.back"))) {
                            Text("‹", fontSize = 32.sp, color = MaterialTheme.colorScheme.onSurface)
                        }
                        Spacer(Modifier.weight(1f))
                        IconButton(onClick = { onPage("album-share", offset.toString()) }, enabled = album != null,
                            modifier = Modifier.parity("album.share", Contract.label("album.share"))) {
                            Icon(painterResource(R.drawable.np_share), contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
                val a = album
                if (a == null) {
                    item { Text(failed ?: "Loading…", Modifier.parity("album.notice").padding(vertical = 24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    return@LazyColumn
                }
                item {
                    // The sleeve, and its head beside it, a line each, at its foot.
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        Box(Modifier.parity("album.cover").size(160.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
                            cover?.let { Image(it, contentDescription = a.album.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                        }
                        Column(Modifier.weight(1f)) {
                            Text(a.album.title, Modifier.parity("album.title"), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 3, overflow = TextOverflow.Ellipsis)
                            Row {
                                (a.artists.ifEmpty { listOf(a.album.subtitle) }).forEachIndexed { i, name ->
                                    Text(if (i > 0) " · $name" else name, Modifier.parity("album.artist", Contract.label("album.artist", 0, name)).clickable { onPage("artist", name) },
                                        color = MaterialTheme.colorScheme.secondary, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            DateLine(extras, onPage)
                            FactsLine(a)
                        }
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth().padding(vertical = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        IconButton(onClick = { favourite = !favourite; val on = favourite; mark { it.favourite(offset, on) } },
                            modifier = Modifier.parity("album.favourite", Contract.label("album.favourite", if (favourite) 1 else 0)).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)) {
                            Text(if (favourite) "♥" else "♡", fontSize = 20.sp, color = if (favourite) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        val brass = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary)
                        Button(onClick = { play("Playing") { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, "play_now") } }, colors = brass,
                            modifier = Modifier.parity("album.play-now", Contract.label("album.play-now")).weight(1f)) { Text(Contract.label("album.play-now")) }
                        Button(onClick = { play("Queued") { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, "queue") } }, colors = brass,
                            modifier = Modifier.parity("album.queue", Contract.label("album.queue")).weight(1f)) { Text(Contract.label("album.queue")) }
                        MoreMenu(a, later, onLater = { later = !later; val on = later; mark { it.listenLater(offset, on) } },
                            onPlay = { kind, said -> play(said) { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, kind) } }, onPage = onPage)
                    }
                }
                albumTracks(a, onPlay = { i, kind, said -> play("$said: ${a.tracks[i].title}") { it.playTrack(offset, i, a.tracks[i].title, a.album.title, a.album.subtitle, zone, kind) } })
            }
            MiniPlayer(zone, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage, modifier = Modifier.align(Alignment.BottomCenter))
        }
    }
}

/** The release date, its label (a tap: the label's albums) and the score after it; nothing until the extras come. */
@Composable
private fun DateLine(extras: AlbumExtras?, onPage: (String, String?) -> Unit) {
    val e = extras ?: return
    val date = e.date()
    if (date.isEmpty() && e.label == null && e.scoreText == null) return
    Row(Modifier.parity("album.date").padding(top = 3.dp)) {
        val dim = MaterialTheme.colorScheme.onSurfaceVariant
        Text(date, color = dim, fontSize = 14.sp)
        e.label?.let { label ->
            if (date.isNotEmpty()) Text(" · ", color = dim, fontSize = 14.sp)
            Text(label, Modifier.parity("album.label", Contract.label("album.label", 0, label)).clickable { onPage("label", label) },
                color = MaterialTheme.colorScheme.secondary, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        e.scoreText?.let { Text(" · $it" + if (e.bestNewMusic) " BNM" else "", color = dim, fontSize = 14.sp) }
    }
}

/** The rate (hi-res in brass) and the album's length. */
@Composable
private fun FactsLine(a: Album) {
    val length = albumLength(a.tracks)
    Row(Modifier.parity("album.facts").padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        a.album.quality?.let {
            val c = if (a.album.hires) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant
            Text(it, Modifier.border(1.dp, c, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 1.dp), color = c, fontSize = 12.sp)
        }
        if (length.isNotEmpty()) Text((if (a.album.quality != null) "  · " else "") + length, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
    }
}

/**
 * ⋯: what the server offers beyond Play Now and Queue (Play Next, Shuffle,
 * Radio), Listen later, and the page's own Add to playlist and Edit album.
 */
@Composable
private fun MoreMenu(a: Album, later: Boolean, onLater: () -> Unit, onPlay: (String, String) -> Unit, onPage: (String, String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val kinds = a.actions.map { it.kind }.toSet()
    val offset = a.album.offset.toString()
    Box {
        IconButton(onClick = { open = !open }, modifier = Modifier.parity("album.more", Contract.label("album.more")).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)) {
            Text("⋯", fontSize = 20.sp, color = MaterialTheme.colorScheme.onSurface)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if ("play_next" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.play-next")) }, modifier = Modifier.parity("album.play-next", Contract.label("album.play-next")),
                onClick = { open = false; onPlay("play_next", "Playing next") })
            if ("shuffle" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.shuffle")) }, modifier = Modifier.parity("album.shuffle", Contract.label("album.shuffle")),
                onClick = { open = false; onPlay("shuffle", "Shuffling") })
            if ("radio" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.radio")) }, modifier = Modifier.parity("album.radio", Contract.label("album.radio")),
                onClick = { open = false; onPlay("radio", "Radio") })
            DropdownMenuItem(text = { Text(Contract.label("album.later", if (later) 1 else 0)) }, modifier = Modifier.parity("album.later", Contract.label("album.later", if (later) 1 else 0)),
                onClick = { open = false; onLater() })
            DropdownMenuItem(text = { Text(Contract.label("album.playlist")) }, modifier = Modifier.parity("album.playlist", Contract.label("album.playlist")),
                onClick = { open = false; onPage("album-playlist", offset) })
            if (a.album.source == null || a.album.source == "local") DropdownMenuItem(text = { Text(Contract.label("album.edit")) },
                modifier = Modifier.parity("album.edit", Contract.label("album.edit")), onClick = { open = false; onPage("album-edit", offset) })
        }
    }
}
