package com.musicd.server.android

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.ArtistAbout
import com.musicd.server.client.ArtistBio
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlin.math.min

/**
 * The head of an artist's page (bug list item 131; the page's artist-about.js, .artist-bio-head): their picture,
 * round and centred (their own once the server has found one, else the biography's portrait); what they are, where
 * from and when; their links as pills; the biography clipped with Show more and where it is from; then a band's
 * members or a person's bands, each a round picture with the name and what they played, a tap opening their page.
 */
@Composable
internal fun ArtistHero(about: ArtistAbout?, bio: ArtistBio?, client: () -> ServerClient?, onArtist: (String) -> Unit, onGenre: (String) -> Unit = {}) {
    val own = rememberTileCover(about?.photoKey, 600, client)
    val portrait = own ?: rememberImage(bio?.image, client)
    val side = min(200, (LocalConfiguration.current.screenWidthDp * 0.46).toInt()).dp
    Column(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        portrait?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.parity("artist.avatar").padding(bottom = 14.dp).size(side).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) }
        about?.facts?.let { Text(it, Modifier.parity("artist.facts").padding(bottom = 10.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.5.sp, lineHeight = 19.sp, fontWeight = FontWeight.W500, textAlign = TextAlign.Center) }
        about?.genres?.let { GenreChips(it, "artist", center = true, modifier = Modifier.padding(bottom = 12.dp), onGenre = onGenre) }   // item 139
        about?.linkList?.takeIf { it.isNotEmpty() }?.let { ArtistLinks(it) }
        bio?.let { BioText(it) }
    }
    about?.let { a ->
        if (a.members.isNotEmpty()) Stints("Members", a.members, client, onArtist)
        if (a.memberOf.isNotEmpty()) Stints("Member of", a.memberOf, client, onArtist)
    }
}

/** Their links, as pills that wrap, centred (.artist-links); each opens in the browser. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ArtistLinks(links: List<Pair<String, String>>) {
    val context = LocalContext.current
    FlowRow(Modifier.fillMaxWidth().padding(bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((label, url) in links) Box(Modifier.parity("artist.link", Contract.label("artist.link", 0, label)).clip(RoundedCornerShape(20.dp)).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(20.dp))
            .clickable { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }.padding(horizontal = 12.dp, vertical = 5.dp)) {
            Text(label, color = MaterialTheme.colorScheme.onSurface, fontSize = 12.5.sp, lineHeight = 17.sp, maxLines = 1)
        }
    }
}

/** The biography: clipped to five lines with Show more, and where it is from. */
@Composable
private fun BioText(bio: ArtistBio) {
    var more by remember(bio) { mutableStateOf(false) }
    var clipped by remember(bio) { mutableStateOf(false) }
    Text(bio.text, Modifier.parity("artist.bio").fillMaxWidth(), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.5.sp, lineHeight = 21.6.sp,
        maxLines = if (more) Int.MAX_VALUE else 5, onTextLayout = { if (!more) clipped = it.hasVisualOverflow })
    if (clipped || more) Text(Contract.label("artist.bio-more", if (more) 1 else 0), Modifier.parity("artist.bio-more", Contract.label("artist.bio-more", if (more) 1 else 0)).clickable { more = !more }.padding(top = 6.dp, bottom = 4.dp),
        color = MaterialTheme.colorScheme.secondary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
    bio.source?.let { Text("Bio: $it", Modifier.parity("artist.bio-source").padding(top = 2.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 16.sp) }
}

/** A band's members or a person's bands (.artist-stints): the small heading, then a row of round pictures that scrolls sideways. */
@Composable
private fun Stints(title: String, list: List<ArtistAbout.Stint>, client: () -> ServerClient?, onArtist: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        Text(title.uppercase(), Modifier.parity("artist.section").padding(top = 12.dp, bottom = 8.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W600, letterSpacing = 0.06.em)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(end = 14.dp)) {
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
