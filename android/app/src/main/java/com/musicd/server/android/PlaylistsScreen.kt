package com.musicd.server.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.Palette
import com.musicd.server.client.PlaylistTile
import com.musicd.server.client.ServerClient
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The Playlists screen, natively (the Playlists group of old/plan-android-native.md, P1; bug list item 65), drawn as
 * the page's (docs/specs/screens.json, playlists; walls.js showPlaylists): the heading with the bar's Back, Import in the
 * top-right corner under it (the page's sheet for a pasted playlist, over this screen), then each of your playlists as a
 * tile of the wall with its covers' mosaic, its name and how many tracks, the last changed first; the banner while there
 * are none; the mini player and the row along the foot. A tile opens the playlist's page ([onPlaylist]); the list is
 * read again each time it comes back on screen, and when the page's sheet over it closes (an import made one).
 */
@Composable
internal fun PlaylistsScreen(prefs: WallPrefs, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onPlaylist: (String) -> Unit,
                             onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onPage: (String, String?) -> Unit) {
    var zone by remember { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    val (cols, coverPx) = wallColumns(prefs)
    var list by remember { mutableStateOf<List<PlaylistTile>?>(null) }
    var failed by remember { mutableStateOf(false) }
    val sheets by NativeShell.sheetsClosed
    // Import's sheet (PlaylistImportSheet.kt; item 94), and how many playlists it has made: the list read again after each.
    var importing by remember { mutableStateOf(false) }
    var made by remember { mutableStateOf(0) }
    BackHandler { onBack() }
    LaunchedEffect(sheets, made) {
        val c = client() ?: return@LaunchedEffect
        val got = withContext(Dispatchers.IO) { runCatching { LibraryClient { c.getJson(it) }.userPlaylists() }.getOrNull() }
        failed = got == null
        if (got != null) list = got
    }
    val banner = when {
        failed && list.isNullOrEmpty() -> "Couldn't read playlists from the server." to true
        list?.isEmpty() == true -> "No playlists yet — import one, or select tracks and use Add to playlist." to false
        else -> null
    }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize(), state = rememberLazyGridState(), contentPadding = WALL_PADDING,
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column {
                    WallHead("Playlists", prefs.copy(layout = "auto"), null)
                    // Import, at the right under the heading (.playlists-import, in the count's place): a brass pill 32 tall.
                    Row(Modifier.fillMaxWidth().padding(top = 20.dp, end = 16.dp), horizontalArrangement = Arrangement.End) {
                        Box(Modifier.parity("playlists.import", Contract.label("playlists.import")).height(32.dp).clip(RoundedCornerShape(999.dp))
                            .background(MaterialTheme.colorScheme.primary).clickable { importing = true }.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                            Text("Import", color = MaterialTheme.colorScheme.onPrimary, fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.W600)
                        }
                    }
                    banner?.let { (said, error) -> Banner(said, error, Modifier.padding(top = 14.dp)) }
                }
            }
            val shown = list.orEmpty()
            items(shown.size, key = { "p" + shown[it].id }) { i -> PlaylistsTile(shown[i], prefs, coverPx, client) { onPlaylist(shown[i].id) } }
        }
        WallBack(onBack)
        Column(Modifier.align(Alignment.BottomCenter)) {
            MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage)
            TouchNav("", onTap = onNav)
        }
        if (importing) PlaylistImportSheet(client, onSaved = { made++ }) { importing = false }
    }
}

/** One of your playlists as a tile of the wall: its mosaic, its name in two lines at most, how many tracks; called aloud by its name. */
@Composable
private fun PlaylistsTile(p: PlaylistTile, prefs: WallPrefs, coverPx: Int, client: () -> ServerClient?, onTap: () -> Unit) {
    val title = (12 * prefs.text).sp; val titleLine = (15 * prefs.text).sp
    val sub = (10.5 * prefs.text).sp; val subLine = (13.65 * prefs.text).sp
    val corners = RoundedCornerShape(12.dp)
    Column(Modifier.parity("playlists.playlist", Contract.label("playlists.playlist", 0, p.name)).fillMaxWidth().clickable(onClick = onTap)) {
        Box(Modifier.parity("playlists.playlist-art").fillMaxWidth().aspectRatio(1f).clip(corners).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, Color.White.copy(alpha = 0.06f), corners)) {
            PlaylistMosaic(p.artKeys.take(4), coverPx, client)
        }
        Text(p.name.ifEmpty { "Untitled" }, Modifier.parity("playlists.playlist-title").padding(top = 11.dp).lineBox(title, titleLine), color = MaterialTheme.colorScheme.onSurface,
            fontSize = title, lineHeight = titleLine, fontWeight = FontWeight.W600, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(p.subtitle, Modifier.parity("playlists.playlist-subtitle").padding(top = 1.dp).lineBox(sub, subLine), color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = sub, lineHeight = subLine, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
