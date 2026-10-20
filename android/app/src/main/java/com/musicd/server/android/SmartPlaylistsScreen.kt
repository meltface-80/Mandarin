package com.musicd.server.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SmartPlaylist
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The Dynamic Playlists screen, natively (the Playlists group of docs/specs/plan-android-native.md, P3; bug list item 66),
 * drawn as the page's (docs/specs/screens.json, smart-playlists; smart-playlists.js showSmartPlaylists): the heading with
 * the bar's Back, New Dynamic Playlist as the first tile (the page's sheet, then its Focus, over this screen), then each
 * saved one as a tile with its covers' mosaic, its name and its view in a line; the banner while there are none; the mini
 * player and the row along the foot. The list is read again each time it comes back, and when the page's sheet closes.
 */
@Composable
internal fun SmartPlaylistsScreen(prefs: WallPrefs, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onPlaylist: (String) -> Unit,
                                  onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onPage: (String, String?) -> Unit) {
    val context = LocalContext.current
    var zone by remember { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    val (cols, coverPx) = wallColumns(prefs)
    var list by remember { mutableStateOf<List<SmartPlaylist>?>(null) }
    var failed by remember { mutableStateOf(false) }
    val sheets by NativeShell.sheetsClosed
    BackHandler { onBack() }
    LaunchedEffect(sheets) {
        val c = client() ?: return@LaunchedEffect
        val got = withContext(Dispatchers.IO) { runCatching { LibraryClient { c.getJson(it) }.smartPlaylists() }.getOrNull() }
        failed = got == null
        if (got != null) list = got
    }
    val banner = when {
        failed && list == null -> "Couldn't read your Dynamic Playlists — the extension didn't answer. They're still saved; try again." to true
        list?.isEmpty() == true -> "No Dynamic Playlists yet — start one with New, or set a sort and focus on the Library screen and use Focus → Save as…" to false
        else -> null
    }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize(), state = rememberLazyGridState(), contentPadding = WALL_PADDING,
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item(span = { GridItemSpan(maxLineSpan) }) { WallHead("Dynamic Playlists", prefs.copy(layout = "auto"), banner) }
            item("new") { NewTile(prefs) { onPage("smart-new", null) } }
            val shown = list.orEmpty()
            items(shown.size, key = { "s" + shown[it].id }) { i -> SmartTile(shown[i], prefs, coverPx, client) { onPlaylist(shown[i].id) } }
        }
        WallBack(onBack)
        Column(Modifier.align(Alignment.BottomCenter)) {
            MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage)
            TouchNav("", offline = Store.offlineMode(context), onTap = onNav)
        }
    }
}

/** New Dynamic Playlist (the page's buildNewSmartTile, hifi .unheard-art): the dashed brass sleeve with ＋ in it, its name in brass. */
@Composable
private fun NewTile(prefs: WallPrefs, onTap: () -> Unit) {
    val edge = MaterialTheme.colorScheme.primary.copy(alpha = 0.6f)
    val title = (12 * prefs.text).sp; val titleLine = (15 * prefs.text).sp
    val sub = (10.5 * prefs.text).sp; val subLine = (13.65 * prefs.text).sp
    Column(Modifier.parity("smart-playlists.new", Contract.label("smart-playlists.new")).fillMaxWidth().clickable(onClick = onTap)) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant).drawBehind {
            val w = 1.dp.toPx(); val dash = 3.dp.toPx()
            drawRoundRect(edge, Offset(w / 2, w / 2), Size(size.width - w, size.height - w), CornerRadius(12.dp.toPx()), Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash))))
        }, contentAlignment = Alignment.Center) {
            Text("＋", color = MaterialTheme.colorScheme.secondary, fontSize = 38.sp, lineHeight = 38.sp)
        }
        Text("New Dynamic Playlist", Modifier.padding(top = 11.dp).lineBox(title, titleLine), color = MaterialTheme.colorScheme.secondary,
            fontSize = title, lineHeight = titleLine, fontWeight = FontWeight.W600, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text("Albums or tracks, then a focus", Modifier.padding(top = 1.dp).lineBox(sub, subLine), color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = sub, lineHeight = subLine, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A saved Dynamic Playlist as a tile: its mosaic, its name, its view in a line; called aloud by its name. */
@Composable
private fun SmartTile(p: SmartPlaylist, prefs: WallPrefs, coverPx: Int, client: () -> ServerClient?, onTap: () -> Unit) {
    val title = (12 * prefs.text).sp; val titleLine = (15 * prefs.text).sp
    val sub = (10.5 * prefs.text).sp; val subLine = (13.65 * prefs.text).sp
    val corners = RoundedCornerShape(12.dp)
    Column(Modifier.parity("smart-playlists.playlist", Contract.label("smart-playlists.playlist", 0, p.name)).fillMaxWidth().clickable(onClick = onTap)) {
        Box(Modifier.parity("smart-playlists.playlist-art").fillMaxWidth().aspectRatio(1f).clip(corners).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, Color.White.copy(alpha = 0.06f), corners)) {
            PlaylistMosaic(p.artKeys.take(4), coverPx, client)
        }
        Text(p.name, Modifier.parity("smart-playlists.playlist-title").padding(top = 11.dp).lineBox(title, titleLine), color = MaterialTheme.colorScheme.onSurface,
            fontSize = title, lineHeight = titleLine, fontWeight = FontWeight.W600, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(SmartPlaylist.describe(p.view), Modifier.parity("smart-playlists.playlist-subtitle").padding(top = 1.dp).lineBox(sub, subLine), color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = sub, lineHeight = subLine, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
