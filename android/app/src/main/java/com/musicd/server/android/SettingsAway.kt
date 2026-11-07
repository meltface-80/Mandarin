package com.musicd.server.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AwayState
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SettingsKept
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * The last of Setup's pages natively (the group T of old/plan-android-native.md, T2; bug list item 80), as the page's
 * (docs/specs/screens.json, settings-away; settings-away.js, android-app-update.js's This phone): the server's built-in
 * Tailscale, with the app's own under it. Drawn with Setup's rows, switches and lists (SettingsSetup.kt). Share Card's
 * page, beside it here, went with item 336: the card always carries its review, and nothing is linked under it.
 */

/**
 * Away from home: the server's built-in Tailscale on or off, its status (and Tailscale's warning), its name and
 * address, Sign in (Tailscale's page in the browser) or Sign out, and what went wrong; read again every three seconds,
 * as signing in happens elsewhere. Under it, This phone: the app's own Tailscale.
 */
@Composable
internal fun AwayPane(client: () -> ServerClient?, onBack: () -> Unit, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // As last seen, then the server's (item 198): before, nothing of the server's until it answered.
    var st by remember { mutableStateOf(SettingsKept.last(AwayState.PATH) { AwayState.parse(it) }) }
    var read by remember { mutableStateOf(st != null) }
    var missed by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    // While the app is on screen (item 120: every three seconds behind the Tailscale app too, while signing in there).
    val onScreen by NativeShell.onScreen
    LaunchedEffect(onScreen) {
        if (!onScreen) return@LaunchedEffect
        while (true) {
            // One read not answered keeps the page as it was; two in a row say the server can't be reached.
            if (!busy) client()?.let { c -> val got = withContext(Dispatchers.IO) { runCatching { c.tailscale() }.getOrNull() }
                missed = if (got == null) missed + 1 else 0; if (got != null || missed > 1) st = got; read = true }
            delay(3000)
        }
    }
    fun act(what: String, body: JSONObject = JSONObject()) {
        val c = client() ?: return
        if (busy) return
        busy = true; err = ""
        // The switch moved as it is tapped (item 200), the server's answer taking its place; back where it was if refused.
        val before = st
        if (what == "enable") st = before?.copy(enabled = body.optBoolean("on"))
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { c.tailscaleDo(what, body) } }
                .onSuccess { st = it; if (what == "login" && it.authUrl.isNotEmpty()) open(context, it.authUrl) }.onFailure { st = before; err = com.musicd.server.client.Failure.said(it, "no answer") }
            busy = false
        }
    }
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-away.back", Contract.label("settings-away.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Away from home", Modifier.parity("settings-away.heading"))
        Block {
            val s = st
            when {
                !read -> {}
                s == null -> AwayNote(AwayState.UNREACHABLE, Modifier.parity("settings-away.note"))
                !s.available -> AwayNote(AwayState.UNAVAILABLE, Modifier.parity("settings-away.note"))
                else -> Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    AwayRow("Built-in Tailscale") { Toggle(s.enabled, Modifier.parity("settings-away.enabled", Contract.label("settings-away.enabled")).clickable(enabled = !busy) { act("enable", JSONObject().put("on", !s.enabled)) }) }
                    AwayRow("Status") { AwayValue(s.status, Modifier.parity("settings-away.value")) }
                    s.warning?.let { AwayNote(it, Modifier.parity("settings-away.error"), error = true) }
                    if (s.running) {
                        if (s.dnsName.isNotEmpty()) AwayRow("Name") { AwayValue(s.dnsName, Modifier.parity("settings-away.value")) }
                        if (s.address.isNotEmpty()) AwayRow("Address") { AwayValue(s.shownAddress, Modifier.parity("settings-away.value")) }
                        AwayRow("") { SetupButton("Sign out of Tailscale", busy, Modifier.parity("settings-away.signout", Contract.label("settings-away.signout")).clickable(enabled = !busy) { act("logout") }) }
                        AwayInfoNote("On your tailnet as “${s.hostname}”", Modifier.parity("settings-away.note"),
                            Modifier.parity("settings-away.info", Contract.label("settings-away.info")).clickable { info(s.connectedInfo(true)) })
                    } else if (s.enabled) {
                        AwayRow("") {
                            SetupButton("Sign in to Tailscale", busy, Modifier.parity("settings-away.signin", Contract.label("settings-away.signin")).clickable(enabled = !busy) {
                                if (s.authUrl.isNotEmpty()) open(context, s.authUrl) else act("login")
                            })
                        }
                        AwayInfoNote("Sign in with the same account as your phone.", Modifier.parity("settings-away.note"),
                            Modifier.parity("settings-away.info", Contract.label("settings-away.info")).clickable { info(s.signInInfo) })
                    }
                    (err.ifEmpty { s.error }).takeIf { it.isNotEmpty() }?.let { AwayNote(it, Modifier.parity("settings-away.error"), error = true) }
                }
            }
        }
        // This phone (android-app-update.js): the app's own Tailscale, its screen a tap away.
        SettingsDivider(above = 18, below = 18)
        Block {
            Text("This phone", Modifier.parity("settings-away.phone-title").padding(bottom = 10.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp,
                fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
            SetupRow("Tailscale on this phone", Modifier.parity("settings-away.name"), Modifier.parity("settings-away.info", Contract.label("settings-away.info")).clickable { info(AwayState.PHONE_INFO) }) {
                SetupButton("Tailscale", false, Modifier.parity("settings-away.phone-open", Contract.label("settings-away.phone-open")).clickable {
                    (context as? Activity)?.let { it.startActivity(Intent(it, TailscaleTestActivity::class.java)) }
                })
            }
            SetupNote("Built into the app; sign in with the server’s account.", Modifier.parity("settings-away.note"))
        }
    }
}

/** One of Away's rows (#away-pane-body .settings-row): 40 tall at least, its name on the left (none for a button's row), [value] on the right. */
@Composable
private fun AwayRow(name: String, value: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(name, Modifier.parity("settings-away.name").weight(1f), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
        value()
    }
}

/** A value on Away's row (.away-value): 14 dim, to the right. */
@Composable
private fun AwayValue(text: String, modifier: Modifier) {
    Text(text, modifier, color = paletteColor(Palette.TEXT_DIM), fontSize = 14.sp, lineHeight = 19.sp, textAlign = TextAlign.End)
}

/** A note of Away's (#away-pane-body .settings-note): 12 faint, or red for what went wrong ([error]). */
@Composable
private fun AwayNote(text: String, modifier: Modifier, error: Boolean = false) {
    Text(text, modifier, color = paletteColor(if (error) Palette.DANGER else Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
}

/** A note with its ⓘ after it ([info]: its key and tap). */
@Composable
private fun AwayInfoNote(text: String, modifier: Modifier, info: Modifier) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(text, modifier.weight(1f, fill = false), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
        Box(info.size(32.dp).padding(start = 4.dp), contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 12.sp) }
    }
}

private fun open(context: android.content.Context, url: String) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
