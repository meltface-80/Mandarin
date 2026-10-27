package com.musicd.server.android

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShelfCase
import com.musicd.server.client.ShelfPlaying

/**
 * The native Shelf's album view (bug list item 207; docs/specs/screens.json, shelf-album), as the page's shelf-back.js
 * and shelf-about.js draw it on a phone: over the whole screen above the bar, Back on the cover, the cover edge to edge
 * fading into the ground, the album, its artist and its label · catalogue № · kinds · year, Play now and Add to queue
 * (or, with tracks chosen, how many, ×, Play now, Play next and Queue), Tracks — a set's under each disc's heading, a
 * hold choosing one and a tap adding more — then About this album and More by the artist, a tile each, which turns the
 * shelf to that album and opens it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ShelfAlbumView(shelf: ShelfControl, play: ShelfPlay, a: ShelfCase, rem: Dp, client: () -> ServerClient?, openZones: () -> Unit, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lib = shelf.lib
    val line = if (lib == null) "" else shelf.choices.lineOf(lib, a)
    val picks = if (play.pickedOn == a.offset) play.picks else emptySet()
    val dim = paletteColor(Palette.TEXT_DIM); val faint = paletteColor(Palette.TEXT_FAINT); val brass = paletteColor(Palette.ACCENT)
    fun open(url: String) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    Box(modifier.fillMaxSize().background(paletteColor(Palette.BG))) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = rem * 1.2f, end = rem * 1.2f, bottom = rem * 2f)) {
            // the cover, edge to edge, fading into the ground; the title under it, never on it
            val cover = rememberCover(a.imageKey, 600, client)
            Box(Modifier.parity("shelf-album.cover").padding(horizontal = 0.dp).fillMaxWidth().aspectRatio(1f).background(paletteColor(Palette.BG_ELEV_2))) {
                cover?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.58f to Color.Transparent, 0.78f to paletteColor(Palette.BG).copy(alpha = 0.28f), 1f to paletteColor(Palette.BG))))
            }
            Text(a.title, Modifier.parity("shelf-album.title").fillMaxWidth().padding(top = rem * 0.9f, bottom = rem * 0.35f), color = paletteColor(Palette.TEXT), fontFamily = youngSerif,
                fontSize = (rem.value * 1.9f).sp, lineHeight = (rem.value * 1.9f * 1.12f).sp, letterSpacing = (-0.01).em, textAlign = TextAlign.Center)
            Text(a.artist, Modifier.parity("shelf-album.artist").fillMaxWidth(), color = dim, fontSize = (rem.value * 1.05f).sp, textAlign = TextAlign.Center)
            if (line.isNotEmpty()) Text(line.uppercase(), Modifier.parity("shelf-album.line").fillMaxWidth().padding(top = rem * 0.5f), color = faint, fontSize = (rem.value * 0.78f).sp,
                fontWeight = FontWeight.W700, letterSpacing = 0.1.em, textAlign = TextAlign.Center)
            // the album's buttons, or the chosen tracks' in their place
            FlowRow(Modifier.fillMaxWidth().padding(top = rem), horizontalArrangement = Arrangement.spacedBy(rem * 0.6f, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(rem * 0.6f)) {
                if (picks.isEmpty()) {
                    Act(Modifier.parity("shelf-album.play", Contract.label("shelf-album.play")).clip(CircleShape).clickable { play.playAlbum(a, "play_now", openZones) }, "Play now", rem, true, R.drawable.np_play)
                    Act(Modifier.parity("shelf-album.queue", Contract.label("shelf-album.queue")).clip(CircleShape).clickable { play.playAlbum(a, "queue", openZones) }, "Queue", rem, false, R.drawable.rp_queue)
                } else {
                    Box(Modifier.parity("shelf-album.chosen-clear", Contract.label("shelf-album.chosen-clear")).size(rem * 2.3f).clip(CircleShape).border(1.dp, paletteColor(Palette.BORDER), CircleShape)
                        .clickable { play.endPicks() }, contentAlignment = Alignment.Center) {
                        Icon(painterResource(R.drawable.np_close), contentDescription = null, tint = dim, modifier = Modifier.size(rem * 1.05f))
                    }
                    Text(ShelfPlaying.chosenSaid(picks.size), Modifier.parity("shelf-album.chosen-count").align(Alignment.CenterVertically), color = paletteColor(Palette.TEXT),
                        fontSize = (rem.value * 0.95f).sp, fontWeight = FontWeight.W700)
                    Act(Modifier.parity("shelf-album.chosen-play", Contract.label("shelf-album.chosen-play")).clip(CircleShape).clickable { play.playPicks(a, "play_now", openZones) }, "Play now", rem, true, null)
                    Act(Modifier.parity("shelf-album.chosen-next", Contract.label("shelf-album.chosen-next")).clip(CircleShape).clickable { play.playPicks(a, "play_next", openZones) }, "Play next", rem, false, null)
                    Act(Modifier.parity("shelf-album.chosen-queue", Contract.label("shelf-album.chosen-queue")).clip(CircleShape).clickable { play.playPicks(a, "queue", openZones) }, "Queue", rem, false, null)
                }
            }
            Label(Modifier.parity("shelf-album.tracks-head"), "Tracks", rem)
            val st = play.tracks[a.offset]
            if (st == null || st.titles.isEmpty()) Text(play.trackTrouble[a.offset] ?: if (st == null) "Reading the track list…" else "This album lists no tracks.",
                Modifier.parity("shelf-album.tracks-message").padding(top = rem * 0.6f), color = dim, fontSize = (rem.value * 0.95f).sp)
            else for (r in st.rows) {
                if (r.disc != null) Text(r.disc.orEmpty().uppercase(), Modifier.parity("shelf-album.disc").padding(start = rem * 0.3f, top = rem, bottom = rem * 0.4f),
                    color = paletteColor(Palette.ACCENT_TEXT), fontSize = (rem.value * 0.72f).sp, fontWeight = FontWeight.W800, letterSpacing = 0.14.em)
                else {
                    val on = r.index in picks
                    Row(Modifier.parity("shelf-album.track", Contract.label("shelf-album.track", 0, r.title)).fillMaxWidth()
                        .pointerInput(a.offset, r.index, picks.isEmpty()) {
                            detectTapGestures(
                                // a hold chooses it; while some are chosen, a tap adds or takes it away
                                onLongPress = { if (picks.isEmpty()) play.pick(a, r.index, true) },
                                onTap = { if (picks.isNotEmpty()) play.pick(a, r.index, null) })
                        }
                        .background(if (on) paletteColor(Palette.ACCENT_SOFT) else Color.Transparent, RoundedCornerShape(rem * 0.35f))
                        .padding(horizontal = rem * 0.3f, vertical = rem * 0.62f), horizontalArrangement = Arrangement.spacedBy(rem * 0.8f)) {
                        if (on) Icon(painterResource(R.drawable.dv_tick), contentDescription = null, tint = paletteColor(Palette.ACCENT_TEXT), modifier = Modifier.padding(top = 2.dp).widthIn(min = rem * 1.5f).size(rem * 0.95f))
                        else Text(r.number.toString(), Modifier.widthIn(min = rem * 1.5f), color = faint, fontSize = (rem.value * 0.8f).sp, lineHeight = (rem.value * 1.28f).sp, textAlign = TextAlign.End)
                        Text(r.title, color = paletteColor(Palette.TEXT), fontSize = (rem.value * 0.95f).sp, lineHeight = (rem.value * 1.28f).sp)
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
                }
            }
            // About this album, and More by the artist
            val more = play.more[a.offset]
            if (more == null) Text("Reading about this album…", Modifier.parity("shelf-album.about-reading").padding(top = rem * 1.2f), color = dim, fontSize = (rem.value * 0.85f).sp)
            play.reviews[a.offset]?.let { r ->
                Label(Modifier.parity("shelf-album.about-head"), "About this album", rem)
                r.text?.let { Text(it, Modifier.parity("shelf-album.about-text"), color = dim, fontSize = (rem.value * 0.92f).sp, lineHeight = (rem.value * 0.92f * 1.55f).sp) }
                r.attribution?.let { from -> Row(Modifier.parity("shelf-album.about-from").padding(top = rem * 0.5f)) {
                    val url = r.textSourceUrl
                    if (url == null) Text(from, color = faint, fontSize = (rem.value * 0.78f).sp)
                    else Text(from, Modifier.parity("shelf-album.about-from-link", Contract.label("shelf-album.about-from-link", 0, r.textSource.orEmpty())).clickable { open(url) },
                        color = faint, fontSize = (rem.value * 0.78f).sp)
                } }
                val link = r.linkText; val url = r.url
                if (link != null && url != null) Text(link, Modifier.parity("shelf-album.about-link", Contract.label("shelf-album.about-link", if (r.source == "Pitchfork") 0 else 1, r.source.orEmpty()))
                    .padding(top = rem * 0.6f).clickable { open(url) }, color = paletteColor(Palette.ACCENT_TEXT), fontSize = (rem.value * 0.85f).sp, fontWeight = FontWeight.W700)
            }
            if (more != null && more.albums.isNotEmpty()) {
                Label(Modifier.parity("shelf-album.more-head"), "More by ${more.artist}", rem)
                for (row in more.albums.chunked(3)) Row(Modifier.fillMaxWidth().padding(bottom = rem * 0.8f), horizontalArrangement = Arrangement.spacedBy(rem * 0.7f)) {
                    for ((offset, title, key) in row) MoreTile(Modifier.parity("shelf-album.more", Contract.label("shelf-album.more", 0, title)).weight(1f).clickable {
                        val at = shelf.list.indexOfFirst { it.offset == offset }
                        if (at < 0) shelf.say("That album isn’t on this shelf — clear the choices to find it") else shelf.bringTo(at, open = true)
                    }, title, key, rem, client)
                    repeat(3 - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
        // Back, on the artwork: a dark scrim under a light chevron, as the remote's album screen has it
        Box(Modifier.statusBarsPadding().padding(14.dp).parity("shelf-album.back", Contract.label("shelf-album.back")).size(rem * 2.6f).clip(CircleShape).background(Color(0x6B000000))
            .border(1.dp, Color(0x3DFFFFFF), CircleShape).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.np_back), contentDescription = null, tint = Color.White, modifier = Modifier.size(rem * 1.3f))
        }
    }
}

/** A button under the cover: Play now in the brass, the rest plain. */
@Composable
private fun Act(modifier: Modifier, words: String, rem: Dp, primary: Boolean, icon: Int?) {
    val brass = paletteColor(Palette.ACCENT)
    val ground = if (primary) Modifier.background(brass, CircleShape) else Modifier.background(paletteColor(Palette.BG_ELEV), CircleShape).border(1.dp, paletteColor(Palette.BORDER), CircleShape)
    Row(modifier.then(ground).height(rem * 2.9f).padding(horizontal = rem * 1.3f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(rem * 0.45f)) {
        val ink = paletteColor(if (primary) Palette.ON_ACCENT else Palette.TEXT)
        icon?.let { Icon(painterResource(it), contentDescription = null, tint = ink, modifier = Modifier.size(rem * 1.1f)) }
        Text(words, color = ink, fontSize = (rem.value * 0.95f).sp, fontWeight = FontWeight.W700)
    }
}

/** A section's heading: small capitals, tracked out, over a hairline. */
@Composable
private fun Label(modifier: Modifier, words: String, rem: Dp) {
    Column(modifier.fillMaxWidth().padding(top = rem * 1.5f, bottom = rem * 0.4f)) {
        Text(words.uppercase(), Modifier.padding(bottom = rem * 0.5f), color = paletteColor(Palette.TEXT_FAINT), fontSize = (rem.value * 0.72f).sp, fontWeight = FontWeight.W800,
            letterSpacing = 0.14.em, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
    }
}

/** One of the artist's other albums: its cover and its title. */
@Composable
private fun MoreTile(modifier: Modifier, title: String, key: String?, rem: Dp, client: () -> ServerClient?) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(rem * 0.35f)) {
        val cover = rememberTileCover(key, 300, client)
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(3.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
            cover?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
        Text(title, color = paletteColor(Palette.TEXT_DIM), fontSize = (rem.value * 0.78f).sp, lineHeight = (rem.value * 0.78f * 1.25f).sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
