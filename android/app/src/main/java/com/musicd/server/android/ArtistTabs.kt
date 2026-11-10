package com.musicd.server.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.ArtistAbout
import com.musicd.server.client.ArtistBio
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient

/*
 * An artist's page in tabs (the page's artist-tabs.js): Overview, Discography and About under who
 * they are (ArtistHero), as an album's page has its tabs (AlbumTabRow); every artist's page the same. Overview: their
 * albums in a row that scrolls sideways, See all opening Discography, then similar artists and albums (ArtistFoot).
 * Discography: the album grid (ArtistScreen's blocks). About: the biography, asked for only when the tab is first
 * opened, and a band's members or a person's bands.
 */

/** The tabs, in their order. */
internal val ARTIST_TABS = listOf("overview", "discography", "about")

/** The tabs' row: its words tracked out, the one open in the text's colour over a brass bar, centred. */
@Composable
internal fun ArtistTabRow(tab: String, onTab: (String) -> Unit) {
    val faint = paletteColor(Palette.TEXT_FAINT)
    val brass = MaterialTheme.colorScheme.primary
    Column(Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterHorizontally)) {
            ARTIST_TABS.forEachIndexed { i, t ->
                val on = t == tab
                Column(Modifier.parity("artist.tab", Contract.label("artist.tab", i)).width(IntrinsicSize.Max).clickable { onTab(t) }.padding(top = 12.dp)) {
                    Text(Contract.label("artist.tab", i).uppercase(), color = if (on) paletteColor(Palette.MODAL_TEXT) else faint, fontSize = 13.sp,
                        fontWeight = FontWeight.Bold, letterSpacing = 0.06.em, maxLines = 1)
                    Box(Modifier.padding(top = 10.dp).height(2.dp).fillMaxWidth().background(if (on) brass else Color.Transparent))
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
}

/** A section's small heading in capitals (.artist-section-header). */
@Composable
internal fun ArtistSectionTitle(title: String, modifier: Modifier = Modifier) =
    Text(title.uppercase(), modifier.parity("artist.section").padding(top = 12.dp, bottom = 8.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp,
        lineHeight = 18.sp, fontWeight = FontWeight.W600, letterSpacing = 0.06.em)

/** Overview's row: [albums] under "Albums" with See all ([onSeeAll]: Discography); a tap on one opens it ([onOpen], its place). */
@Composable
internal fun OverviewAlbums(albums: List<AlbumSummary>, client: () -> ServerClient?, onOpen: (Int) -> Unit, onSeeAll: () -> Unit) {
    if (albums.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            ArtistSectionTitle("Albums", Modifier.weight(1f))
            Text(Contract.label("artist.see-all"), Modifier.parity("artist.see-all", Contract.label("artist.see-all")).clickable(onClick = onSeeAll).padding(top = 12.dp, bottom = 8.dp, start = 12.dp, end = 14.dp),
                color = MaterialTheme.colorScheme.secondary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W600)
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(end = 14.dp)) {
            items(albums.size, key = { albums[it].offset }) { i -> OverviewAlbum(albums[i], client) { onOpen(i) } }
        }
    }
}

/** One of their albums in Overview's row: its cover, the title and the year. */
@Composable
private fun OverviewAlbum(al: AlbumSummary, client: () -> ServerClient?, onTap: () -> Unit) {
    Column(Modifier.parity("artist.overview-album", Contract.label("artist.overview-album", 0, al.title)).width(128.dp).clickable(onClick = onTap)) {
        Box(Modifier.parity("artist.overview-album-art").fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(6.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
            rememberCover(al.imageKey, 300, client)?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
        Text(al.title, Modifier.parity("artist.overview-album-title").padding(top = 8.dp), color = paletteColor(Palette.MODAL_TEXT), fontSize = 13.sp, fontWeight = FontWeight.W500,
            lineHeight = 17.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        al.year?.let { Text("$it", Modifier.parity("artist.overview-album-year").padding(top = 2.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1) }
    }
}

/**
 * About: the biography ([bio]; [bioDone] once it has answered), then a band's members or a person's bands from [about],
 * or a line saying nothing more is known of them.
 */
@Composable
internal fun ArtistAboutPane(about: ArtistAbout?, bio: ArtistBio?, bioDone: Boolean, client: () -> ServerClient?, onArtist: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        bio?.let { BioText(it) }
        about?.let { a ->
            if (a.members.isNotEmpty()) Stints("Members", a.members, client, onArtist)
            if (a.memberOf.isNotEmpty()) Stints("Member of", a.memberOf, client, onArtist)
        }
        if (bioDone && bio == null && about?.members.isNullOrEmpty() && about?.memberOf.isNullOrEmpty())
            Text("Nothing more is known of them yet", Modifier.parity("artist.about-empty").fillMaxWidth().padding(vertical = 24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 14.sp, lineHeight = 19.sp, textAlign = TextAlign.Center)
    }
}

/** The biography: clipped to five lines with Show more, and where it is from. */
@Composable
private fun BioText(bio: ArtistBio) {
    var more by remember(bio) { mutableStateOf(false) }
    var clipped by remember(bio) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(bottom = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(bio.text, Modifier.parity("artist.bio").fillMaxWidth(), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.5.sp, lineHeight = 21.6.sp,
            maxLines = if (more) Int.MAX_VALUE else 5, onTextLayout = { if (!more) clipped = it.hasVisualOverflow })
        if (clipped || more) Text(Contract.label("artist.bio-more", if (more) 1 else 0), Modifier.parity("artist.bio-more", Contract.label("artist.bio-more", if (more) 1 else 0)).clickable { more = !more }.padding(top = 6.dp, bottom = 4.dp),
            color = MaterialTheme.colorScheme.secondary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
        bio.source?.let { Text("Bio: $it", Modifier.parity("artist.bio-source").padding(top = 2.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 16.sp) }
    }
}

/**
 * A band's members or a person's bands (.artist-stints): the small heading with how many, open (on About,
 * out of the albums' way), a tap folding them (item 140); a row of round pictures that scrolls sideways.
 */
@Composable
private fun Stints(title: String, list: List<ArtistAbout.Stint>, client: () -> ServerClient?, onArtist: (String) -> Unit) {
    var open by rememberSaveable(title) { mutableStateOf(true) }
    Column(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        Row(Modifier.parity("artist.stints-toggle", Contract.label("artist.stints-toggle", 0, title)).clickable { open = !open }.padding(top = 12.dp, bottom = 8.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${title.uppercase()} · ${list.size}", color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W600, letterSpacing = 0.06.em)
            Icon(painterResource(R.drawable.dl_chevron), contentDescription = null, tint = paletteColor(Palette.TEXT_FAINT), modifier = Modifier.size(16.dp).rotate(if (open) 270f else 90f))
        }
        if (open) LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(end = 14.dp)) {
            items(list.size) { i -> StintTile(list[i], client, onArtist) }
        }
    }
}

/** One of them: their picture (or first letter) in a circle, the name, what they played and when. */
@Composable
private fun StintTile(m: ArtistAbout.Stint, client: () -> ServerClient?, onArtist: (String) -> Unit) {
    Column(Modifier.parity("artist.member", Contract.label("artist.member", 0, m.name)).width(96.dp).clickable { onArtist(m.name) }, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.parity("artist.member-art").fillMaxWidth().aspectRatio(1f).clip(CircleShape).background(paletteColor(Palette.BG_ELEV_2)), contentAlignment = Alignment.Center) {
            val art = rememberTileCover(m.photoKey, 300, client)
            if (art != null) Image(art, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else Text(m.name.take(1).uppercase(), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 26.sp, fontWeight = FontWeight.W600)
        }
        Text(m.name, Modifier.parity("artist.member-name").padding(top = 8.dp), color = MaterialTheme.colorScheme.onSurface, fontSize = 12.sp, lineHeight = 15.sp,
            fontWeight = FontWeight.W600, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        m.line?.let { Text(it, Modifier.parity("artist.member-line").padding(top = 1.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.5.sp, lineHeight = 13.65.sp,
            maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center) }
    }
}
