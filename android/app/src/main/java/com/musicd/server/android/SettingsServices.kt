package com.musicd.server.android

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ServiceAccount
import com.musicd.server.client.ServiceSettings
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/*
 * Settings → Services natively (the group T of old/plan-android-native.md, T4; bug list item 87), as the page's
 * (docs/specs/screens.json, settings-services; settings-services.js paintQobuz and paintTidal; style.css #qobuz-signed,
 * .settings-token-input, .tidal-auth-pending): Qobuz and Tidal, each under its title with its ⓘ. Signed out, Qobuz's email
 * and password and Sign in, Tidal's Sign in on tidal.com, which opens tidal.com with a code to type there, and is waited for
 * (asked again every two seconds) until it lands. Signed in, the stream quality, the favourites in the library on or off,
 * Update library now, Sign out, and what the library holds of the service, asked again while it is being brought in.
 * Each change is made on the app's lane of changes to what Home shows (ServerWrites, item 85).
 */

private val SERVICES = listOf("qobuz", "tidal")

/** Settings' Services ([client]: the server's, [onBack]: back to Settings). */
@Composable
internal fun SettingsServices(client: () -> ServerClient?, onBack: () -> Unit) {
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-services.back", Contract.label("settings-services.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "Services", Modifier.parity("settings-services.heading"))
            for (s in SERVICES) Block { ServiceBlock(s, client) { info = it } }
        }
        info?.let { InfoTip(it, Modifier.parity("settings-services.info")) }
    }
}

/** One service's block: its title and ⓘ, then signed out or signed in as the server says ([service]: "qobuz" or "tidal"). */
@Composable
private fun ServiceBlock(service: String, client: () -> ServerClient?, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val tidal = service == "tidal"
    val name = ServiceSettings.name(service)
    val dates = remember { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT) }
    // As last seen, then the server's (item 198): before, the service's name alone until the server answered.
    var account by remember { mutableStateOf(keptSetting(service)?.let { j -> runCatching { ServiceSettings.parse(service, j, { dates.format(Date(it)) }) }.getOrNull() }) }
    var busy by remember { mutableStateOf(false) }
    var updating by remember { mutableStateOf(false) }
    var said by remember { mutableStateOf<String?>(null) }
    fun show(j: JSONObject) { account = ServiceSettings.parse(service, j, { dates.format(Date(it)) }); said = null }
    suspend fun load() { readSetting(client, service)?.let(::show) }
    // Asked again while a Tidal sign-in is waited for, or the library is being brought in (the page's two and four seconds).
    LaunchedEffect(Unit) { while (true) { untilOnScreen(); load(); delay(if (account?.again == true) (if (tidal) 2_000L else 4_000L) else 30_000L) } }
    // A change to the account, made on the lane: its answer shown, or what went wrong said and the account read again.
    fun change(path: String, body: JSONObject = JSONObject(), timeout: Int = 20_000, done: (JSONObject) -> Unit = ::show) {
        val c = client() ?: return
        val made = ServerWrites.write { c.post("/api/settings/$service$path", body, timeout).also { j -> j.optString("error").takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) } } }
        scope.launch {
            ServerWrites.await(made).onSuccess(done).onFailure { busy = false; updating = false; said = null; setupToast(context, com.musicd.server.client.Failure.said(it, "Couldn't reach the server")); load() }
        }
    }
    val a = account
    ServiceTitle(name, Modifier.parity("settings-services.title"),
        Modifier.parity("settings-services.info", Contract.label("settings-services.info", 0, name)).clickable { info(if (tidal) ServiceSettings.TIDAL_INFO else ServiceSettings.QOBUZ_INFO) })
    if (a == null) return
    if (!a.connected) {
        if (!tidal) {
            var email by remember { mutableStateOf("") }
            var password by remember { mutableStateOf("") }
            fun signIn() {
                if (busy) return
                if (email.isBlank() || password.isEmpty()) { setupToast(context, "Your Qobuz email and password"); return }
                busy = true; said = "Signing in…"
                change("/signin", JSONObject().put("username", email.trim()).put("password", password), 60_000) { j -> busy = false; password = ""; setupToast(context, "Signed in to Qobuz"); show(j) }
            }
            val field = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 18.sp)
            BasicTextField(email, { email = it }, Modifier.parity("settings-services.email", Contract.label("settings-services.email")).fillMaxWidth(), singleLine = true, textStyle = field,
                cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                decorationBox = { inner -> FieldBox(email.isEmpty(), "Qobuz email", inner) })
            BasicTextField(password, { password = it }, Modifier.parity("settings-services.password", Contract.label("settings-services.password")).padding(top = 8.dp).fillMaxWidth(), singleLine = true,
                textStyle = field, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { signIn() }),
                decorationBox = { inner -> FieldBox(password.isEmpty(), "Password", inner) })
            SetupButton("Sign in", busy, Modifier.parity("settings-services.signin", Contract.label("settings-services.signin")).padding(top = 8.dp).clickable(enabled = !busy) { signIn() })
        } else if (a.pendingUrl.isNullOrEmpty()) {
            SetupButton("Sign in on tidal.com", busy, Modifier.parity("settings-services.signin", Contract.label("settings-services.signin", 1)).clickable(enabled = !busy) {
                busy = true
                change("/signin") { j -> busy = false; show(j); account?.pendingUrl?.let { open(context, it) } }
            })
        } else {
            // The sign-in under way (.tidal-auth-pending): the note, the link to open, the code to type there, Cancel.
            val url = a.pendingUrl.orEmpty()
            val box = RoundedCornerShape(10.dp)
            Column(Modifier.padding(top = 16.dp, bottom = 10.dp).fillMaxWidth().clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), box).padding(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(ServiceSettings.TIDAL_NOTE, Modifier.parity("settings-services.tidal-note").fillMaxWidth(), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
                Text(a.linkText, Modifier.parity("settings-services.tidal-link", Contract.label("settings-services.tidal-link", 0, a.linkText)).clickable { open(context, url) },
                    color = paletteColor(Palette.ACCENT_TEXT), fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600, textDecoration = TextDecoration.Underline, textAlign = TextAlign.Center)
                Text(a.pendingCode, Modifier.parity("settings-services.tidal-code").clip(RoundedCornerShape(8.dp)).background(paletteColor(Palette.BG_ELEV)).padding(horizontal = 10.dp, vertical = 4.dp),
                    color = paletteColor(Palette.TEXT), fontSize = 22.sp, lineHeight = 25.sp, fontFamily = FontFamily.Monospace, letterSpacing = 0.18.em)
                SetupButton("Cancel", false, Modifier.parity("settings-services.tidal-cancel", Contract.label("settings-services.tidal-cancel")).clickable { change("/signin/cancel") { scope.launch { load() } } })
            }
        }
        val status = said ?: a.status
        if (status.isNotEmpty()) StatusLine(status, Modifier.parity("settings-services.status").padding(top = if (tidal && a.pendingUrl != null) 0.dp else 4.dp))
        return
    }
    StatusLine(a.status, Modifier.parity("settings-services.status"))
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val qualityName = "Stream quality"
        ServiceRow(qualityName, Modifier.parity("settings-services.info", Contract.label("settings-services.info", 0, qualityName))
            .clickable { info(if (tidal) ServiceSettings.TIDAL_QUALITY_INFO else ServiceSettings.QOBUZ_QUALITY_INFO) }) {
            val choices = ServiceSettings.qualities(service)
            SelectBox(choiceWords(choices, a.quality), choices, null, Modifier.parity("settings-services.quality", Contract.label("settings-services.quality", 0, name)).clickable {
                pickChoice(context, choices, a.quality) { v -> account = a.copy(quality = v); change("", JSONObject().put("quality", v)) }
            }, width = 187.5.dp)
        }
        val importName = ServiceSettings.importName(service)
        ServiceRow(importName, Modifier.parity("settings-services.info", Contract.label("settings-services.info", 0, importName))
            .clickable { info(if (tidal) ServiceSettings.TIDAL_IMPORT_INFO else ServiceSettings.QOBUZ_IMPORT_INFO) }) {
            Toggle(a.import, Modifier.parity("settings-services.import", Contract.label("settings-services.import", if (tidal) 1 else 0)).clickable {
                val on = !a.import
                account = a.copy(import = on)
                // The walls, Home and Playlists read afresh as each opens: the albums are in or out.
                change("", JSONObject().put("import", on)) { j -> show(j); HomeKept.reset() }
            })
        }
    }
    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (a.import) SetupButton("Update library now", updating, Modifier.parity("settings-services.update", Contract.label("settings-services.update")).clickable(enabled = !updating) {
            updating = true; said = null
            account = a.copy(importStatus = ServiceSettings.importing(service))
            change("/import", timeout = 600_000) { j -> updating = false; setupToast(context, ServiceSettings.updated(service, j)); scope.launch { load() } }
        })
        SetupButton("Sign out", busy, Modifier.parity("settings-services.signout", Contract.label("settings-services.signout")).clickable(enabled = !busy) {
            busy = true
            change("/signout") { busy = false; setupToast(context, "Signed out of $name"); scope.launch { load() } }
        })
    }
    StatusLine(a.importStatus, Modifier.parity("settings-services.import-status").padding(top = 4.dp))
}

