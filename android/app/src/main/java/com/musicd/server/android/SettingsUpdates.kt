package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.UpdateCheck
import com.musicd.server.client.UpdateFound
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume

/*
 * Settings → Updates natively (the group T of old/plan-android-native.md, T9; bug list item 92), as the page's
 * (docs/specs/screens.json, settings-system; check-update.js, android-app-update.js; style.css .settings-update-btn,
 * .is-update-ready, .settings-release-notes): the server and this app a row each (item 223), its version and its own
 * Check for update, which looks for that one's update alone and becomes Update available once one is found, or says how
 * things stand for a few seconds. Opened, each says what was last found. Under both, what each update brings, its short
 * lines (core's UpdateCheck). The server's install is the update banner's (UpdateNow, item 111), which follows the
 * download, the unpacking and the restart: Settings closes onto Home, where the banner is drawn. This app's is handed to
 * Android's installer from here.
 */

/** Settings' Updates ([client]: the server's, [onBack]: one step back). */
@Composable
internal fun SettingsUpdates(client: () -> ServerClient?, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var serverVersion by remember { mutableStateOf<String?>(null) }
    var server by remember { mutableStateOf<UpdateFound?>(null) }
    var app by remember { mutableStateOf<UpdateFound?>(null) }
    var serverWords by remember { mutableStateOf(UpdateCheck.CHECK) }
    var appWords by remember { mutableStateOf(UpdateCheck.CHECK) }
    var serverBusy by remember { mutableStateOf(false) }
    var appBusy by remember { mutableStateOf(false) }
    // As last seen: the server's status as its last check left it, this app's as last looked for (within the hour).
    LaunchedEffect(Unit) {
        client()?.let { c ->
            val s = withContext(Dispatchers.IO) { runCatching { c.getJson("/api/update/status") }.getOrNull() }
            serverVersion = UpdateCheck.current(s)
            if (!serverBusy) UpdateCheck.found(s)?.let { server = it; serverWords = UpdateCheck.AVAILABLE }
        }
        val a = appStatus(false)
        if (!appBusy) UpdateCheck.found(a)?.let { app = it; appWords = UpdateCheck.AVAILABLE }
    }
    fun checkServer() {
        val c = client() ?: return
        serverBusy = true; serverWords = UpdateCheck.CHECKING; server = null
        scope.launch {
            val s = withContext(Dispatchers.IO) { runCatching { c.post("/api/update/check", JSONObject()); c.getJson("/api/update/status") }.getOrNull() }
            UpdateCheck.current(s)?.let { serverVersion = it }
            val f = UpdateCheck.found(s)
            if (f != null) { server = f; serverWords = UpdateCheck.AVAILABLE; serverBusy = false; return@launch }
            val words = UpdateCheck.serverNothing(s)
            serverWords = words; delay(UpdateCheck.holdMs(words)); serverWords = UpdateCheck.CHECK; serverBusy = false
        }
    }
    fun checkApp() {
        appBusy = true; appWords = UpdateCheck.CHECKING; app = null
        scope.launch {
            val f = UpdateCheck.found(appStatus(true))
            if (f != null) { app = f; appWords = UpdateCheck.AVAILABLE; appBusy = false; return@launch }
            val words = UpdateCheck.appNothing(serverVersion, BuildConfig.VERSION_NAME)
            appWords = words; delay(UpdateCheck.holdMs(words)); appWords = UpdateCheck.CHECK; appBusy = false
        }
    }
    // Update available, tapped: the server's installs on Home, under the banner (Settings, its list under this page, closes
    // onto it); this app's goes to Android's installer, this page staying under it.
    fun installServer() { UpdateNow.apply(server = true, app = false); onBack(); onBack() }
    fun installApp() { UpdateNow.apply(server = false, app = true) }
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-system.back", Contract.label("settings-system.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Updates", Modifier.parity("settings-system.heading"))
        Block {
            UpdateRow(UpdateCheck.serverName(serverVersion)) {
                UpdateButton(serverWords, serverBusy, Modifier.weight(1f, fill = false).padding(start = 16.dp)
                    .parity("settings-system.check", Contract.label("settings-system.check", 1, serverWords))
                    .clickable(enabled = !serverBusy) { if (serverWords == UpdateCheck.AVAILABLE && server != null) installServer() else checkServer() })
            }
            UpdateRow(UpdateCheck.appName(BuildConfig.VERSION_NAME), Modifier.padding(top = 12.dp)) {
                UpdateButton(appWords, appBusy, Modifier.weight(1f, fill = false).padding(start = 16.dp)
                    .parity("settings-system.app-check", Contract.label("settings-system.app-check", 1, appWords))
                    .clickable(enabled = !appBusy) { if (appWords == UpdateCheck.AVAILABLE && app != null) installApp() else checkApp() })
            }
            for (part in UpdateCheck.whatsNew(server, app)) {
                Text(part.head, Modifier.parity("settings-system.notes-head").padding(top = 16.dp), color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W600)
                Text(part.notes, Modifier.parity("settings-system.notes").padding(top = 6.dp, bottom = 4.dp),
                    color = paletteColor(Palette.TEXT_DIM), fontSize = 12.sp, lineHeight = 18.sp)
            }
        }
    }
}

/** This app's own update ({current, latest, available, installing, notes}), once AppUpdate has looked (12 seconds at most; [force]: afresh, not its hour's). */
private suspend fun appStatus(force: Boolean): JSONObject? {
    withTimeoutOrNull(12_000) { suspendCancellableCoroutine<Unit> { k -> AppUpdate.lookup(force) { if (k.isActive) k.resume(Unit) } } }
    return runCatching { JSONObject(AppUpdate.statusJson()) }.getOrNull()
}

/**
 * A row: its [name] (the server's or this app's, with its version) and its [button].
 * Not SetupRow: its control is measured first and takes what it wants, so a long answer left the name a letter wide, one
 * letter a line (item 178). As the page's flex row: the name its own width, the button the rest, its words wrapping inside it.
 */
@Composable
private fun UpdateRow(name: String, modifier: Modifier = Modifier, button: @Composable RowScope.() -> Unit) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text(name, Modifier.parity("settings-system.name").heightIn(min = 22.dp), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
        button()
    }
}

/** Check for update (.settings-update-btn): 36 tall, 14 in, 8 round, 13 dim; once an update is found (.is-update-ready) its words in brass, 600, in a brass edge. */
@Composable
private fun UpdateButton(words: String, busy: Boolean, modifier: Modifier) {
    val ready = words == UpdateCheck.AVAILABLE
    val shape = RoundedCornerShape(8.dp)
    Box(modifier.heightIn(min = 36.dp).alpha(if (busy && !ready) 0.6f else 1f).clip(shape).background(paletteColor(Palette.BG_ELEV_2))
        .border(1.dp, paletteColor(if (ready) Palette.ACCENT else Palette.BORDER), shape).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
        Text(words, color = paletteColor(if (ready) Palette.ACCENT_TEXT else Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp,
            fontWeight = if (ready) FontWeight.W600 else FontWeight.W400, textAlign = TextAlign.Center)
    }
}
