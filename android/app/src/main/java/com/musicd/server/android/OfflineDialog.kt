package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.musicd.server.client.Contract
import com.musicd.server.client.OfflineKind
import com.musicd.server.client.OfflineNote
import com.musicd.server.client.Palette

/**
 * The page's Offline dialog, natively (docs/specs/screens.json, offline; server-notice.js openOffline; bug list item 105),
 * opened from the row's Offline sign and drawn as the page draws it (style.css .confirm-box, .offline-box): up to 380 wide
 * within the screen's 24 each side, the heading in Young Serif 20 in the middle, why in 14 dim a paragraph each, then, when
 * Offline mode is on, "Switch offline mode off" beside Close, or, the server out of reach, "Try the server again" (item 110),
 * Close in brass. [onSwitch] turns Offline mode off; [onRetry] looks for the server now; Close, a tap outside or Back is [onClose].
 */
@Composable
internal fun OfflineDialog(kind: OfflineKind, onSwitch: () -> Unit, onRetry: () -> Unit, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect { window?.setDimAmount(0.55f) }
        val box = RoundedCornerShape(18.dp)
        // The width the page's has (24 in from each side, 380 at most), the platform's own narrower one set aside; a tap
        // beside the box is the dialog's own outside tap.
        Box(Modifier.padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
            Column(Modifier.widthIn(max = 380.dp).fillMaxWidth().clip(box).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outline, box)
                .padding(start = 20.dp, top = 22.dp, end = 20.dp, bottom = 16.dp)) {
                Text(OfflineNote.title(kind), Modifier.parity("offline.title").fillMaxWidth().padding(bottom = 10.dp), color = paletteColor(Palette.TEXT),
                    fontFamily = youngSerif, fontWeight = FontWeight.W400, fontSize = 20.sp, lineHeight = 26.sp, textAlign = TextAlign.Center)
                Column(Modifier.parity("offline.text").padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (line in OfflineNote.lines(kind)) Text(line, color = paletteColor(Palette.TEXT_DIM), fontSize = 14.sp, lineHeight = 20.3.sp)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val button = RoundedCornerShape(12.dp)
                    if (OfflineNote.canSwitch(kind)) Box(Modifier.parity("offline.switch", Contract.label("offline.switch")).weight(1f).height(44.dp).clip(button)
                        .background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, MaterialTheme.colorScheme.outline, button).clickable(onClick = onSwitch), contentAlignment = Alignment.Center) {
                        Text(Contract.label("offline.switch"), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 18.sp, fontWeight = FontWeight.W600, textAlign = TextAlign.Center, maxLines = 2)
                    }
                    if (OfflineNote.canRetry(kind)) Box(Modifier.parity("offline.retry", Contract.label("offline.retry")).weight(1f).height(44.dp).clip(button)
                        .background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, MaterialTheme.colorScheme.outline, button).clickable(onClick = onRetry), contentAlignment = Alignment.Center) {
                        Text(Contract.label("offline.retry"), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 18.sp, fontWeight = FontWeight.W600, textAlign = TextAlign.Center, maxLines = 2)
                    }
                    Box(Modifier.parity("offline.close", Contract.label("offline.close")).weight(1f).height(44.dp).clip(button).background(MaterialTheme.colorScheme.primary)
                        .clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                        Text(Contract.label("offline.close"), color = MaterialTheme.colorScheme.onPrimary, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600)
                    }
                }
            }
        }
    }
}
