package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.UpdateCheck
import com.musicd.server.client.UpdateOutcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume

/*
 * Settings → Updates natively (the group T of docs/specs/plan-android-native.md, T9; bug list item 92), as the page's
 * (docs/specs/screens.json, settings-system; check-update.js, android-app-update.js; style.css .settings-update-btn,
 * .is-update-ready, .settings-release-notes): Check for updates looks for the server's update and this app's at once
 * (AppUpdate, as the page's __musicdAppUpd does), then offers to install what it found, in brass, with the server's
 * release notes under it; or says how things stand for a few seconds. Installing is the page's update banner's, which
 * owns the download, the unpacking and the restart: it is handed to the page and Settings closes onto Home, where the
 * banner is drawn (item 69). Under it, this app's version, updated with the server.
 */

/** Settings' Updates ([client]: the server's, [onBack]: one step back). */
@Composable
internal fun SettingsUpdates(client: () -> ServerClient?, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var words by remember { mutableStateOf(UpdateCheck.CHECK) }
    var busy by remember { mutableStateOf(false) }
    var found by remember { mutableStateOf<UpdateOutcome?>(null) }
    fun check() {
        val c = client() ?: return
        busy = true; words = UpdateCheck.CHECKING; found = null
        scope.launch {
            // The server's update and this app's looked for at once (the app's waited for 12 seconds at most, as the page waits).
            val server = async(Dispatchers.IO) { runCatching { c.post("/api/update/check", JSONObject()); c.getJson("/api/update/status") } }
            withTimeoutOrNull(12_000) { suspendCancellableCoroutine<Unit> { k -> AppUpdate.lookup(true) { if (k.isActive) k.resume(Unit) } } }
            val a = runCatching { JSONObject(AppUpdate.statusJson()) }.getOrNull()
            server.await().onSuccess { j ->
                val o = UpdateCheck.outcome(j, a)
                if (o.offer) { found = o; words = o.words; busy = false }
                else { words = o.words; delay(o.holdMs); words = UpdateCheck.CHECK; busy = false }
            }.onFailure { words = UpdateCheck.FAILED; delay(3_000); words = UpdateCheck.CHECK; busy = false }
        }
    }
    // The second tap installs: the page's banner does it, over Home; Settings (its list under this page) closes onto it.
    fun install(o: UpdateOutcome) {
        found = null; words = UpdateCheck.CHECK
        NativeShell.toPage("apply-update", JSONObject().put("server", o.server).put("app", o.app).toString())
        onBack(); onBack()
    }
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-system.back", Contract.label("settings-system.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Updates", Modifier.parity("settings-system.heading"))
        Block {
            SetupRow("Updates", Modifier.parity("settings-system.name"), null) {
                val o = found
                UpdateButton(words, ready = o != null, busy = busy, Modifier.parity("settings-system.check", Contract.label("settings-system.check", 1, words))
                    .clickable(enabled = !busy) { if (o != null) install(o) else check() })
            }
            found?.notes?.let { notes ->
                Text(notes, Modifier.parity("settings-system.notes").heightIn(max = 200.dp).verticalScroll(rememberScrollState()).padding(top = 10.dp, bottom = 4.dp),
                    color = paletteColor(Palette.TEXT_DIM), fontSize = 12.sp, lineHeight = 18.sp)
            }
            SetupRow(UpdateCheck.appName(BuildConfig.VERSION_NAME), Modifier.parity("settings-system.name"), null) {
                Text(UpdateCheck.APP_NOTE, Modifier.parity("settings-system.app-note").padding(top = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
            }
        }
    }
}

/** Check for updates (.settings-update-btn): 36 tall, 14 in, 8 round, 13 dim; once an update is found (.is-update-ready) its words in brass, 600, in a brass edge. */
@Composable
private fun UpdateButton(words: String, ready: Boolean, busy: Boolean, modifier: Modifier) {
    val shape = RoundedCornerShape(8.dp)
    Box(modifier.heightIn(min = 36.dp).alpha(if (busy && !ready) 0.6f else 1f).clip(shape).background(paletteColor(Palette.BG_ELEV_2))
        .border(1.dp, paletteColor(if (ready) Palette.ACCENT else Palette.BORDER), shape).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
        Text(words, color = paletteColor(if (ready) Palette.ACCENT_TEXT else Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp,
            fontWeight = if (ready) FontWeight.W600 else FontWeight.W400, maxLines = 2)
    }
}
