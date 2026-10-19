package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import org.json.JSONArray
import org.json.JSONObject

/*
 * Albums selected on a wall (bug list item 52; the page's album-grid.js and
 * invokeAlbumMulti): a long press on a tile starts selecting, with that tile
 * the first pick, and the bar along the foot says "Tap albums to select"
 * until one is; then the ⋯ with the count, top right, opens what to do with
 * them: play now, play next, add to the end of the queue, add to a playlist
 * (the page's sheet), Listen later, or clear. The Library wall, the walls
 * Home links to and an artist's page select alike, so each carries the
 * three screens' keys.
 */

/** The bar along the foot while selecting with nothing picked yet: the hint, and ✕ to stop. */
@Composable
internal fun SelectBar(onCancel: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth()) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outline, modifier = Modifier.align(Alignment.TopCenter))
        Row(Modifier.fillMaxWidth().background(paletteColor(Palette.BG_ELEV_2)).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Tap albums to select", Modifier.parity("library.select-hint wall.select-hint artist.select-hint").weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            Box(Modifier.parity("library.select-cancel wall.select-cancel artist.select-cancel", Contract.label("library.select-cancel")).size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
                .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).clickable(onClick = onCancel), contentAlignment = Alignment.Center) {
                Text("✕", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 16.sp)
            }
        }
    }
}

/** The ⋯ with the count, and its menu; [n] albums picked; [onAct]: play_now, play_next, queue, playlist, later, clear. */
@Composable
internal fun AlbumSelectMenu(n: Int, onAct: (String) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    val plural = if (n == 1) "" else "s"
    Box(modifier) {
        Row(Modifier.parity("library.select-menu wall.select-menu artist.select-menu", Contract.label("library.select-menu", if (n == 1) 1 else 0, n.toString())).height(40.dp).clip(RoundedCornerShape(999.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp))
            .clickable { open = !open }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("$n", Modifier.defaultMinSize(minWidth = 20.dp).height(20.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.primary).padding(horizontal = 5.dp),
                color = MaterialTheme.colorScheme.onPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold, lineHeight = 20.sp)
            Icon(painterResource(R.drawable.np_select_more), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Text("$n album$plural selected", Modifier.parity("library.select-title wall.select-title artist.select-title").padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 8.dp),
                color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, letterSpacing = 0.08.em)
            DropdownMenuItem(text = { Text(Contract.label("library.select-play-now"), fontSize = 15.sp) }, onClick = { open = false; onAct("play_now") },
                modifier = Modifier.parity("library.select-play-now wall.select-play-now artist.select-play-now", Contract.label("library.select-play-now")))
            DropdownMenuItem(text = { Text(Contract.label("library.select-play-next"), fontSize = 15.sp) }, onClick = { open = false; onAct("play_next") },
                modifier = Modifier.parity("library.select-play-next wall.select-play-next artist.select-play-next", Contract.label("library.select-play-next")))
            DropdownMenuItem(text = { Text(Contract.label("library.select-queue"), fontSize = 15.sp) }, onClick = { open = false; onAct("queue") },
                modifier = Modifier.parity("library.select-queue wall.select-queue artist.select-queue", Contract.label("library.select-queue")))
            DropdownMenuItem(text = { Text(Contract.label("library.select-playlist"), fontSize = 15.sp) }, onClick = { open = false; onAct("playlist") },
                modifier = Modifier.parity("library.select-playlist wall.select-playlist artist.select-playlist", Contract.label("library.select-playlist")))
            DropdownMenuItem(text = { Text(Contract.label("library.select-later"), fontSize = 15.sp) }, onClick = { open = false; onAct("later") },
                modifier = Modifier.parity("library.select-later wall.select-later artist.select-later", Contract.label("library.select-later")))
            DropdownMenuItem(text = { Text(Contract.label("library.select-clear"), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 15.sp) }, onClick = { open = false; onAct("clear") },
                modifier = Modifier.parity("library.select-clear wall.select-clear artist.select-clear", Contract.label("library.select-clear")))
        }
    }
}

/** The albums picked, as JSON for the page's Add to playlist sheet ([{offset, title, subtitle, image_key}]). */
internal fun picksJson(picks: List<AlbumSummary>): String =
    JSONArray().also { a -> picks.forEach { p -> a.put(JSONObject().put("offset", p.offset).put("title", p.title).put("subtitle", p.subtitle).put("image_key", p.imageKey ?: JSONObject.NULL)) } }.toString()

/**
 * The picks to the room ([act]: play_now, play_next, queue) or onto Listen later: what came of it, said as the page
 * says it (multiOutcome); an exception's message when the server refused. Run off the main thread.
 */
internal fun selectAct(c: ServerClient, picks: List<AlbumSummary>, zoneId: String, zoneName: String?, act: String): String {
    if (act == "later") { c.listenLater(picks.map { it.offset }, true); return if (picks.size == 1) "Put aside to listen later" else "${picks.size} albums put aside to listen later" }
    val j = c.playMulti(picks, zoneId, act)
    val verb = when (act) { "play_now" -> "Playing"; "play_next" -> "Playing next:"; else -> "Queued" }
    val queued = if (j.has("queued")) j.optInt("queued") else picks.size
    val failed = j.optInt("failed", 0)
    return "$verb $queued album" + (if (queued == 1) "" else "s") + (if (failed > 0) " (Sonos refused $failed)" else "") + " → " + (zoneName ?: "the room")
}
