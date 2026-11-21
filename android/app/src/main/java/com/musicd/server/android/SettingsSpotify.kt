package com.musicd.server.android

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.musicd.server.client.Contract
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SpotifyAccount
import com.musicd.server.client.SpotifySettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/*
 * Settings → Services → Spotify natively (bug list item 497), as the page's (settings-spotify.js; docs/specs/screens.json,
 * settings-service). Signed out, Sign in on Spotify: the server gives Spotify's page to approve Mandarin on, opened in
 * the browser, while the app listens on this phone's 127.0.0.1:43143 for the address Spotify sends the browser back to
 * (SpotifySettings.catchAnswer), which it hands to the server to finish: nothing to paste here. Signed in, who, the saved
 * albums in the library on or off, Update library now and Sign out, and what the library holds of Spotify.
 */

/** Spotify's own page ([onBack]: back to Services). */
@Composable
internal fun SettingsSpotify(client: () -> ServerClient?, onBack: () -> Unit) {
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-service.back", Contract.label("settings-service.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "Spotify", Modifier.parity("settings-service.heading"))
            Block { SpotifyBlock(client) { info = it } }
        }
        info?.let { InfoTip(it, Modifier.parity("settings-service.info")) }
    }
}

@Composable
private fun SpotifyBlock(client: () -> ServerClient?, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val dates = remember { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT) }
    fun parse(j: JSONObject) = SpotifySettings.parse(j) { dates.format(Date(it)) }
    var account by remember { mutableStateOf(keptSetting("spotify")?.let { j -> runCatching { parse(j) }.getOrNull() }) }
    var busy by remember { mutableStateOf(false) }
    var updating by remember { mutableStateOf(false) }
    // A sign-in waited for: the catch on this phone let go when the page closes or the sign-in is begun again.
    var catching by remember { mutableStateOf(0) }
    var said by remember { mutableStateOf<String?>(null) }
    DisposableEffect(Unit) { onDispose { catching = -1 } }
    fun show(j: JSONObject) { account = parse(j); said = null }
    suspend fun load() { readSetting(client, "spotify")?.let(::show) }
    LaunchedEffect(Unit) { while (true) { untilOnScreen(); load(); delay(if (account?.again == true) 2_000L else 30_000L) } }
    fun change(path: String, body: JSONObject = JSONObject(), timeout: Int = 20_000, done: (JSONObject) -> Unit = ::show) {
        val c = client() ?: return
        val call = { c.post("/api/settings/spotify$path", body, timeout).also { j -> j.optString("error").takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) } } }
        val made = if (timeout > ServerWrites.LANE_MOST) ServerWrites.aside(call) else ServerWrites.write(call)
        scope.launch {
            ServerWrites.await(made).onSuccess(done).onFailure { busy = false; updating = false; said = null; setupToast(context, com.musicd.server.client.Failure.said(it, "Couldn't reach the server")); load() }
        }
    }
    // Spotify's page opened, and its answer caught here and handed on; a later sign-in lets this one go.
    fun signIn() {
        if (busy) return
        busy = true
        change("/signin") { j ->
            val url = j.optString("url")
            val mine = ++catching
            said = "Approve Mandarin on Spotify's page, then come back."
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            scope.launch {
                val address = withContext(Dispatchers.IO) { runCatching { SpotifySettings.catchAnswer(10 * 60_000) { catching != mine } }.getOrNull() }
                busy = false
                if (address == null) { if (catching == mine) said = null; return@launch }
                change("/signin/finish", JSONObject().put("address", address)) { done -> setupToast(context, "Signed in to Spotify"); show(done) }
            }
        }
    }
    val a: SpotifyAccount? = account
    ServiceTitle("Account", Modifier.parity("settings-service.title"),
        Modifier.parity("settings-service.info", Contract.label("settings-service.info", 0, "Account")).clickable { info(SpotifySettings.INFO) })
    if (a == null) return
    if (!a.connected) {
        SetupButton("Sign in on Spotify", busy, Modifier.parity("settings-service.signin", Contract.label("settings-service.signin", 2)).clickable(enabled = !busy) { signIn() })
        said?.let { StatusLine(it, Modifier.parity("settings-service.status").padding(top = 4.dp)) }
        return
    }
    StatusLine(a.status, Modifier.parity("settings-service.status"))
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val importName = "Saved albums in the library"
        ServiceRow(importName, Modifier.parity("settings-service.info", Contract.label("settings-service.info", 0, importName)).clickable { info(SpotifySettings.IMPORT_INFO) }) {
            Toggle(a.import, Modifier.parity("settings-service.import", Contract.label("settings-service.import", 2)).clickable {
                val on = !a.import
                account = a.copy(import = on)
                change("", JSONObject().put("import", on)) { j -> show(j); HomeKept.reset() }
            })
        }
    }
    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (a.import) SetupButton("Update library now", updating, Modifier.parity("settings-service.update", Contract.label("settings-service.update")).clickable(enabled = !updating) {
            updating = true
            account = a.copy(importStatus = "Bringing your Spotify albums into the library…")
            change("/import", timeout = 600_000) { j -> updating = false; setupToast(context, SpotifySettings.updated(j)); scope.launch { load() } }
        })
        SetupButton("Sign out", busy, Modifier.parity("settings-service.signout", Contract.label("settings-service.signout")).clickable(enabled = !busy) {
            busy = true
            change("/signout") { busy = false; setupToast(context, "Signed out of Spotify"); scope.launch { load() } }
        })
    }
    StatusLine(a.importStatus, Modifier.parity("settings-service.import-status").padding(top = 4.dp))
}
