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
import com.musicd.server.client.SpotifyConnect
import com.musicd.server.client.SpotifyConnectSettings
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Locale

/*
 * Settings → Services → Spotify → Spotify Connect natively (bug list item 501), as the page's (settings-spotify-connect.js;
 * docs/specs/screens.json, settings-service): what Soloist says or what plays, how the room is sent it, the Soloist API
 * key (never shown back), the name the Spotify app shows, Save, Download / Update Soloist, the room Spotify plays in,
 * and Soloist's build and when it runs out.
 */

private const val ROOM_INFO = "The room Spotify plays in when you choose Mandarin in the Spotify app. Each room is sent Spotify as it is sent your library: beside its name, how."

/** Spotify Connect's block on Spotify's page ([info]: an ⓘ's words shown). */
@Composable
internal fun SpotifyConnectBlock(client: () -> ServerClient?, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val dates = remember { DateFormat.getDateInstance(DateFormat.MEDIUM) }
    fun parse(j: JSONObject) = SpotifyConnectSettings.parse(j) { d ->
        runCatching { dates.format(SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).parse(d)!!) }.getOrDefault(d)
    }
    var state by remember { mutableStateOf(keptSetting("spotify-connect")?.let { j -> runCatching { parse(j) }.getOrNull() }) }
    var key by remember { mutableStateOf("") }
    var name by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    suspend fun load() { readSetting(client, "spotify-connect")?.let { state = parse(it) } }
    LaunchedEffect(Unit) { while (true) { untilOnScreen(); load(); delay(if (state?.again == true) 2_000L else 30_000L) } }
    fun change(path: String, body: JSONObject, ok: String?, done: () -> Unit = {}) {
        val c = client() ?: return
        val call = { c.post("/api/settings/spotify-connect$path", body, 120_000) }
        val made = ServerWrites.aside(call)
        scope.launch {
            ServerWrites.await(made).onSuccess { j ->
                state = parse(j)
                val error = j.optJSONObject("soloist")?.optString("error").orEmpty()
                if (path == "/download" && error.isNotEmpty()) setupToast(context, "Couldn't download Soloist: $error") else ok?.let { setupToast(context, it) }
            }.onFailure { setupToast(context, com.musicd.server.client.Failure.said(it, "Couldn't reach the server")); load() }
            done()
        }
    }
    ServiceTitle("Spotify Connect", Modifier.parity("settings-service.title"),
        Modifier.parity("settings-service.info", Contract.label("settings-service.info", 0, "Spotify Connect")).clickable { info(SpotifyConnectSettings.INFO) })
    val s: SpotifyConnect = state ?: return
    StatusLine(s.status, Modifier.parity("settings-service.connect-status"))
    s.sound?.let { StatusLine(it, Modifier.parity("settings-service.connect-sound").padding(top = 2.dp)) }
    val field = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 18.sp)
    BasicTextField(key, { key = it }, Modifier.parity("settings-service.connect-key", Contract.label("settings-service.connect-key")).padding(top = 8.dp).fillMaxWidth(),
        singleLine = true, textStyle = field, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
        decorationBox = { inner -> FieldBox(key.isEmpty(), if (s.hasKey) "Key saved · paste a new one to replace it" else "Soloist API key", inner) })
    val shownName = name ?: s.deviceName
    BasicTextField(shownName, { name = it }, Modifier.parity("settings-service.connect-name", Contract.label("settings-service.connect-name")).padding(top = 8.dp).fillMaxWidth(),
        singleLine = true, textStyle = field, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        decorationBox = { inner -> FieldBox(shownName.isEmpty(), "Mandarin", inner) })
    Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SetupButton("Save", busy, Modifier.parity("settings-service.connect-save", Contract.label("settings-service.connect-save")).clickable(enabled = !busy) {
            val body = JSONObject().put("device_name", shownName.trim())
            if (key.isNotBlank()) body.put("api_key", key.trim())
            busy = true
            change("", body, if (key.isNotBlank()) "Key saved: Soloist is starting" else "Saved") { busy = false; key = ""; name = null }
        })
        if (s.hasKey) SetupButton(s.download, s.fetching, Modifier.parity("settings-service.connect-download", Contract.label("settings-service.connect-download", if (s.fetching) 2 else if (s.download == "Update Soloist") 1 else 0))
            .clickable(enabled = !s.fetching) { state = s.copy(fetching = true, download = "Downloading…"); change("/download", JSONObject(), "Soloist downloaded") })
    }
    val choices = listOf(Choice("", "Choose a room")) + s.rooms.map { Choice(it.id, it.words) }
    Row(Modifier.padding(top = 6.dp)) {
        ServiceRow("Room", Modifier.parity("settings-service.info", Contract.label("settings-service.info", 0, "Room")).clickable { info(ROOM_INFO) }) {
            SelectBox(choiceWords(choices, s.room), choices, null, Modifier.parity("settings-service.connect-room", Contract.label("settings-service.connect-room")).clickable {
                pickChoice(context, choices, s.room) { v ->
                    state = s.copy(room = v)
                    change("", JSONObject().put("room", v), s.rooms.firstOrNull { it.id == v }?.let { "Spotify plays in ${it.name}" })
                }
            }, width = 187.5.dp)
        }
    }
    if (s.build.isNotEmpty()) StatusLine(s.build, Modifier.parity("settings-service.connect-build").padding(top = 4.dp))
}
