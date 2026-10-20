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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.PageNotices
import com.musicd.server.client.Palette

/**
 * The page's notices as it last told them (public/app/native-notices.js, [AppBridge.notices]; bug list item 69): the
 * server's notice and the update offer, drawn at the head of the native Home as the page draws them at the head of its own.
 */
internal object Notices {
    val now = mutableStateOf(PageNotices())
}

/**
 * Both notices, the server's over the update offer, as the page's (style.css: .status-banner, .update-toast), at the UI
 * Settings' menu size (their zoom); each button is the page's own, tapped ([onPage]: "notice-button" by its place, "update").
 * A button that asks first (Forget a folder) asks here, as the page's yes-or-no sheet, and the page is told it was answered
 * Yes ("<place>:yes"): asked by the page behind the native Home, it was asked unseen and nothing happened (bug list item 96).
 */
@Composable
internal fun NoticeBanners(zoom: Double, onPage: (String, String?) -> Unit) {
    val now by Notices.now
    var asking by remember { mutableStateOf<Pair<Int, String>?>(null) }
    asking?.let { (i, q) -> ConfirmDialog(q) { yes -> asking = null; if (yes) onPage("notice-button", "$i:yes") } }
    if (now.notice == null && now.update == null) return
    val density = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(density.density * zoom.toFloat(), density.fontScale)) {
        Column {
            now.notice?.let { n ->
                val ink = if (n.error) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
                val box = RoundedCornerShape(10.dp)
                Column(Modifier.parity("home.notice").padding(start = 28.dp, top = 14.dp, end = 28.dp).fillMaxWidth().clip(box).background(MaterialTheme.colorScheme.surfaceVariant)
                    .border(1.dp, if (n.error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline, box).padding(horizontal = 16.dp, vertical = 14.dp)) {
                    for (line in n.lines) Text(line, color = ink, fontSize = 14.sp, lineHeight = 20.3.sp)
                    Row {
                        n.buttons.forEachIndexed { i, word ->
                            val pill = RoundedCornerShape(8.dp)
                            Box(Modifier.parity("home.notice-button", Contract.label("home.notice-button", if (word.startsWith("Forget")) 0 else 1, word.removePrefix("Forget ")))
                                .padding(top = 10.dp, end = 8.dp).height(36.dp).clip(pill).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, MaterialTheme.colorScheme.outline, pill)
                                .clickable { n.ask(i)?.let { q -> asking = i to q } ?: onPage("notice-button", i.toString()) }.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                                Text(word, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
                            }
                        }
                    }
                }
            }
            now.update?.let { u ->
                val red = Color(0xFFE5484D)
                val border = MaterialTheme.colorScheme.outline
                Column(Modifier.parity("home.update").padding(start = 14.dp, end = 14.dp, bottom = 14.dp).fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp)).background(if (u.error) red.copy(alpha = 0.16f) else paletteColor(Palette.ACCENT_SOFT))
                    .drawBehind { drawLine(border, Offset(0f, size.height - 0.5.dp.toPx()), Offset(size.width, size.height - 0.5.dp.toPx()), 1.dp.toPx()) }
                    .padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(painterResource(R.drawable.up_icon), contentDescription = null, tint = if (u.error) red else MaterialTheme.colorScheme.secondary, modifier = Modifier.size(18.dp))
                        Text(u.text, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface, fontSize = 14.sp, lineHeight = 18.9.sp)
                        // Busy (downloading, restarting): no Update or Later to tap, as the page's are let alone then.
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            u.now?.let { word ->
                                Box(Modifier.parity("home.update-now", Contract.label("home.update-now", if (word == "Roll back") 1 else 0)).height(36.dp).clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary).clickable { onPage("update", "now") }.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                                    Text(word, color = MaterialTheme.colorScheme.onPrimary, fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600, maxLines = 1)
                                }
                            }
                            if (u.later) {
                                val later = RoundedCornerShape(10.dp)
                                Box(Modifier.parity("home.update-later", Contract.label("home.update-later")).height(36.dp).clip(later).background(MaterialTheme.colorScheme.surfaceVariant)
                                    .border(1.dp, border, later).clickable { onPage("update", "later") }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                                    Text("Later", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
                                }
                            }
                        }
                    }
                    if (u.notes.isNotEmpty()) Text(u.notes, Modifier.parity("home.update-notes").fillMaxWidth().heightIn(max = 120.dp)
                        .drawBehind { drawLine(border, Offset(0f, 0.5.dp.toPx()), Offset(size.width, 0.5.dp.toPx()), 1.dp.toPx()) }.verticalScroll(rememberScrollState()).padding(top = 8.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp, lineHeight = 18.sp)
                }
            }
        }
    }
}
