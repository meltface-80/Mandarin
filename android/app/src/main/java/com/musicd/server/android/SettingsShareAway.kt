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
import com.musicd.server.client.Choice
import com.musicd.server.client.Contract
import com.musicd.server.client.LinkToggle
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SettingsKept
import com.musicd.server.client.ShareCard
import com.musicd.server.client.ShareLinkSettings
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/*
 * The last two of Setup's pages natively (the group T of old/plan-android-native.md, T2; bug list item 80), as
 * the page's (docs/specs/screens.json, settings-sharecard and settings-away; settings-views.js, settings-away.js,
 * android-app-update.js's This phone): what the share card shows and links to, and the server's built-in Tailscale,
 * with the app's own under it. Drawn with Setup's rows, switches and lists (SettingsSetup.kt).
 */

/**
 * Share Card: the review on the card on or off, and what that means; the services to link to, each on or off, the
 * default one chosen from those on (this phone's, as the card's held chip sets it, item 75); the review sites.
 */
@Composable
internal fun ShareCardPane(client: () -> ServerClient?, onBack: () -> Unit, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // As last seen, then the server's (item 198): before, no services and Review on until the server answered.
    var links by remember { mutableStateOf(keptSetting("share-links")?.let { runCatching { ShareLinkSettings.parse(it) }.getOrNull() }) }
    var service by remember { mutableStateOf(ShareKept.service ?: WallPrefs.parse(NativeShell.prefs).shareService) }
    LaunchedEffect(Unit) { readSetting(client, "share-links")?.let { links = ShareLinkSettings.parse(it) } }
    fun save(patch: JSONObject) = saveSetting(scope, context, client, "share-links", patch, null, undo = {}, failed = "Couldn't save that: ")
    fun ids(list: List<LinkToggle>) = JSONArray(list.filter { it.on }.map { it.id })
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-sharecard.back", Contract.label("settings-sharecard.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Share Card", Modifier.parity("settings-sharecard.heading"))
        val l = links
        Block {
            Title("On the card", Modifier.parity("settings-sharecard.title"))
            SetupRow("Review", Modifier.parity("settings-sharecard.name"), null) {
                val on = l?.cardReview ?: true
                Toggle(on, Modifier.parity("settings-sharecard.review", Contract.label("settings-sharecard.review")).clickable(enabled = l != null) {
                    links = l?.copy(cardReview = !on); save(JSONObject().put("card_review", !on))
                })
            }
            SetupNote(ShareLinkSettings.reviewNote(l?.cardReview ?: true), Modifier.parity("settings-sharecard.note"))
        }
        Block {
            Title("Services", Modifier.parity("settings-sharecard.title"))
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (l != null) for (t in l.services) {
                    SetupRow(t.name, Modifier.parity("settings-sharecard.name"), null) {
                        Toggle(t.on, Modifier.parity("settings-sharecard.service", Contract.label("settings-sharecard.service", 0, t.name)).clickable {
                            val next = l.copy(services = l.services.map { if (it.id == t.id) it.copy(on = !t.on) else it })
                            links = next; save(JSONObject().put("services", ids(next.services)))
                        })
                    }
                }
            }
            Box(Modifier.padding(top = 14.dp)) {
                val on = l?.onServices.orEmpty()
                val choices = on.map { Choice(it.id, it.name) }
                val chosen = ShareCard.preferred(service, on.map { it.id })
                SetupRow("Default", Modifier.parity("settings-sharecard.name"), Modifier.parity("settings-sharecard.info", Contract.label("settings-sharecard.info", 0, "Default")).clickable { info(DEFAULT_INFO) }) {
                    SelectBox(choices.firstOrNull { it.value == chosen }?.words ?: "No services switched on", choices.ifEmpty { listOf(Choice("", "No services switched on")) },
                        Modifier.parity("settings-sharecard.caret"), Modifier.parity("settings-sharecard.default", Contract.label("settings-sharecard.default")).clickable(enabled = choices.isNotEmpty()) {
                            pickChoice(context, choices, chosen) { v -> service = v; ShareKept.service = v; NativeShell.keep("shareService", v) }
                        })
                }
            }
            SetupNote("Each one opens a search for the album on that service. Nothing is looked up until you tap a link. A suggestion that IS in your library queues it instead.",
                Modifier.parity("settings-sharecard.note").padding(bottom = 12.dp))
        }
        Block {
            Title("Reviews", Modifier.parity("settings-sharecard.title"))
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (l != null) for (t in l.reviews) {
                    SetupRow(t.name, Modifier.parity("settings-sharecard.name"), null) {
                        Toggle(t.on, Modifier.parity("settings-sharecard.site", Contract.label("settings-sharecard.site", 0, t.name)).clickable {
                            val next = l.copy(reviews = l.reviews.map { if (it.id == t.id) it.copy(on = !t.on) else it })
                            links = next; save(JSONObject().put("reviews", ids(next.reviews)))
                        })
                    }
                }
            }
            SetupNote("Pitchfork and Wikipedia link to the actual page when it has already been found for the card, and to a search when it has not.",
                Modifier.parity("settings-sharecard.note").padding(bottom = 12.dp))
        }
    }
}

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
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { c.tailscaleDo(what, body) } }
                .onSuccess { st = it; if (what == "login" && it.authUrl.isNotEmpty()) open(context, it.authUrl) }.onFailure { err = com.musicd.server.client.Failure.said(it, "no answer") }
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

/** A block's title (.settings-block-title): 13 in 700, spaced, in capitals, faint; 10 under it. */
@Composable
private fun Title(text: String, modifier: Modifier) {
    Text(text.uppercase(), modifier.padding(bottom = 10.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
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

private const val DEFAULT_INFO = "Where a suggestion goes when the record is not in your library. You can also set it by holding a service button under the share card. This is per device, so a phone and a tablet can differ."
