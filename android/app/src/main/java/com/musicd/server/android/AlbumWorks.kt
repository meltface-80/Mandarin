package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Album
import com.musicd.server.client.Contract
import com.musicd.server.client.Movement
import com.musicd.server.client.NowPlayingView
import com.musicd.server.client.Palette
import com.musicd.server.client.Work

/**
 * A classical album's tracks as works and movements (docs/specs/screens.json,
 * album; public/app/album-works.js draws the page's the same way, bug list
 * item 49): "WORKS" over the list; a work's row with a brass ring that plays
 * it, its name, who it is by where the album has several composers and who
 * performs it, and its length; its movements under it as track rows,
 * indented, each with the track's number; a one-track work its own row; the
 * rest of the tracks as they are; a set's discs heading the list. A tap on a
 * work's row opens Play now, Play next and Queue for the whole work
 * ([onPlayWork]: the work, how it is played and what to say of it).
 */
internal fun LazyListScope.albumWorks(a: Album, playingId: Long?, playing: Boolean, picks: List<Int>?, onPick: (Int) -> Unit,
                                      onPlay: (Int, String, String) -> Unit, onPlayWork: (Work, String, String) -> Unit) {
    tracksHead("Works")
    val discs = a.works.mapNotNull { it.disc }.distinct().size > 1
    val several = a.works.mapNotNull { it.composer }.distinct().size > 1
    var disc: Long? = null
    for (w in a.works) {
        val d = w.disc
        if (discs && d != null && d != disc) { disc = d; item { DiscHead(d) } }
        val movements = w.movements.filter { it.track in a.tracks.indices }
        if (movements.isEmpty()) continue
        if (w.title == null) {
            val m = movements[0]
            item { TrackRow(m.track, a.tracks[m.track], a.tracks[m.track].title, false, discs, playingId, playing, picks, onPick, onPlay) }
            continue
        }
        item { WorkRow(w, movements, several, onPlayWork) }
        if (movements.size > 1) for (m in movements) item { TrackRow(m.track, a.tracks[m.track], m.title, true, discs, playingId, playing, picks, onPick, onPlay) }
    }
}

/** A disc's heading over its works, as the page's (`.t-disc`): small capitals tracked out. */
@Composable
private fun DiscHead(n: Long) {
    Text("Disc $n".uppercase(), Modifier.parity("album.disc-head").fillMaxWidth().padding(start = 4.dp, top = 14.dp, bottom = 4.dp),
        color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, fontWeight = FontWeight.W600, letterSpacing = 0.12.em)
}

/** A work's row (`.t-work`): the ring, its name, who it is by and who performs it, its length; a tap opens its buttons. */
@Composable
private fun WorkRow(w: Work, movements: List<Movement>, several: Boolean, onPlayWork: (Work, String, String) -> Unit) {
    val title = w.title ?: return
    var open by remember(title) { mutableStateOf(false) }
    val white = paletteColor(Palette.MODAL_TEXT)
    val dim = MaterialTheme.colorScheme.onSurfaceVariant
    val brass = MaterialTheme.colorScheme.primary
    val composer = w.composer
    val who = w.performers + listOfNotNull(w.conductor)
    Column(Modifier.parity("album.work", Contract.label("album.work", 0, title)).fillMaxWidth()
        .let { m -> if (open) m.clip(RoundedCornerShape(10.dp)).background(paletteColor(Palette.ROW_OPEN)) else m }
        .clickable { open = !open }) {
        Row(Modifier.fillMaxWidth().padding(horizontal = if (open) 8.dp else 4.dp, vertical = 10.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // The brass ring (`.t-work-play`): the work played now.
            Box(Modifier.parity("album.work-play", Contract.label("album.work-play", 0, title)).size(22.dp).clip(CircleShape).border(1.5.dp, brass, CircleShape)
                .clickable { onPlayWork(w, "play_now", "Playing") }, contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.np_play), contentDescription = null, tint = brass, modifier = Modifier.size(10.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(title, color = white, fontSize = 14.sp, fontWeight = FontWeight.W600, lineHeight = 20.sp)
                if ((several && composer != null) || who.isNotEmpty()) Row(Modifier.padding(top = 1.dp)) {
                    if (several && composer != null) Text(composer + (if (who.isNotEmpty()) " · " else ""), Modifier.parity("album.work-composer"), color = brass, fontSize = 12.sp)
                    if (who.isNotEmpty()) Text(who.joinToString(", "), Modifier.parity("album.work-performers"), color = dim, fontSize = 12.sp)
                }
            }
            Text(NowPlayingView.clock(w.length), Modifier.parity("album.work-length"), color = dim, fontSize = 13.sp, lineHeight = 20.sp)
        }
        if (open) {
            // Its buttons, as a track row's: Play now in brass, the other two on the raised ground.
            val primary = ButtonDefaults.buttonColors(containerColor = brass, contentColor = MaterialTheme.colorScheme.onPrimary)
            val plain = ButtonDefaults.buttonColors(containerColor = paletteColor(Palette.BG_ELEV_2), contentColor = MaterialTheme.colorScheme.onSurface)
            val edge = Modifier.border(1.dp, MaterialTheme.colorScheme.outline, ButtonDefaults.shape)
            val pad = PaddingValues(horizontal = 18.dp, vertical = 9.dp)
            Row(Modifier.fillMaxWidth().padding(start = 42.dp, end = 8.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { open = false; onPlayWork(w, "play_now", "Playing") }, colors = primary, contentPadding = pad,
                    modifier = Modifier.parity("album.work-play-now", Contract.label("album.work-play-now")).defaultMinSize(minHeight = 38.dp)) {
                    Text(Contract.label("album.work-play-now"), fontSize = 12.5.sp, fontWeight = FontWeight.W600)
                }
                Button(onClick = { open = false; onPlayWork(w, "play_next", "Playing next") }, colors = plain, contentPadding = pad,
                    modifier = Modifier.parity("album.work-play-next", Contract.label("album.work-play-next")).defaultMinSize(minHeight = 38.dp).then(edge)) {
                    Text(Contract.label("album.work-play-next"), fontSize = 12.5.sp, fontWeight = FontWeight.W600)
                }
                Button(onClick = { open = false; onPlayWork(w, "queue", "Queued") }, colors = plain, contentPadding = pad,
                    modifier = Modifier.parity("album.work-queue", Contract.label("album.work-queue")).defaultMinSize(minHeight = 38.dp).then(edge)) {
                    Text(Contract.label("album.work-queue"), fontSize = 12.5.sp, fontWeight = FontWeight.W600)
                }
            }
        }
        if (!open) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
}
