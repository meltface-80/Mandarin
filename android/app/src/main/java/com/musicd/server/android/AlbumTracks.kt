package com.musicd.server.android

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Album
import com.musicd.server.client.Contract

/**
 * The album page's tracks (docs/specs/screens.json, album): a row each, its
 * title, who else is on it and its length; a tap opens its Play now, Play
 * next and Queue, as the page's track menu has them. [onPlay] is given the
 * track's index, how it is played and what to say of it.
 */
internal fun LazyListScope.albumTracks(a: Album, onPlay: (Int, String, String) -> Unit) {
    item {
        Text("Tracks", Modifier.parity("album.tracks-head").padding(top = 4.dp, bottom = 6.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    }
    itemsIndexed(a.tracks) { i, t ->
        var open by remember(t.id) { mutableStateOf(false) }
        Column(Modifier.parity("album.track", Contract.label("album.track", 0, t.title)).fillMaxWidth().clickable { open = !open }) {
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${i + 1}", Modifier.padding(end = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                Column(Modifier.weight(1f)) {
                    Text(t.title, color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (t.sub.isNotEmpty()) Text(t.sub, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (t.lengthText.isNotEmpty()) Text(t.lengthText, Modifier.padding(start = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            }
            if (open) {
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { open = false; onPlay(i, "play_now", "Playing") },
                        modifier = Modifier.parity("album.track-play-now", Contract.label("album.track-play-now"))) { Text(Contract.label("album.track-play-now")) }
                    OutlinedButton(onClick = { open = false; onPlay(i, "play_next", "Playing next") },
                        modifier = Modifier.parity("album.track-play-next", Contract.label("album.track-play-next"))) { Text(Contract.label("album.track-play-next")) }
                    OutlinedButton(onClick = { open = false; onPlay(i, "queue", "Queued") },
                        modifier = Modifier.parity("album.track-queue", Contract.label("album.track-queue"))) { Text(Contract.label("album.track-queue")) }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        }
    }
}
