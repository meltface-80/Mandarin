package com.musicd.server.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.ArtistSimilar
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SimilarAlbum

/**
 * The foot of an artist's page, under all their albums (bug list item 140; the page's artist-about.js, .artist-similar):
 * similar artists (item 137), a row of round pictures each opening their page, then similar albums, a row of covers
 * each opening the album (the library's) or its Last.fm page. A row with nothing in it isn't there.
 */
@Composable
internal fun ArtistFoot(similar: ArtistSimilar?, albums: List<SimilarAlbum>, client: () -> ServerClient?, onArtist: (String) -> Unit,
                        onAlbum: (Int) -> Unit, onUrl: (String) -> Unit) {
    val acts = similar?.artists.orEmpty()
    if (acts.isEmpty() && albums.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 10.dp)) {
        if (acts.isNotEmpty()) {
            FootTitle("Similar artists")
            LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(end = 14.dp)) {
                items(acts.size) { i -> SimilarAct(acts[i], client, onArtist) }
            }
        }
        if (albums.isNotEmpty()) {
            FootTitle("Similar albums")
            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(end = 14.dp)) {
                items(albums.size) { i ->
                    val al = albums[i]
                    SimilarAlbumTile(al, client) { if (al.album != null) onAlbum(i) else al.url?.let(onUrl) }
                }
            }
        }
    }
}

/** A section's small heading in capitals, as the members' (.artist-section-header). */
@Composable
private fun FootTitle(title: String) =
    Text(title.uppercase(), Modifier.parity("artist.section").padding(top = 12.dp, bottom = 8.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W600, letterSpacing = 0.06.em)

/** A similar act: their picture (or first letter) in a circle over the name. */
@Composable
private fun SimilarAct(a: ArtistSimilar.Act, client: () -> ServerClient?, onArtist: (String) -> Unit) {
    Column(Modifier.parity("artist.similar", Contract.label("artist.similar", 0, a.name)).width(96.dp).clickable { onArtist(a.name) }, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.parity("artist.similar-art").fillMaxWidth().aspectRatio(1f).clip(CircleShape).background(paletteColor(Palette.BG_ELEV_2)), contentAlignment = Alignment.Center) {
            val art = rememberTileCover(a.photoKey, 300, client)
            if (art != null) Image(art, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else Text(a.name.take(1).uppercase(), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 26.sp, fontWeight = FontWeight.W600)
        }
        Text(a.name, Modifier.parity("artist.similar-name").padding(top = 8.dp), color = MaterialTheme.colorScheme.onSurface, fontSize = 12.sp, lineHeight = 15.sp,
            fontWeight = FontWeight.W600, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

/** A similar album: its cover, the title and who by; "Last.fm ↗" under one the library hasn't. */
@Composable
private fun SimilarAlbumTile(al: SimilarAlbum, client: () -> ServerClient?, onTap: () -> Unit) {
    val title = al.album?.title ?: al.title
    Column(Modifier.parity("artist.similar-album", Contract.label("artist.similar-album", 0, title)).width(128.dp).clickable(onClick = onTap)) {
        Box(Modifier.parity("artist.similar-album-art").fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(6.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
            rememberCover(al.album?.imageKey ?: al.imageKey, 300, client)?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
        Text(title, Modifier.parity("artist.similar-album-title").padding(top = 8.dp), color = paletteColor(Palette.MODAL_TEXT), fontSize = 13.sp, fontWeight = FontWeight.W500, lineHeight = 17.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(al.artist, Modifier.parity("artist.similar-album-artist").padding(top = 2.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (al.album == null && al.url != null) Text("Last.fm ↗", Modifier.parity("artist.similar-album-artist").padding(top = 2.dp), color = MaterialTheme.colorScheme.secondary, fontSize = 10.sp, letterSpacing = 0.04.em)
    }
}
