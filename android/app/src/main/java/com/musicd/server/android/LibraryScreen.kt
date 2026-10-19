package com.musicd.server.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.NavItem
import com.musicd.server.client.NavList
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.launch
import java.text.NumberFormat
import kotlin.math.ceil
import kotlin.math.min

/**
 * The Library wall, natively (stage N4, L1 of docs/specs/plan-android-native.md; bug list item 51; a
 * preview: Settings → Setup → UI Settings), drawn as the page's (docs/specs/screens.json, library;
 * style.css, the touch layout): the heading with the count at the top, the bar's Back over the
 * albums top left, the grid at UI Settings' columns and text size (or its list), paged 60 at a time
 * as the end comes near, the banner where the library can't be read or nothing matches, and the
 * mini player and the row along the foot. The page opens it in its own [view] of the library (the
 * sort and the focus, as the query string the page's wall asks with) and to its [prefs]; a tile
 * opens the album's page over it ([onAlbum], with the wall as its list for previous and next), and
 * Back comes back here as it was. Focus, Sort and the name filter are still the page's (L2).
 */
@Composable
internal fun LibraryScreen(view: String, prefs: WallPrefs, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onAlbum: (Long, String, NavList) -> Unit,
                           onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onPage: (String, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val wall = remember(view) { LibraryWall.state(view) }
    var zone by remember { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    BackHandler(onBack = onBack)
    val conf = LocalConfiguration.current
    val cols = prefs.cols(conf.screenWidthDp, conf.screenHeightDp)
    // The cover's size to ask for, as the page asks (album-tiles.js tileImgSize): the tile's width in device pixels, to the next 100, within 200 and 500.
    val density = LocalDensity.current.density
    val coverPx = (ceil((conf.screenWidthDp - 28 - 8 * (cols - 1)) / cols.toFloat() * min(2f, density) / 100f) * 100).toInt().coerceIn(200, 500)
    fun more() { val c = client() ?: return; scope.launch { wall.more(c) } }
    LaunchedEffect(wall) { if (!wall.loaded) more() }
    val grid = rememberLazyGridState()
    val list = rememberLazyListState()
    // The next page as the end comes near (the page asks 600px from it): the last tile shown within four rows of the last loaded.
    val near by remember(prefs.list, cols) {
        derivedStateOf {
            val last = if (prefs.list) list.layoutInfo.visibleItemsInfo.lastOrNull()?.index else grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index
            last != null && last >= wall.albums.size + 1 - cols * 4   // the heading is the first item
        }
    }
    LaunchedEffect(near, wall.albums.size) { if (near && wall.loaded) more() }
    fun open(i: Int) { val a = wall.albums[i]; onAlbum(a.offset, zone, NavList(wall.albums.map { NavItem(it.offset, it.title) }, i)) }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        // The page's room for the bar and the row: main's padding-top (56 + 14) and its padding-bottom (106 + 58).
        val pad = PaddingValues(start = 14.dp, top = 70.dp, end = 14.dp, bottom = 176.dp)
        if (prefs.list) LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = pad) {
            item { WallHead(wall, view, prefs) }
            itemsIndexed(wall.albums, key = { _, a -> a.offset }) { i, a -> AlbumRow(a, prefs, coverPx, client) { open(i) } }
            if (!wall.loaded) items(12) { SkeletonRow() }
        }
        else LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize(), state = grid, contentPadding = pad,
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item(span = { GridItemSpan(maxLineSpan) }) { WallHead(wall, view, prefs) }
            itemsIndexed(wall.albums, key = { _, a -> a.offset }) { i, a -> AlbumTile(a, prefs, coverPx, client) { open(i) } }
            if (!wall.loaded) items(cols * 8) { SkeletonTile() }
        }
        // Back, as the bar's button (.icon-btn): the raised ground, a hairline, the dim text; at the bar's padding.
        IconButton(onClick = onBack, modifier = Modifier.parity("library.back", Contract.label("library.back")).align(Alignment.TopStart).padding(start = 14.dp, top = 12.dp).size(40.dp)
            .clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)) {
            Icon(painterResource(R.drawable.np_back), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.align(Alignment.BottomCenter)) {
            MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage)
            // Library, tapped where it is already: back to the top, as the page's row does.
            TouchNav("library", offline = Store.offlineMode(context), onTap = { what -> if (what == "library") scope.launch { if (prefs.list) list.animateScrollToItem(0) else grid.animateScrollToItem(0) } else onNav(what) })
        }
    }
}

/** The heading over the wall ("Library · 1,234 albums", "matching" with a focus on), at UI Settings' title size; the banner under it when there is one. */
@Composable
private fun WallHead(wall: WallState, view: String, prefs: WallPrefs) {
    Column(Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        // A focus on: any part of the view beyond the order (the page's libFocusCount).
        val focus = view.split('&').any { it.isNotEmpty() && it.substringBefore('=') !in setOf("sort", "dir", "seed") }
        val count = NumberFormat.getIntegerInstance().format(wall.total)
        val text = if (!wall.loaded) "Library" else "Library · $count" + (if (focus) " matching" else "") + (if (wall.total == 1) " album" else " albums")
        Text(text, Modifier.parity("library.title"), color = MaterialTheme.colorScheme.onSurface, fontSize = (24 * prefs.title).sp, lineHeight = (28.8 * prefs.title).sp)
        wall.banner?.let { (said, error) ->
            Box(Modifier.fillMaxWidth().padding(top = 14.dp).border(1.dp, if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                .clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 16.dp, vertical = 14.dp)) {
                Text(said, Modifier.parity("library.banner"), color = if (error) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, lineHeight = 20.sp)
            }
        }
    }
}

/** A tile's shape while the first page comes (the page's skeletons): the cover's square and two lines of nothing. */
@Composable
private fun SkeletonTile() {
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(6.dp)).background(paletteColor(Palette.BG_ELEV_2)))
        Spacer(Modifier.height(5.dp))
        Box(Modifier.fillMaxWidth(0.8f).height(12.dp).clip(RoundedCornerShape(3.dp)).background(paletteColor(Palette.BG_ELEV_2)))
        Spacer(Modifier.height(4.dp))
        Box(Modifier.fillMaxWidth(0.5f).height(10.dp).clip(RoundedCornerShape(3.dp)).background(paletteColor(Palette.BG_ELEV_2)))
    }
}

/** A row's shape while the first page comes. */
@Composable
private fun SkeletonRow() {
    Box(Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 7.dp)) {
        Box(Modifier.size(52.dp).clip(RoundedCornerShape(6.dp)).background(paletteColor(Palette.BG_ELEV_2)))
    }
}
