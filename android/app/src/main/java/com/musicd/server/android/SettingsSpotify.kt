package com.musicd.server.android

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Choice
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SpotifyAccount
import com.musicd.server.client.SpotifySettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Locale

/*
 * Settings → Services → Spotify natively (bug list item 142), as the page's (settings-spotify.js paintSpotify; the
 * contract's settings-services spotify-* items): once this server plays, the Soloist API key (never shown back), the
 * name the Spotify app shows and Save, the room Spotify plays in (every room but a phone), the status with what the
 * sound has proven, Download or Update Soloist, and the build's line, asked again while Soloist is being downloaded.
 */

/** Spotify's block in Settings' Services; nothing while the server doesn't answer for it ([info]: the ⓘ's words shown). */
@Composable
internal fun SpotifyBlock(client: () -> ServerClient?, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var account by remember { mutableStateOf<SpotifyAccount?>(null) }
    var rooms by remember { mutableStateOf(listOf(Choice("", "None"))) }
    var key by remember { mutableStateOf("") }
    var name by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val dates = remember { DateFormat.getDateInstance(DateFormat.MEDIUM) }
    val ymd = remember { SimpleDateFormat("yyyy-MM-dd", Locale.ROOT) }
    fun show(j: JSONObject) {
        val a = SpotifySettings.parse(j) { d -> runCatching { dates.format(ymd.parse(d)!!) }.getOrDefault(d) }
        account = a
        if (name == null) name = a.deviceName
    }
    suspend fun load() {
        readSetting(client, "spotify")?.let(::show)
        val c = client() ?: return
        withContext(Dispatchers.IO) { runCatching { c.getJson("/api/zones") }.getOrNull() }?.let { rooms = SpotifySettings.rooms(it, account?.room.orEmpty()) }
    }
    LaunchedEffect(Unit) { while (true) { load(); delay(if (account?.fetching == true) 2_000L else 30_000L) } }
    fun post(path: String, body: JSONObject, timeout: Int = 20_000, done: (JSONObject) -> Unit) {
        val c = client() ?: return
        busy = true
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { c.post("/api/settings/spotify$path", body, timeout) } }
                .onSuccess { j -> busy = false; show(j); done(j) }
                .onFailure { busy = false; setupToast(context, it.message ?: "Couldn't reach the server"); load() }
        }
    }
    val a = account ?: return
    Block {
        ServiceTitle("Spotify", Modifier.parity("settings-services.title"),
            Modifier.parity("settings-services.info", Contract.label("settings-services.info", 0, "Spotify")).clickable { info(SpotifySettings.INFO) })
        val field = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 18.sp)
        BasicTextField(key, { key = it }, Modifier.parity("settings-services.spotify-key", Contract.label("settings-services.spotify-key")).fillMaxWidth(), singleLine = true,
            textStyle = field, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
            decorationBox = { inner -> FieldBox(key.isEmpty(), if (a.hasKey) "Soloist API key (set)" else "Soloist API key", inner) })
        Row(Modifier.padding(top = 8.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            val n = name.orEmpty()
            BasicTextField(n, { name = it }, Modifier.parity("settings-services.spotify-name", Contract.label("settings-services.spotify-name")).weight(1f), singleLine = true,
                textStyle = field, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                decorationBox = { inner -> FieldBox(n.isEmpty(), SpotifySettings.DEFAULT_NAME, inner) })
            SetupButton("Save", busy, Modifier.parity("settings-services.spotify-save", Contract.label("settings-services.spotify-save")).clickable(enabled = !busy) {
                val body = JSONObject().put("device_name", n.trim())
                if (key.isNotBlank()) body.put("api_key", key.trim())
                post("", body) { key = ""; name = null; setupToast(context, "Saved") }
            })
        }
        ServiceRow("Room", Modifier.parity("settings-services.info", Contract.label("settings-services.info", 0, "Room")).clickable { info(SpotifySettings.ROOM_INFO) }) {
            SelectBox(choiceWords(rooms, a.room), rooms, null, Modifier.parity("settings-services.spotify-room", Contract.label("settings-services.spotify-room")).clickable {
                pickChoice(context, rooms, a.room) { v -> account = a.copy(room = v); post("", JSONObject().put("room", v)) {} }
            }, width = 187.5.dp)
        }
        StatusLine(a.status, Modifier.parity("settings-services.status").padding(top = 4.dp))
        if (a.hasKey) SetupButton(a.download, busy || a.fetching, Modifier.parity("settings-services.spotify-download",
            Contract.label("settings-services.spotify-download", if (a.download == "Update Soloist") 1 else 0)).padding(top = 6.dp).clickable(enabled = !busy && !a.fetching) {
            account = a.copy(build = "Downloading Soloist from Spotify…", fetching = true)
            post("/download", JSONObject(), 300_000) { j -> setupToast(context, if (j.optJSONObject("soloist")?.optString("error").isNullOrEmpty()) "Soloist is up to date" else "Couldn't download Soloist") }
        })
        if (a.build.isNotEmpty()) StatusLine(a.build, Modifier.parity("settings-services.spotify-build").padding(top = 4.dp))
    }
}
