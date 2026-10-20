package com.musicd.server.android

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Album
import com.musicd.server.client.AlbumExtras
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.PlaylistAdd
import com.musicd.server.client.albumLength

/* An album's page (AlbumScreen.kt), its head's lines and its ⋯ menu, split from it (bug list item 108). */

/** The release date, its label (a tap: the label's albums) and the score after it; nothing until the extras come. */
@Composable
internal fun DateLine(extras: AlbumExtras?, onPage: (String, String?) -> Unit) {
    val e = extras ?: return
    val date = e.date()
    if (date.isEmpty() && e.label == null && e.scoreText == null) return
    Row(Modifier.parity("album.date").padding(top = 3.dp)) {
        val dim = MaterialTheme.colorScheme.onSurfaceVariant
        Text(date, color = dim, fontSize = 14.sp, lineHeight = 19.sp)
        e.label?.let { label ->
            if (date.isNotEmpty()) Text(" · ", color = dim, fontSize = 14.sp, lineHeight = 19.sp)
            Text(label, Modifier.parity("album.label", Contract.label("album.label", 0, label)).clickable { onPage("label", label) },
                color = MaterialTheme.colorScheme.secondary, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        e.scoreText?.let { Text(" · $it" + if (e.bestNewMusic) " BNM" else "", color = dim, fontSize = 14.sp, lineHeight = 19.sp) }
    }
}

/** The rate as the page's chip (hi-res in brass, with a brass edge) and the album's length. */
@Composable
internal fun FactsLine(a: Album) {
    val length = albumLength(a.tracks)
    Row(Modifier.parity("album.facts").padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        a.album.quality?.let {
            val c = if (a.album.hires) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant
            val edge = if (a.album.hires) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
            Text(it, Modifier.border(1.dp, edge, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 1.dp), color = c, fontSize = 12.sp, lineHeight = 16.sp)
        }
        if (length.isNotEmpty()) Text((if (a.album.quality != null) " · " else "") + length, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, lineHeight = 19.sp)
    }
}

/**
 * ⋯: what the server offers beyond Play Now and Queue (Play Next, Shuffle,
 * Radio), a streamed album's favourite on its service ([serviceFavourite],
 * once known), Listen later, the page's own Add to playlist and Edit album,
 * and, for an album of your own files, Download to this phone ([download],
 * the item's words as the store has them).
 */
@Composable
internal fun MoreMenu(a: Album, later: Boolean, onLater: () -> Unit, onPlay: (String, String) -> Unit, onPage: (String, String?) -> Unit,
                     download: String?, onDownload: () -> Unit, serviceFavourite: Boolean?, onServiceFavourite: (Boolean) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val kinds = a.actions.map { it.kind }.toSet()
    val offset = a.album.offset.toString()
    Box {
        OutlinedIconButton(onClick = { open = !open }, shape = RoundedCornerShape(999.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            colors = IconButtonDefaults.outlinedIconButtonColors(contentColor = paletteColor(Palette.MODAL_TEXT)),
            modifier = Modifier.parity("album.more", Contract.label("album.more")).size(40.dp, 42.dp)) {
            Icon(painterResource(R.drawable.np_more), contentDescription = null, modifier = Modifier.size(22.dp))
        }
        // The page's menu (.overflow-menu): 186 wide, each item 15px in 10 of padding, 41 tall.
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, shape = RoundedCornerShape(10.dp), containerColor = paletteColor(Palette.BG_ELEV_2),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), modifier = Modifier.width(186.dp)) {
            if ("play_next" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.play-next"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.play-next", Contract.label("album.play-next")),
                onClick = { open = false; onPlay("play_next", "Playing next") })
            if ("shuffle" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.shuffle"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.shuffle", Contract.label("album.shuffle")),
                onClick = { open = false; onPlay("shuffle", "Shuffling") })
            if ("radio" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.radio"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.radio", Contract.label("album.radio")),
                onClick = { open = false; onPlay("radio", "Radio") })
            val service = a.album.serviceName
            if (service != null && a.album.serviceId != null && serviceFavourite != null) {
                val words = (if (serviceFavourite) "Remove from " else "Add to ") + service
                DropdownMenuItem(text = { Text(Contract.label("album.service-favourite", 0, words), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.service-favourite", Contract.label("album.service-favourite", 0, words)),
                    onClick = { open = false; onServiceFavourite(!serviceFavourite) })
            }
            DropdownMenuItem(text = { Text(Contract.label("album.later", if (later) 1 else 0), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.later", Contract.label("album.later", if (later) 1 else 0)),
                onClick = { open = false; onLater() })
            DropdownMenuItem(text = { Text(Contract.label("album.playlist"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.playlist", Contract.label("album.playlist")),
                onClick = { open = false; PlaylistAddAsk.ask(PlaylistAdd.albums(listOf(a.album))) })
            if (a.album.source == null || a.album.source == "local") DropdownMenuItem(text = { Text(Contract.label("album.edit"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp),
                modifier = Modifier.parity("album.edit", Contract.label("album.edit")), onClick = { open = false; onPage("album-edit", offset) })
            if (download != null) DropdownMenuItem(text = { Text(download, fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.download", Contract.label("album.download", 0)),
                onClick = { open = false; onDownload() })
        }
    }
}
