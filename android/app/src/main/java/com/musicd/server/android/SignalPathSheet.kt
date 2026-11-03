package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.Signal

/**
 * Now playing's lines under the album (item 247), centred: what goes out, how it was made, what is being made for
 * next time; the first brighter. A tap on them opens the signal path when the server said one.
 */
@Composable
internal fun SignalLines(lines: List<String>, onOpen: (() -> Unit)?) {
    val look = Modifier.padding(top = 8.dp).clip(RoundedCornerShape(6.dp))
    // A device Mandarin streams to: the lines open its signal path. Else they are the badge's words, nothing to open.
    if (onOpen != null) Column(Modifier.parity("now-playing.signal", Contract.label("now-playing.signal")).then(look).clickable { onOpen() }.padding(horizontal = 6.dp, vertical = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) { Lines(lines) }
    else Column(Modifier.parity("now-playing.format").then(look).padding(horizontal = 6.dp, vertical = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) { Lines(lines) }
}

// The lines themselves, the first, what goes out, the brighter.
@Composable
private fun Lines(lines: List<String>) {
    val dim = MaterialTheme.colorScheme.onSurfaceVariant
    val text = MaterialTheme.colorScheme.onSurface
    lines.forEachIndexed { i, line ->
        Text(line, fontSize = if (i == 0) 13.sp else 12.sp, fontWeight = if (i == 0) FontWeight.W600 else FontWeight.W500, color = if (i == 0) text else dim,
            textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * The signal path sheet (item 247), as the page's (`.np-signal`): every step from the file to the room, each with a
 * dot for what it did to the sound — nothing (lossless, green), on purpose (enhanced, brass), lost some (lossy, red),
 * not yet (pending, a ring). A tap outside closes it. Drawn at the foot of Now playing, [inset] up.
 */
@Composable
internal fun SignalPathSheet(signal: Signal, onClose: () -> Unit, inset: androidx.compose.ui.unit.Dp = 24.dp) {
    val insetPx = with(LocalDensity.current) { inset.roundToPx() }
    val at = remember(insetPx) { SheetAt(false, insetPx) }
    Popup(popupPositionProvider = at, onDismissRequest = onClose, properties = PopupProperties(focusable = true)) {
        val shape = RoundedCornerShape(16.dp)
        val dim = MaterialTheme.colorScheme.onSurfaceVariant
        Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp).shadow(24.dp, shape).clip(shape).background(paletteColor(Palette.BG_VEIL))
                .border(1.dp, paletteColor(Palette.GLASS_EDGE), shape).heightIn(max = 520.dp).verticalScroll(rememberScrollState())
                .padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("SIGNAL PATH", Modifier.parity("now-playing.signal-title"), fontSize = 11.sp, letterSpacing = 0.08.sp, color = paletteColor(Palette.TEXT_FAINT))
            for (step in signal.steps) {
                Row(Modifier.parity("now-playing.signal-step").fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val ring = step.quality == "pending"
                    Box(Modifier.padding(top = 4.dp).size(10.dp).clip(CircleShape)
                        .then(if (ring) Modifier.border(1.dp, dim, CircleShape) else Modifier.background(qualityColor(step.quality))))
                    Column {
                        Text(step.title, fontSize = 14.sp, fontWeight = FontWeight.W600, color = MaterialTheme.colorScheme.onSurface)
                        Text(step.detail, fontSize = 13.sp, lineHeight = 17.5.sp, color = dim)
                    }
                }
            }
        }
    }
}

@Composable
private fun qualityColor(quality: String): Color = when (quality) {
    "lossless" -> Color(0xFF6FBF73)
    "enhanced" -> MaterialTheme.colorScheme.primary
    "lossy" -> paletteColor(Palette.DANGER)
    else -> paletteColor(Palette.TEXT_FAINT)
}
