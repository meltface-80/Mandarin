package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract

/**
 * Offline, said at the top of the screen (bug list item 134; the page's #offline-toast, style.css `.offline-toast`):
 * a pill in the middle of the top, over every screen, for as long as the app is offline ([OfflineNow]); it went from
 * its seat in the row along the foot, which now has its five buttons evenly. A tap says why in the app's own dialog
 * (item 105): Offline mode switched off as the page's dialog does it (MusicdDownloads.set), or the server looked for again.
 */
@Composable
internal fun BoxScope.OfflineToastOver() {
    var why by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val kind = OfflineNow.kind.value
    if (why && kind != null) OfflineDialog(kind, onSwitch = { why = false; context.activity()?.let { DownloadsBridge(it).set("offlineMode", "false") } },
        onRetry = { why = false; (context.activity() as? MainActivity)?.lookForServer() }, onClose = { why = false })
    if (kind == null) return
    Box(Modifier.align(Alignment.TopCenter).padding(top = 10.dp)) {
        Row(Modifier.parity("offline-sign.sign", Contract.label("offline-sign.sign")).shadow(8.dp, CircleShape).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).clickable { why = true }.padding(start = 12.dp, end = 14.dp, top = 7.dp, bottom = 7.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(painterResource(R.drawable.tn_offline), contentDescription = null, tint = MaterialTheme.colorScheme.secondary, modifier = Modifier.size(16.dp))
            Text(Contract.label("offline-sign.sign"), color = MaterialTheme.colorScheme.onSurface, fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.W600, maxLines = 1)
        }
    }
}
