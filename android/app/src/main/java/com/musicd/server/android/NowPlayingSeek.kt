package com.musicd.server.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.musicd.server.client.Contract
import com.musicd.server.client.NowPlayingView
import com.musicd.server.client.ServerClient
import com.musicd.server.client.Waveform
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * Now playing's seek bar, where the track is and how long it is, as the
 * page's (docs/specs/screens.json, now-playing): drawn over the track's
 * waveform when the server draws them (Settings), the played part in brass;
 * a plain bar while there is none. A drag shows its time at once and seeks
 * ([onSeek], in seconds) as it ends.
 */
@Composable
internal fun SeekBar(v: NowPlayingView, now: Long, client: () -> ServerClient?, onSeek: (Double) -> Unit) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    val length = v.lengthSeconds
    // The track's levels, asked for once a track (the page's key: its title and album); again while the server is busy.
    var levels by remember(v.title, v.album) { mutableStateOf<ByteArray?>(null) }
    LaunchedEffect(v.title, v.album) {
        val c = client() ?: return@LaunchedEffect
        if (!withContext(Dispatchers.IO) { runCatching { c.waveformOn() }.getOrDefault(false) }) return@LaunchedEffect
        for (attempt in 0 until 10) {
            val r = withContext(Dispatchers.IO) { runCatching { c.waveform(v.title, v.album, v.artist, length) } }
            if (r.exceptionOrNull() !is ServerClient.Busy) { levels = r.getOrNull(); break }
            delay(3000)
        }
    }
    val fraction = dragging ?: v.fraction(now)
    val played = MaterialTheme.colorScheme.secondary
    val ahead = MaterialTheme.colorScheme.onSurfaceVariant
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        levels?.let { lv ->
            // Inset by half the thumb, as the page's is, so a peak is under the thumb as it is heard.
            Canvas(Modifier.parity("now-playing.wave").fillMaxWidth().padding(horizontal = 10.dp).height(34.dp)) {
                val pitch = 3.dp.toPx() / 2
                val bars = Waveform.bars(lv, maxOf(1, (size.width / pitch).toInt()))
                val step = size.width / bars.size
                val head = fraction * size.width
                bars.forEachIndexed { i, h ->
                    val x = i * step
                    val barH = maxOf(1f, h * (size.height - 2))
                    val done = x + step / 2 <= head
                    drawRect(if (done) played else ahead.copy(alpha = 0.72f), Offset(x, (size.height - barH) / 2), Size(step * 2 / 3, barH))
                }
            }
        }
        Slider(
            value = fraction,
            onValueChange = { dragging = it },
            onValueChangeFinished = {
                val f = dragging
                dragging = null
                if (f != null && length != null) onSeek(f * length)
            },
            modifier = Modifier.parity("now-playing.seek", Contract.label("now-playing.seek")),
            enabled = length != null,
            // Over a waveform the bar's own track would draw a line through it: the waveform shows the split.
            colors = if (levels != null) SliderDefaults.colors(activeTrackColor = Color.Transparent, inactiveTrackColor = Color.Transparent) else SliderDefaults.colors()
        )
    }
    Row(Modifier.fillMaxWidth()) {
        Text(NowPlayingView.clock(dragging?.let { it * (length ?: 0.0) } ?: v.position(now)), Modifier.parity("now-playing.position"),
            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.weight(1f))
        Text(length?.let { NowPlayingView.clock(it) }.orEmpty(), Modifier.parity("now-playing.length"),
            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
