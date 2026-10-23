package com.musicd.server.android

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SpotifyCatch
import com.musicd.server.client.SpotifyLibraries
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/*
 * Settings → Services → Spotify, your library, natively (bug list item 143), as the page's (settings-spotify-account.js;
 * the contract's settings-services signin, spotify-client, spotify-note, spotify-paste, spotify-finish, spotify-cancel,
 * import, update, signout, import-status): your Spotify app's Client ID and Sign in to Spotify, which opens Spotify's page
 * in the browser and catches Spotify's answer on this phone itself (SpotifyCatch), so the sign-in finishes on its own;
 * the address can still be pasted, as on the page. Signed in: who, the favourites in the library on or off, Update
 * library now, Sign out, and what the library holds of Spotify.
 */

/** Your library's part of Spotify's block ([account]: the state's account, as the server said it; [reload]: the state read again). */
@Composable
internal fun SpotifyLibraryPart(client: () -> ServerClient?, account: JSONObject, info: (String) -> Unit, reload: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val dates = remember { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT) }
    val lib = SpotifyLibraries.parse(account) { dates.format(Date(it)) }
    var clientId by remember { mutableStateOf<String?>(null) }
    var paste by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    fun post(path: String, body: JSONObject = JSONObject(), timeout: Int = 20_000, done: (JSONObject) -> Unit = {}) {
        val c = client() ?: return
        busy = true
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { c.post("/api/settings/spotify$path", body, timeout).also { j -> j.optString("error").takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) } } } }
                .onSuccess { j -> busy = false; done(j); reload() }
                .onFailure { busy = false; setupToast(context, it.message ?: "Couldn't reach the server"); reload() }
        }
    }
    // Spotify's answer caught here (ten minutes at most), and handed to the server to finish the sign-in.
    fun catchAnswer() = scope.launch {
        val url = withContext(Dispatchers.IO) { runCatching { SpotifyCatch().await(10 * 60_000) }.getOrNull() } ?: return@launch
        post("/signin/code", JSONObject().put("url", url)) { setupToast(context, "Signed in to Spotify") }
    }
    val field = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 18.sp)
    val libName = "Your Spotify library"
    ServiceRow(libName, Modifier.parity("settings-services.info", Contract.label("settings-services.info", 0, libName)).clickable { info(SpotifyLibraries.INFO) }) {}
    if (!lib.connected) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            val id = clientId ?: lib.clientId
            BasicTextField(id, { clientId = it }, Modifier.parity("settings-services.spotify-client", Contract.label("settings-services.spotify-client")).weight(1f), singleLine = true,
                textStyle = field, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
                decorationBox = { inner -> FieldBox(id.isEmpty(), "Your Spotify app's Client ID", inner) })
            SetupButton("Sign in to Spotify", busy, Modifier.parity("settings-services.signin", Contract.label("settings-services.signin", 2)).clickable(enabled = !busy) {
                post("/signin", JSONObject().put("client_id", id.trim())) { j ->
                    j.optJSONObject("pending")?.optString("url")?.takeIf { it.isNotEmpty() }?.let { url ->
                        catchAnswer()
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                    }
                }
            })
        }
        if (lib.pendingUrl != null) {
            Text(SpotifyLibraries.NOTE, Modifier.parity("settings-services.spotify-note").padding(top = 8.dp).fillMaxWidth(), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
            Row(Modifier.padding(top = 6.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(paste, { paste = it }, Modifier.parity("settings-services.spotify-paste", Contract.label("settings-services.spotify-paste")).weight(1f), singleLine = true,
                    textStyle = field, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    decorationBox = { inner -> FieldBox(paste.isEmpty(), "http://127.0.0.1:43143/mandarin-spotify?code=…", inner) })
                SetupButton("Finish", busy, Modifier.parity("settings-services.spotify-finish", Contract.label("settings-services.spotify-finish")).clickable(enabled = !busy && paste.isNotBlank()) {
                    post("/signin/code", JSONObject().put("url", paste.trim())) { paste = ""; setupToast(context, "Signed in to Spotify") }
                })
                SetupButton("Cancel", false, Modifier.parity("settings-services.spotify-cancel", Contract.label("settings-services.spotify-cancel")).clickable { post("/signin/cancel") })
            }
        }
    }
    StatusLine(lib.status, Modifier.parity("settings-services.status").padding(top = 4.dp))
    if (!lib.connected) return
    val importName = "Favourites in the library"
    ServiceRow(importName, Modifier.parity("settings-services.info", Contract.label("settings-services.info", 0, importName)).clickable { info(SpotifyLibraries.IMPORT_INFO) }) {
        Toggle(lib.import, Modifier.parity("settings-services.import", Contract.label("settings-services.import", 1)).clickable(enabled = !busy) {
            // The walls, Home and Playlists read afresh as each opens: the albums are in or out.
            post("", JSONObject().put("import", !lib.import)) { HomeKept.reset() }
        })
    }
    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (lib.import) SetupButton("Update library now", busy || lib.importing, Modifier.parity("settings-services.update", Contract.label("settings-services.update")).clickable(enabled = !busy && !lib.importing) {
            post("/import", timeout = 600_000) { j -> setupToast(context, "${j.optJSONObject("result")?.optInt("albums") ?: 0} Spotify albums in the library") }
        })
        SetupButton("Sign out", busy, Modifier.parity("settings-services.signout", Contract.label("settings-services.signout")).clickable(enabled = !busy) {
            post("/signout") { setupToast(context, "Signed out of Spotify") }
        })
    }
    StatusLine(lib.importStatus, Modifier.parity("settings-services.import-status").padding(top = 4.dp))
}
