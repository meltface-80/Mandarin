package com.musicd.server.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumCredits
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient

/**
 * An album's credits under its tracks (bug list item 132; the page's album-credits.js, #album-credits): who played,
 * sang, wrote and made it, in the server's order, each a round picture (theirs once found, else their first letter),
 * the name, and their parts with which tracks when not all. Eight at first, More for the rest; a tap opens their
 * page ([onArtist]). Not there when nothing is known.
 */
internal fun LazyListScope.albumCredits(credits: AlbumCredits?, client: () -> ServerClient?, onArtist: (String) -> Unit) {
    val list = credits?.credits?.takeIf { it.isNotEmpty() } ?: return
    item {
        var open by remember { mutableStateOf(false) }
        Column(Modifier.parity("album.credits").fillMaxWidth().padding(top = 36.dp)) {
            // The section's head, as the page's section-label: small capitals tracked out over a hairline.
            Text("Credits".uppercase(), Modifier.padding(bottom = 8.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, fontWeight = FontWeight.W600, letterSpacing = 0.16.em)
            HorizontalDivider(Modifier.padding(bottom = 6.dp), color = MaterialTheme.colorScheme.outline)
            for (c in if (open) list else list.take(AlbumCredits.SHOWN)) CreditRow(c, client, onArtist)
            if (list.size > AlbumCredits.SHOWN) TextButton(onClick = { open = !open }, modifier = Modifier.parity("album.credits-more", Contract.label("album.credits-more", if (open) 1 else 0))) {
                Text(Contract.label("album.credits-more", if (open) 1 else 0), color = MaterialTheme.colorScheme.secondary, fontSize = 13.sp, fontWeight = FontWeight.W500)
            }
        }
    }
}

/** One of them: the round picture, the name over their parts. */
@Composable
private fun CreditRow(c: AlbumCredits.Credit, client: () -> ServerClient?, onArtist: (String) -> Unit) {
    Row(Modifier.parity("album.credit", Contract.label("album.credit", 0, c.name)).fillMaxWidth().clickable { onArtist(c.name) }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.parity("album.credit-art").size(40.dp).clip(CircleShape).background(paletteColor(Palette.BG_ELEV_2)), contentAlignment = Alignment.Center) {
            val art = rememberTileCover(c.photoKey, 120, client)
            if (art != null) Image(art, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else Text(c.name.take(1).uppercase(), color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, fontWeight = FontWeight.W600)
        }
        Column(Modifier.weight(1f)) {
            Text(c.name, Modifier.parity("album.credit-name"), color = paletteColor(Palette.MODAL_TEXT), fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (c.line.isNotEmpty()) Text(c.line, Modifier.parity("album.credit-roles"), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.5.sp, lineHeight = 17.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}
