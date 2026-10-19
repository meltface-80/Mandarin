package com.musicd.server.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.WallPrefs

/*
 * An album's tile, as the page's (bug list item 51; album-tiles.js
 * buildAlbumTile, style.css .album): the cover square with its corners,
 * the raised ground under it and "♪" where there is none; the rate on it
 * bottom left (brass when better than CD), the service's mark top right,
 * two discs bottom right; the title under it in two lines at most, the
 * artist in one, each at UI Settings' text size. In UI Settings' List
 * layout the same as a row: a 52 cover, the title over the artist, a
 * chevron. A tap opens the album; each tile is the contract's `album`.
 */

/** The album [a] as a tile of the grid: its cover [coverPx] wide, its text at [prefs]' size. */
@Composable
internal fun AlbumTile(a: AlbumSummary, prefs: WallPrefs, coverPx: Int, client: () -> ServerClient?, onOpen: () -> Unit) {
    val cover = rememberTileCover(a.imageKey, coverPx, client)
    Column(Modifier.parity("library.album", Contract.label("library.album", if (a.subtitle.isEmpty()) 1 else 0, a.title.ifEmpty { "Untitled" }, a.subtitle)).fillMaxWidth().clickable(onClick = onOpen)) {
        TileArt(a, cover, Modifier.fillMaxWidth().aspectRatio(1f))
        // The page's phone sizes (style.css, max-width 767px): the title 12px in two lines, the artist 10.5px in one.
        Text(a.title.ifEmpty { "Untitled" }, Modifier.parity("library.album-title").padding(top = 5.dp), color = MaterialTheme.colorScheme.onSurface,
            fontSize = (12 * prefs.text).sp, lineHeight = (15 * prefs.text).sp, fontWeight = FontWeight.W500, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (a.subtitle.isNotEmpty()) Text(a.subtitle, Modifier.parity("library.album-artist").padding(top = 1.dp), color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = (10.5 * prefs.text).sp, lineHeight = (13.6 * prefs.text).sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The album [a] as a row of the list (UI Settings' List): the cover small, the title over the artist, a chevron; a hairline under it. */
@Composable
internal fun AlbumRow(a: AlbumSummary, prefs: WallPrefs, coverPx: Int, client: () -> ServerClient?, onOpen: () -> Unit) {
    val cover = rememberTileCover(a.imageKey, coverPx, client)
    val faint = paletteColor(Palette.TEXT_FAINT)
    Column {
        Row(Modifier.parity("library.album", Contract.label("library.album", if (a.subtitle.isEmpty()) 1 else 0, a.title.ifEmpty { "Untitled" }, a.subtitle)).fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 2.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TileArt(a, cover, Modifier.size(52.dp))
            Column(Modifier.weight(1f)) {
                Text(a.title.ifEmpty { "Untitled" }, Modifier.parity("library.album-title"), color = MaterialTheme.colorScheme.onSurface,
                    fontSize = (12 * prefs.text).sp, lineHeight = (15 * prefs.text).sp, fontWeight = FontWeight.W500, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (a.subtitle.isNotEmpty()) Text(a.subtitle, Modifier.parity("library.album-artist").padding(top = 1.dp), color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = (10.5 * prefs.text).sp, lineHeight = (13.6 * prefs.text).sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            // The chevron that says the row opens something: two sides of a 7px square, turned (the page's ::after).
            Canvas(Modifier.padding(end = 4.dp).size(7.dp)) {
                val w = 2.dp.toPx()
                drawLine(faint, Offset(0f, 0f), Offset(size.width, size.height / 2), w, StrokeCap.Square)
                drawLine(faint, Offset(size.width, size.height / 2), Offset(0f, size.height), w, StrokeCap.Square)
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
}

/** The cover square: [cover] once fetched, "♪" where the album has none; the badges on it. */
@Composable
private fun TileArt(a: AlbumSummary, cover: ImageBitmap?, modifier: Modifier) {
    val badge = Color(0x9E0A0E14)   // the page's rgba(10, 14, 20, .62)
    val onBadge = Color.White.copy(alpha = 0.92f)
    Box(modifier.parity("library.album-art").shadow(2.dp, RoundedCornerShape(6.dp)).clip(RoundedCornerShape(6.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
        if (cover != null) Image(cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else if (a.imageKey == null) Text("♪", Modifier.align(Alignment.Center), color = paletteColor(Palette.TEXT_FAINT), fontSize = 48.sp, lineHeight = 48.sp)
        // The service's mark, top right: only a Qobuz or Tidal album wears one (the page's .album-source).
        when (a.source) { "qobuz" -> R.drawable.src_qobuz; "tidal" -> R.drawable.src_tidal; else -> null }?.let { icon ->
            Box(Modifier.parity("library.album-source").align(Alignment.TopEnd).padding(6.dp).size(22.dp).clip(RoundedCornerShape(6.dp)).background(badge), contentAlignment = Alignment.Center) {
                Icon(painterResource(icon), contentDescription = null, tint = onBadge, modifier = Modifier.size(13.dp))
            }
        }
        // The files' rate, bottom left, in brass when better than CD (the page's .album-quality).
        a.quality?.let { q ->
            Box(Modifier.parity("library.album-quality").align(Alignment.BottomStart).padding(6.dp).clip(RoundedCornerShape(5.dp)).background(badge).padding(horizontal = 5.dp, vertical = 2.dp)) {
                Text(q, color = if (a.hires) MaterialTheme.colorScheme.secondary else onBadge, fontSize = 10.sp, lineHeight = 13.sp, fontWeight = FontWeight.W700, maxLines = 1)
            }
        }
        // More than one disc, bottom right (the page's .album-discs).
        if ((a.discs ?: 0) > 1) Box(Modifier.parity("library.album-discs").align(Alignment.BottomEnd).padding(6.dp).size(24.dp, 19.dp).clip(RoundedCornerShape(5.dp)).background(badge), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.tile_discs), contentDescription = null, tint = onBadge, modifier = Modifier.size(15.dp))
        }
    }
}
