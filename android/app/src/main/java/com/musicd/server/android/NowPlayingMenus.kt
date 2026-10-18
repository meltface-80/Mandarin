package com.musicd.server.android

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.musicd.server.client.Contract
import com.musicd.server.client.NowPlayingView
import com.musicd.server.client.Room
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * Now playing's two menus under the transport, as the page's popovers have
 * them (docs/specs/screens.json, now-playing): Play on, and the volume.
 */

/**
 * Play on: the rooms, the one playing here marked, each a tap to play there;
 * then Group zones and Device power, which are the page's own sheets
 * ([onPage]), and the all-room actions.
 */
@Composable
internal fun PlayOnMenu(zoneId: String, client: () -> ServerClient?, act: ((ServerClient) -> Unit) -> Unit, onRoom: (String) -> Unit, onPage: (String, String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var rooms by remember { mutableStateOf<List<Room>>(emptyList()) }
    LaunchedEffect(open) {
        val c = client() ?: return@LaunchedEffect
        if (open) rooms = withContext(Dispatchers.IO) { runCatching { c.rooms() }.getOrNull() } ?: rooms
    }
    Box {
        IconButton(onClick = { open = !open }, modifier = Modifier.parity("now-playing.device", Contract.label("now-playing.device"))) {
            Icon(painterResource(R.drawable.np_device), contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Text("Play on", Modifier.parity("now-playing.device-title").padding(horizontal = 16.dp, vertical = 8.dp),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            for (r in rooms) {
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(r.name, color = if (r.id == zoneId) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurface)
                            if (r.outputs.size > 1) Text(r.outputs.joinToString(" + "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                    onClick = { open = false; if (r.id != zoneId) onRoom(r.id) },
                    modifier = Modifier.parity("now-playing.device-room", Contract.label("now-playing.device-room", 0, r.name))
                )
            }
            HorizontalDivider()
            DropdownMenuItem(text = { Text(Contract.label("now-playing.group")) }, onClick = { open = false; onPage("group", null) },
                modifier = Modifier.parity("now-playing.group", Contract.label("now-playing.group")))
            DropdownMenuItem(text = { Text(Contract.label("now-playing.power")) }, onClick = { open = false; onPage("power", null) },
                modifier = Modifier.parity("now-playing.power", Contract.label("now-playing.power")))
            DropdownMenuItem(text = { Text(Contract.label("now-playing.pause-all")) }, onClick = { open = false; act { it.pauseAll() } },
                modifier = Modifier.parity("now-playing.pause-all", Contract.label("now-playing.pause-all")))
            DropdownMenuItem(text = { Text(Contract.label("now-playing.mute-all")) }, onClick = { open = false; act { it.muteAll(true) } },
                modifier = Modifier.parity("now-playing.mute-all", Contract.label("now-playing.mute-all")))
            DropdownMenuItem(text = { Text(Contract.label("now-playing.unmute-all")) }, onClick = { open = false; act { it.muteAll(false) } },
                modifier = Modifier.parity("now-playing.unmute-all", Contract.label("now-playing.unmute-all")))
        }
    }
}

/**
 * The volume: where it is, a slider over the speaker's own scale, a step
 * down and up; a speaker with no scale has only the steps, and a room with
 * no volume says it is fixed. The value follows a drag at once and is sent
 * as it ends, as the page's slider does.
 */
@Composable
internal fun VolumeMenu(zoneId: String, v: NowPlayingView, act: ((ServerClient) -> Unit) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var dragging by remember { mutableStateOf<Float?>(null) }
    Box {
        IconButton(onClick = { open = !open }, modifier = Modifier.parity("now-playing.volume", Contract.label("now-playing.volume"))) {
            Icon(painterResource(if (v.muted) R.drawable.np_mute else R.drawable.np_volume), contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            val s = v.volume
            if (s == null) {
                Text("Volume control is fixed", Modifier.parity("now-playing.volume-fixed").padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                return@DropdownMenu
            }
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp).width(260.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text((dragging?.toDouble() ?: s.value)?.let { Math.round(it).toString() } ?: "—", Modifier.parity("now-playing.volume-level"),
                    style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface)
                if (!s.incremental) {
                    Slider(
                        value = dragging ?: (s.value ?: s.min).toFloat(),
                        onValueChange = { dragging = it },
                        onValueChangeFinished = { val d = dragging; dragging = null; if (d != null) act { it.zoneVolume(zoneId, d.toDouble()) } },
                        valueRange = s.min.toFloat()..s.max.toFloat(),
                        modifier = Modifier.parity("now-playing.volume-slider", Contract.label("now-playing.volume-slider"))
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { step(zoneId, v, -1, act) }, modifier = Modifier.parity("now-playing.volume-down", Contract.label("now-playing.volume-down"))) {
                        Icon(painterResource(R.drawable.np_minus), contentDescription = null)
                    }
                    IconButton(onClick = { step(zoneId, v, 1, act) }, modifier = Modifier.parity("now-playing.volume-up", Contract.label("now-playing.volume-up"))) {
                        Icon(painterResource(R.drawable.np_plus), contentDescription = null)
                    }
                }
            }
        }
    }
}

/** A step of the room's volume: on its scale, or a nudge where it has none. */
private fun step(zoneId: String, v: NowPlayingView, direction: Int, act: ((ServerClient) -> Unit) -> Unit) {
    val s = v.volume ?: return
    if (s.incremental) act { it.zoneVolumeStep(zoneId, direction) }
    else v.volumeStep(direction)?.let { to -> act { it.zoneVolume(zoneId, to) } }
}
