package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.WallPrefs
import kotlin.math.ceil
import kotlin.math.min

/*
 * A wall of albums as the page draws every one (bug list item 52; style.css
 * .album-grid, the touch layout): the heading at the top with the banner under
 * it when there is one, then the tiles at UI Settings' columns (or its list),
 * in blocks each under its own small heading where a screen has several (an
 * artist's own albums, and those they appear on). Drawn by the Library wall,
 * the walls Home links to and an artist's page, so the three carry each key.
 */

/** A run of albums under a heading of its own ([title]: none for the only run). */
internal class GridBlock(val title: String?, val albums: List<AlbumSummary>)

/** The page's room for the bar above and the mini player and the row below (main's padding). */
internal val WALL_PADDING = PaddingValues(start = 14.dp, top = 70.dp, end = 14.dp, bottom = 176.dp)

/** How many columns the screen has at [prefs], and how wide a cover to ask for (the page's tileImgSize: the tile in device pixels to the next 100, within 200 and 500). */
@Composable
internal fun wallColumns(prefs: WallPrefs): Pair<Int, Int> {
    val conf = LocalConfiguration.current
    val cols = prefs.cols(conf.screenWidthDp, conf.screenHeightDp)
    val density = LocalDensity.current.density
    val coverPx = (ceil((conf.screenWidthDp - 28 - 8 * (cols - 1)) / cols.toFloat() * min(2f, density) / 100f) * 100).toInt().coerceIn(200, 500)
    return cols to coverPx
}

/** How many albums a wall of random albums asks for (the page's computeAlbumCount): a phone three screens' worth; a tablet or a desktop a screenful of rows. */
@Composable
internal fun randomWallCount(prefs: WallPrefs): Int {
    val conf = LocalConfiguration.current
    val w = conf.screenWidthDp; val h = conf.screenHeightDp
    if (min(w, h) < 768) return 24
    val cols = prefs.cols(w, h)
    return if (w >= 1200) cols * 5 else cols * (if (w > h) 3 else 4)
}

/**
 * The wall: [head] first across every column, then [blocks]' tiles (or rows, [prefs].list), [loaded] false drawing
 * skeletons after them; a tile's tap [onOpen] with its place among every album, a long press [onLongPress] likewise;
 * [selected] the offsets picked. [grid] and [list] keep the place for Back.
 */
@Composable
internal fun AlbumGrid(blocks: List<GridBlock>, prefs: WallPrefs, cols: Int, coverPx: Int, client: () -> ServerClient?, loaded: Boolean, selected: Set<Long>,
                       grid: LazyGridState, list: LazyListState, onOpen: (Int) -> Unit, onLongPress: (Int) -> Unit, head: @Composable () -> Unit) {
    // Each album's place among all of them, for the list an album page steps through.
    var at = 0
    if (prefs.list) LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = WALL_PADDING) {
        item { head() }
        for (b in blocks) {
            if (b.title != null) item { BlockTitle(b.title) }
            val from = at
            items(b.albums.size, key = { i -> b.albums[i].offset }) { i -> val a = b.albums[i]; val p = from + i; AlbumRow(a, prefs, coverPx, client, a.offset in selected, { onLongPress(p) }) { onOpen(p) } }
            at += b.albums.size
        }
        if (!loaded) items(12) { SkeletonRow() }
    }
    else LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize(), state = grid, contentPadding = WALL_PADDING,
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) { head() }
        for (b in blocks) {
            if (b.title != null) item(span = { GridItemSpan(maxLineSpan) }) { BlockTitle(b.title) }
            val from = at
            items(b.albums.size, key = { i -> b.albums[i].offset }) { i -> val a = b.albums[i]; val p = from + i; AlbumTile(a, prefs, coverPx, client, a.offset in selected, { onLongPress(p) }) { onOpen(p) } }
            at += b.albums.size
        }
        if (!loaded) items(cols * 8) { SkeletonTile() }
    }
}

/** Back, as the bar's button (.icon-btn): the raised ground, a hairline, the dim text; at the bar's padding, top left. */
@Composable
internal fun BoxScope.WallBack(onBack: () -> Unit) {
    IconButton(onClick = onBack, modifier = Modifier.parity("library.back wall.back artist.back", Contract.label("library.back")).align(Alignment.TopStart).padding(start = 14.dp, top = 12.dp).size(40.dp)
        .clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)) {
        Icon(painterResource(R.drawable.np_back), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
    }
}

/** A block's small heading, as the artist page's (.artist-section-header): tracked out, faint. */
@Composable
private fun BlockTitle(title: String) {
    Text(title.uppercase(), Modifier.parity("artist.section").padding(top = 12.dp, bottom = 4.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, fontWeight = FontWeight.W600, letterSpacing = 0.06.em)
}

/** The heading over a wall ([title], at UI Settings' title size), and the banner under it when there is one ([banner]: what it says, and whether as an error). */
@Composable
internal fun WallHead(title: String, prefs: WallPrefs, banner: Pair<String, Boolean>?) {
    Column(Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        Text(title, Modifier.parity("library.title wall.title artist.title"), color = MaterialTheme.colorScheme.onSurface, fontSize = (24 * prefs.title).sp, lineHeight = (28.8 * prefs.title).sp)
        banner?.let { (said, error) -> Banner(said, error, Modifier.padding(top = 14.dp)) }
    }
}

/** The page's banner (.status-banner): a note across the wall, its edge red when it is an error. */
@Composable
internal fun Banner(said: String, error: Boolean, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().border(1.dp, if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
        .clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 16.dp, vertical = 14.dp)) {
        Text(said, Modifier.parity("library.banner wall.banner artist.error"), color = if (error) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, lineHeight = 20.sp)
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
