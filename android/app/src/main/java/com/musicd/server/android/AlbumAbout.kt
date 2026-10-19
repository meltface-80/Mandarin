package com.musicd.server.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.musicd.server.client.Album
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.Palette
import com.musicd.server.client.Review
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SimilarAlbum
import com.musicd.server.client.SimilarArtist

/*
 * Under an album's tracks, as the page has it (docs/specs/screens.json,
 * album; public/app/album-extras.js, album-tracks.js): About this album (the
 * write-up, Show more, whose words, the link to its page), then the library's
 * other albums by the lead artist and the ones they appear on, then Last.fm's
 * similar artists and similar albums. Three of each; More shows the rest. A
 * section with nothing to show isn't there.
 */

/** The rows under the review, as fetched for one album. */
internal class AlbumMore(val lead: String, val by: List<AlbumSummary>, val appears: List<AlbumSummary>,
                         val artists: List<SimilarArtist>, val artistsUrl: String?, val note: String?, val albums: List<SimilarAlbum>)

/** The rows for [a], asked as the page asks them: the library first, then Last.fm (its albums only once its artists answered). */
internal fun loadMore(lib: LibraryClient, a: Album): AlbumMore? {
    val lead = (a.artists.firstOrNull() ?: a.album.subtitle).trim()
    if (lead.isEmpty()) return null
    val own = runCatching { lib.artistAlbums(lead) }.getOrNull()
    val byTitle = compareBy<AlbumSummary> { it.title }
    val by = own?.primary?.filter { it.offset != a.album.offset }?.sortedWith(byTitle).orEmpty()
    val appears = own?.featured?.filter { it.offset != a.album.offset }?.sortedWith(byTitle).orEmpty()
    val sim = runCatching { lib.similarArtists(lead) }.getOrNull()?.takeIf { it.enabled }
    val albums = if (sim != null && sim.error == null) runCatching { lib.similarAlbums(lead) }.getOrNull()?.takeIf { it.enabled && it.error == null }?.albums.orEmpty() else emptyList()
    return AlbumMore(lead, by, appears, if (sim?.error == null) sim?.artists.orEmpty() else emptyList(), sim?.url, sim?.keyNote, albums)
}

/**
 * The sections, each its own item. An album of the library's opens here
 * ([onAlbum]), an artist of the library's on the page ([onArtist]); what only
 * Last.fm knows opens its page ([onUrl]).
 */
internal fun LazyListScope.albumAbout(review: Review?, more: AlbumMore?, client: () -> ServerClient?,
                                      onAlbum: (Long) -> Unit, onArtist: (String) -> Unit, onUrl: (String) -> Unit) {
    if (review != null) item {
        var open by remember { mutableStateOf(false) }
        var clipped by remember { mutableStateOf(false) }
        Column(Modifier.parity("album.review").fillMaxWidth().padding(top = 36.dp)) {
            // The section's head, as the page's section-label: small capitals tracked out over a hairline.
            Text("About this album".uppercase(), Modifier.padding(bottom = 8.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, fontWeight = FontWeight.W600, letterSpacing = 0.16.em)
            HorizontalDivider(Modifier.padding(bottom = 10.dp), color = MaterialTheme.colorScheme.outline)
            review.text?.let {
                Text(it, color = paletteColor(Palette.MODAL_TEXT), fontSize = 14.sp, lineHeight = 22.4.sp, maxLines = if (open) Int.MAX_VALUE else 5,
                    overflow = TextOverflow.Ellipsis, onTextLayout = { r -> if (!open) clipped = r.hasVisualOverflow })
            }
            review.attribution?.let { Text(it, Modifier.padding(top = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.5.sp) }
            Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                if (clipped || open) TextButton(onClick = { open = !open }, contentPadding = PaddingValues(vertical = 4.dp),
                    modifier = Modifier.parity("album.review-more", Contract.label("album.review-more", if (open) 1 else 0))) {
                    Text(Contract.label("album.review-more", if (open) 1 else 0), color = MaterialTheme.colorScheme.secondary, fontSize = 13.sp, fontWeight = FontWeight.W500)
                }
                val link = review.linkText
                val url = review.url   // a local: a property of core's can't be smart-cast across the module
                if (link != null && url != null) TextButton(onClick = { onUrl(url) }, contentPadding = PaddingValues(vertical = 4.dp),
                    modifier = Modifier.parity("album.review-source", Contract.label("album.review-source", 0, link))) {
                    Text(link, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                }
            }
        }
    }
    val m = more ?: return
    if (m.by.isNotEmpty()) item {
        MoreSection("More by ${m.lead}", m.by.size, Modifier.parity("album.more-by"), moreKey = "album.more-by-more") { shown ->
            Grid(m.by.take(shown)) { a -> AlbumTile(a.title, a.subtitle, a.imageKey, false, client,
                Modifier.parity("album.more-by-album", Contract.label("album.more-by-album", 0, a.title)).clickable { onAlbum(a.offset) }) }
        }
    }
    if (m.appears.isNotEmpty()) item {
        MoreSection("${m.lead} appears on", m.appears.size, Modifier.parity("album.appears-on"), moreKey = "album.appears-on-more") { shown ->
            Grid(m.appears.take(shown)) { a -> AlbumTile(a.title, a.subtitle, a.imageKey, false, client,
                Modifier.parity("album.appears-on-album", Contract.label("album.appears-on-album", 0, a.title)).clickable { onAlbum(a.offset) }) }
        }
    }
    if (m.artists.isNotEmpty() || m.note != null) item {
        MoreSection("Similar artists", m.artists.size, Modifier.parity("album.similar-artists"), moreKey = "album.similar-artists-more", site = m.artistsUrl?.takeIf { m.artists.isNotEmpty() }?.let { url ->
            { TextButton(onClick = { onUrl(url) }, modifier = Modifier.parity("album.similar-artists-site", Contract.label("album.similar-artists-site"))) {
                Text(Contract.label("album.similar-artists-site"), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp, fontWeight = FontWeight.W500) } }
        }) { shown ->
            m.note?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp) }
            Grid(m.artists.take(shown)) { a -> ArtistTile(a, client,
                Modifier.parity("album.similar-artist", Contract.label("album.similar-artist", 0, a.name)).clickable { if (a.inLibrary) onArtist(a.name) else a.url?.let(onUrl) }) }
        }
    }
    if (m.albums.isNotEmpty()) item {
        MoreSection("Similar albums", m.albums.size, Modifier.parity("album.similar-albums"), moreKey = "album.similar-albums-more") { shown ->
            Grid(m.albums.take(shown)) { al ->
                val own = al.album
                AlbumTile(own?.title ?: al.title, own?.subtitle ?: al.artist, own?.imageKey ?: al.imageKey, own == null, client,
                    Modifier.parity("album.similar-album", Contract.label("album.similar-album", 0, own?.title ?: al.title)).clickable { if (own != null) onAlbum(own.offset) else al.url?.let(onUrl) })
            }
        }
    }
}

