package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.IBroadcastBandwidth
import com.musicd.server.client.IBroadcastBandwidthWords
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/*
 * Settings → Services → iBroadcast → Upload bandwidth natively (item 479), as the page's (docs/specs/screens.json,
 * settings-ibroadcast-bandwidth; settings-ibroadcast-bandwidth.js): Back to iBroadcast, its title; under its title and ⓘ,
 * the home's upload speed as its internet provider gives it (Mbps, typed: kept as the box is left or Done tapped), what
 * is said under it with the fastest an upload has sent from here, the share of it the upload may use (25, 50, 75 or
 * 100 %), what that lets it use and leaves, and No limit where a speed is given. Worded as core's IBroadcastBandwidth.
 */

/** Settings' Upload bandwidth page ([client]: the server's, [onBack]: back to iBroadcast). */
@Composable
internal fun SettingsIBroadcastBandwidth(client: () -> ServerClient?, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    var b by remember { mutableStateOf(keptSetting("ibroadcast")?.let { IBroadcastBandwidthWords.parse(it) } ?: IBroadcastBandwidth(null, 100, null, null)) }
    var typed by remember { mutableStateOf(b.speedText) }
    var editing by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    fun show(j: JSONObject) { b = IBroadcastBandwidthWords.parse(j); if (!editing) typed = b.speedText }
    LaunchedEffect(Unit) { untilOnScreen(); readSetting(client, "ibroadcast")?.let(::show) }
    fun save(patch: JSONObject) {
        val c = client() ?: return
        asking = true
        val made = ServerWrites.write { c.post("/api/settings/ibroadcast/upload/speed", patch, 20_000).also { j -> j.optString("error").takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) } } }
        scope.launch {
            ServerWrites.await(made).onSuccess { asking = false; show(it) }
                .onFailure { asking = false; typed = b.speedText; setupToast(context, com.musicd.server.client.Failure.said(it, "Couldn't reach the server")) }
        }
    }
    /* The speed as typed, kept where it changed: a number, or none (blank); anything else said and put back. */
    fun keepTyped() {
        if (typed.trim() == b.speedText) return
        when (val n = IBroadcastBandwidthWords.typed(typed)) {
            null -> { setupToast(context, "Enter your upload speed in Mbps, such as 100"); typed = b.speedText }
            else -> save(JSONObject().put("speed_mbps", n))
        }
    }
    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-ibroadcast-bandwidth.back", Contract.label("settings-ibroadcast-bandwidth.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "Upload bandwidth", Modifier.parity("settings-ibroadcast-bandwidth.heading"))
            Block {
                ServiceTitle("Upload to iBroadcast", Modifier.parity("settings-ibroadcast-bandwidth.title"),
                    Modifier.parity("settings-ibroadcast-bandwidth.info", Contract.label("settings-ibroadcast-bandwidth.info", 0, "Upload to iBroadcast")).clickable { info = IBroadcastBandwidthWords.INFO })
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Your upload speed", Modifier.parity("settings-ibroadcast-bandwidth.name").weight(1f), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
                        val shape = RoundedCornerShape(8.dp)
                        BasicTextField(typed, { typed = it.filter { ch -> ch.isDigit() || ch == '.' || ch == ',' }.take(8) },
                            Modifier.parity("settings-ibroadcast-bandwidth.speed", Contract.label("settings-ibroadcast-bandwidth.speed")).width(90.dp)
                                .onFocusChanged { f -> if (editing && !f.isFocused) keepTyped(); editing = f.isFocused },
                            enabled = !asking, singleLine = true,
                            textStyle = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 15.sp, textAlign = TextAlign.End),
                            cursorBrush = SolidColor(paletteColor(Palette.ACCENT)),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
                            decorationBox = { inner ->
                                Box(Modifier.fillMaxWidth().height(34.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 10.dp),
                                    contentAlignment = Alignment.CenterEnd) {
                                    if (typed.isEmpty()) Text("e.g. 100", color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
                                    inner()
                                }
                            })
                        Text("Mbps", Modifier.parity("settings-ibroadcast-bandwidth.name"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
                    }
                    StatusLine(b.speedNote, Modifier.parity("settings-ibroadcast-bandwidth.speed-note"))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Use at most", Modifier.parity("settings-ibroadcast-bandwidth.name").weight(1f), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
                        Box(Modifier.widthIn(max = 230.dp)) {
                            Seg(IBroadcastBandwidthWords.SHARES, "${b.percent}", key = { i, ch ->
                                Modifier.parity("settings-ibroadcast-bandwidth.share", Contract.label("settings-ibroadcast-bandwidth.share", i)).clickable(enabled = !asking) { save(JSONObject().put("percent", ch.value.toInt())) }
                            })
                        }
                    }
                    StatusLine(b.limitWords, Modifier.parity("settings-ibroadcast-bandwidth.limit"))
                    if (b.speed != null) Row(Modifier.padding(top = 6.dp)) {
                        SetupButton("No limit", asking, Modifier.parity("settings-ibroadcast-bandwidth.clear", Contract.label("settings-ibroadcast-bandwidth.clear")).clickable(enabled = !asking) {
                            typed = ""
                            save(JSONObject().put("speed_mbps", JSONObject.NULL))
                        })
                    }
                }
            }
        }
        info?.let { InfoTip(it, Modifier.parity("settings-ibroadcast-bandwidth.info")) }
    }
}
