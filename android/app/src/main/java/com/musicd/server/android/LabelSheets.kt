package com.musicd.server.android

import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.LabelTile
import com.musicd.server.client.Labels
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.LogoCandidate
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * The labels' two smaller pieces natively (bug list item 71), as the page's (docs/specs/screens.json, label-unmerge and
 * label-logo; labels.js showUnmergeSheet, labels-list.js's logo picker; style.css .label-unmerge-*, .logo-*).
 */

/**
 * The labels merged into [label] (its "N merged" tapped): the sheet along the foot, Merged into the label and ✕, each one
 * with its red ✕ to take it out again (the list read again, [onChanged]); the sheet goes with the last of them.
 */
@Composable
internal fun BoxScope.LabelUnmergeSheet(label: LabelTile, client: () -> ServerClient?, onClose: () -> Unit, onChanged: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var left by remember(label.key) { mutableStateOf(label.mergedFrom) }
    var busy by remember { mutableStateOf<String?>(null) }
    val corners = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)
    Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.55f).dp).clip(corners)
        .background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outline, corners).padding(bottom = 8.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(buildAnnotatedString {
                append("Merged into ")
                withStyle(SpanStyle(color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.W700)) { append(label.title) }
            }, Modifier.parity("label-unmerge.title").weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Box(Modifier.parity("label-unmerge.close", Contract.label("label-unmerge.close")).size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
                .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.np_close), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 6.dp)) {
            left.forEachIndexed { i, m ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(m.display, Modifier.parity("label-unmerge.source").weight(1f), color = MaterialTheme.colorScheme.onSurface, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Box(Modifier.parity("label-unmerge.remove", Contract.label("label-unmerge.remove", 0, m.display)).size(32.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
                        .border(1.dp, MaterialTheme.colorScheme.error, CircleShape).alpha(if (busy == m.key) 0.5f else 1f).clickable(enabled = busy == null) {
                            val c = client() ?: return@clickable
                            busy = m.key
                            scope.launch {
                                val err = withContext(Dispatchers.IO) { runCatching { c.unmergeLabel(m.key) }.exceptionOrNull() }
                                busy = null
                                if (err != null) { Toast.makeText(context, "Unmerge failed: " + (err.message ?: "no answer"), Toast.LENGTH_SHORT).show(); return@launch }
                                left = left.filter { it.key != m.key }
                                onChanged()
                                if (left.isEmpty()) onClose()
                            }
                        }, contentAlignment = Alignment.Center) {
                        Icon(painterResource(R.drawable.np_close), contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}

/**
 * A label's logo (its albums' logo button): Discogs's logos for [label] in a row to choose from, or an image's address
 * pasted (the logo it has now filled in), Save, and ✕; under the label's heading, as the page's. [onSaved] with the address
 * the server kept.
 */
@Composable
internal fun LabelLogoPanel(label: String, current: String?, client: () -> ServerClient?, onClose: () -> Unit, onSaved: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var hint by remember(label) { mutableStateOf<String?>(Labels.SEARCHING) }
    var candidates by remember(label) { mutableStateOf<List<LogoCandidate>>(emptyList()) }
    var url by remember(label) { mutableStateOf(current.orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    LaunchedEffect(label) {
        val c = client() ?: return@LaunchedEffect
        withContext(Dispatchers.IO) { runCatching { LibraryClient { c.getJson(it) }.labelLogoCandidates(label) } }
            .onSuccess { candidates = it; hint = if (it.isEmpty()) Labels.NO_LOGOS else null }
            .onFailure { hint = com.musicd.server.client.Failure.said(it, "Discogs search failed") }
    }
    fun save(address: String) {
        val c = client() ?: return
        if (address.isBlank() || saving) return
        saving = true
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { c.saveLabelLogo(label, address) } }
            saving = false
            r.onSuccess { Toast.makeText(context, "Logo saved", Toast.LENGTH_SHORT).show(); onSaved(it) }
                .onFailure { Toast.makeText(context, com.musicd.server.client.Failure.said(it, "Failed to save logo"), Toast.LENGTH_SHORT).show() }
        }
    }
    Column(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 2.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 104.dp).horizontalScroll(rememberScrollState()).padding(vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            hint?.let { Text(it, Modifier.parity("label-logo.hint").alpha(0.5f), color = MaterialTheme.colorScheme.onSurface, fontSize = 12.sp, lineHeight = 17.sp) }
            for (cand in candidates) {
                val image = rememberWebImage(cand.img)
                Box(Modifier.parity("label-logo.candidate", Contract.label("label-logo.candidate", 0, cand.title.ifEmpty { "Logo" })).size(104.dp).clip(RoundedCornerShape(8.dp))
                    .background(paletteColor(Palette.BG_ELEV_2)).border(2.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)).clickable { save(cand.img) }.padding(2.dp)) {
                    image?.let { Image(it, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(4.dp))) }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val box = RoundedCornerShape(8.dp)
            BasicTextField(url, { url = it }, Modifier.parity("label-logo.url", Contract.label("label-logo.url")).weight(168f), singleLine = true,
                textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 14.sp, lineHeight = 19.sp), cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done), decorationBox = { field ->
                    Box(Modifier.fillMaxWidth().clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, MaterialTheme.colorScheme.outline, box).padding(horizontal = 12.dp, vertical = 8.dp)) {
                        if (url.isEmpty()) Text("Or paste any image URL…", color = paletteColor(Palette.TEXT_FAINT), fontSize = 14.sp, lineHeight = 19.sp, maxLines = 1)
                        field()
                    }
                })
            Box(Modifier.parity("label-logo.save", Contract.label("label-logo.save")).weight(160f).height(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = if (saving) 0.6f else 1f))
                .clickable { save(url.trim()) }, contentAlignment = Alignment.Center) {
                Text("Save", color = MaterialTheme.colorScheme.onPrimary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
            }
            Box(Modifier.parity("label-logo.cancel", Contract.label("label-logo.cancel")).size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
                .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.np_close), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
            }
        }
    }
}