/** A row's section: its head, three of its [count] things, and More for the rest ([moreKey], the contract's). */
@Composable
private fun MoreSection(title: String, count: Int, modifier: Modifier, moreKey: String, site: (@Composable () -> Unit)? = null, content: @Composable (shown: Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(modifier.fillMaxWidth().padding(top = 22.dp)) {
        // The head, as the page's section-label: small capitals tracked out over a hairline, [site] at its right end.
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
            Text(title.uppercase(), Modifier.weight(1f), color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, fontWeight = FontWeight.W600, letterSpacing = 0.16.em)
            site?.invoke()
        }
        HorizontalDivider(Modifier.padding(bottom = 10.dp), color = MaterialTheme.colorScheme.outline)
        content(if (open) count else 3)
        // More and Less: one key per section, written out for the gate, the same button.
        if (count > 3) {
            val label = if (open) "Less" else "More"
            when (moreKey) {
                "album.more-by-more" -> TextButton(onClick = { open = !open }, modifier = Modifier.parity("album.more-by-more", Contract.label("album.more-by-more", if (open) 1 else 0))) { MoreText(label) }
                "album.appears-on-more" -> TextButton(onClick = { open = !open }, modifier = Modifier.parity("album.appears-on-more", Contract.label("album.appears-on-more", if (open) 1 else 0))) { MoreText(label) }
                "album.similar-artists-more" -> TextButton(onClick = { open = !open }, modifier = Modifier.parity("album.similar-artists-more", Contract.label("album.similar-artists-more", if (open) 1 else 0))) { MoreText(label) }
                else -> TextButton(onClick = { open = !open }, modifier = Modifier.parity("album.similar-albums-more", Contract.label("album.similar-albums-more", if (open) 1 else 0))) { MoreText(label) }
            }
        }
    }
}

@Composable
private fun MoreText(label: String) {
    Text(label, color = MaterialTheme.colorScheme.secondary, fontSize = 13.sp, fontWeight = FontWeight.W500)
}

/** Three to a row, as the page's grid. */
@Composable
private fun <T> Grid(items: List<T>, tile: @Composable (T) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        for (row in items.chunked(3)) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for (it in row) Box(Modifier.weight(1f)) { tile(it) }
            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

/** An album as the page's tile: its cover, title and artist; "Last.fm ↗" under one that leaves the app. */
@Composable
private fun AlbumTile(title: String, artist: String, imageKey: String?, external: Boolean, client: () -> ServerClient?, modifier: Modifier) {
    val cover = rememberCover(imageKey, 300, client)
    Column(modifier) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(6.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
            cover?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
        Text(title, Modifier.padding(top = 8.dp), color = paletteColor(Palette.MODAL_TEXT), fontSize = 14.sp, fontWeight = FontWeight.W500, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(artist, Modifier.padding(top = 2.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, lineHeight = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (external) Text("Last.fm ↗", Modifier.padding(top = 2.dp), color = MaterialTheme.colorScheme.secondary, fontSize = 10.sp, letterSpacing = 0.04.em)
    }
}

/** A similar artist as the page's tile: a round picture (their initial until one comes) over the name; "Last.fm ↗" under one who leaves the app. */
@Composable
private fun ArtistTile(a: SimilarArtist, client: () -> ServerClient?, modifier: Modifier) {
    val pic = rememberCover(a.imageKey, 300, client)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(CircleShape).background(paletteColor(Palette.BG_ELEV_2)), contentAlignment = Alignment.Center) {
            Text((a.name.trim().firstOrNull() ?: '?').uppercaseChar().toString(), color = paletteColor(Palette.TEXT_FAINT), fontSize = 26.sp, fontWeight = FontWeight.W600)
            pic?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
        Text(a.name, color = paletteColor(Palette.MODAL_TEXT), fontSize = 12.sp, lineHeight = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        if (!a.inLibrary) Text("Last.fm ↗", color = MaterialTheme.colorScheme.secondary, fontSize = 10.sp, letterSpacing = 0.04.em)
    }
}
