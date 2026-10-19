package com.musicd.server.android

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Album
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette

/**
 * The album page's tracks (docs/specs/screens.json, album), as the page's
 * list (style.css, `.track-list`): "TRACKS" tracked out over a hairline,
 * then a row each on its own hairline, its number, its title, who else is
 * on it and its length; the track playing in the room ([playingId]) wears
 * the page's brass disc, turning while the room plays. A tap opens the
 * row's Play now, Play next and Queue, as the page's track menu has them.
 * [onPlay] is given the track's index, how it is played and what to say of it.
 */
internal fun LazyListScope.albumTracks(a: Album, playingId: Long?, playing: Boolean, onPlay: (Int, String, String) -> Unit) {
    item {
        val faint = paletteColor(Palette.TEXT_FAINT)
        Text("Tracks".uppercase(), Modifier.parity("album.tracks-head").fillMaxWidth().padding(bottom = 8.dp),
            color = faint, fontSize = 11.sp, fontWeight = FontWeight.W600, letterSpacing = 0.16.em)
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        HorizontalDivider(Modifier.padding(top = 10.dp), color = MaterialTheme.colorScheme.outline)
    }
    itemsIndexed(a.tracks) { i, t ->
        var open by remember(t.id) { mutableStateOf(false) }
        val white = paletteColor(Palette.MODAL_TEXT)
        val dim = MaterialTheme.colorScheme.onSurfaceVariant
        val rowShape = RoundedCornerShape(10.dp)
        Column(Modifier.parity("album.track", Contract.label("album.track", 0, t.title)).fillMaxWidth()
            .let { m -> if (open) m.clip(rowShape).background(paletteColor(Palette.ROW_OPEN)) else m }.clickable { open = !open }) {
            Row(Modifier.fillMaxWidth().padding(horizontal = if (open) 8.dp else 4.dp, vertical = 10.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.defaultMinSize(minWidth = 22.dp).height(20.dp)) {
                    Text("${i + 1}", color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 20.sp)
                    // The disc on the track playing, in the middle of the room between the number and the name, on the name's line, as the page's (nowdisc.js).
                    if (playingId != null && playingId == t.id) {
                        val turn by rememberInfiniteTransition(label = "disc").animateFloat(0f, 360f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "turn")
                        Icon(painterResource(R.drawable.np_disc), contentDescription = null, tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.parity("album.track-playing").align(Alignment.CenterEnd).offset(x = 13.dp).size(14.dp).let { m -> if (playing) m.rotate(turn) else m })
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text(t.title, color = white, fontSize = 14.sp, lineHeight = 20.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (t.sub.isNotEmpty()) Text(t.sub, Modifier.padding(top = 1.dp), color = dim, fontSize = 12.sp)
                }
                if (t.lengthText.isNotEmpty()) Text(t.lengthText, color = dim, fontSize = 13.sp, lineHeight = 20.sp)
            }
            if (open) {
                // The row's buttons, as the page's (style.css, `.t-actions .action-btn`): 38 tall, Play now in brass, the other two on the raised ground.
                val primary = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary)
                val plain = ButtonDefaults.buttonColors(containerColor = paletteColor(Palette.BG_ELEV_2), contentColor = MaterialTheme.colorScheme.onSurface)
                val edge = Modifier.border(1.dp, MaterialTheme.colorScheme.outline, ButtonDefaults.shape)
                val pad = PaddingValues(horizontal = 18.dp, vertical = 9.dp)
                Row(Modifier.fillMaxWidth().padding(start = 42.dp, end = 8.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { open = false; onPlay(i, "play_now", "Playing") }, colors = primary, contentPadding = pad,
                        modifier = Modifier.parity("album.track-play-now", Contract.label("album.track-play-now")).defaultMinSize(minHeight = 38.dp)) {
                        Text(Contract.label("album.track-play-now"), fontSize = 12.5.sp, fontWeight = FontWeight.W600)
                    }
                    Button(onClick = { open = false; onPlay(i, "play_next", "Playing next") }, colors = plain, contentPadding = pad,
                        modifier = Modifier.parity("album.track-play-next", Contract.label("album.track-play-next")).defaultMinSize(minHeight = 38.dp).then(edge)) {
                        Text(Contract.label("album.track-play-next"), fontSize = 12.5.sp, fontWeight = FontWeight.W600)
                    }
                    Button(onClick = { open = false; onPlay(i, "queue", "Queued") }, colors = plain, contentPadding = pad,
                        modifier = Modifier.parity("album.track-queue", Contract.label("album.track-queue")).defaultMinSize(minHeight = 38.dp).then(edge)) {
                        Text(Contract.label("album.track-queue"), fontSize = 12.5.sp, fontWeight = FontWeight.W600)
                    }
                }
            }
            if (!open) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        }
    }
}