/** A block's title with its ⓘ (.settings-block-title): 13 in 700, spaced, in capitals, faint, the ⓘ's 32 beside it; 10 under it. */
@Composable
private fun ServiceTitle(text: String, modifier: Modifier, info: Modifier) {
    Row(Modifier.padding(bottom = 10.dp).heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), modifier, color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
        Box(info.size(32.dp).padding(start = 4.dp), contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 13.sp) }
    }
}

/**
 * A signed-in row (#qobuz-signed .settings-row): 44 tall at least, its name in 16 with its ⓘ after it, the ⓘ on the next
 * line where the name leaves it no room (as the page's inline one goes), [control] on the right, 16 from them.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ServiceRow(name: String, info: Modifier, control: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        FlowRow(Modifier.weight(1f), itemVerticalAlignment = Alignment.CenterVertically) {
            Text(name, Modifier.parity("settings-services.name"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
            Box(info.size(32.dp).padding(start = 4.dp), contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 16.sp) }
        }
        control()
    }
}

/** What is said of the account (.settings-token-status): 11 dim. */
@Composable
private fun StatusLine(text: String, modifier: Modifier) {
    Text(text, modifier, color = paletteColor(Palette.TEXT_DIM), fontSize = 11.sp, lineHeight = 15.sp)
}

/** A field's ground (.settings-token-input): 34 tall, 8 round on the raised ground, 10 and 7 in, its [hint] faint while empty. */
@Composable
private fun FieldBox(empty: Boolean, hint: String, inner: @Composable () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    Box(Modifier.fillMaxWidth().height(34.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 10.dp),
        contentAlignment = Alignment.CenterStart) {
        if (empty) Text(hint, color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
        inner()
    }
}

private fun open(context: android.content.Context, url: String) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
