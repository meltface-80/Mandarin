package com.musicd.server.android

import android.app.Activity
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Account
import com.musicd.server.client.AccountDevices
import com.musicd.server.client.ApiKey
import com.musicd.server.client.ApiKeySpec
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * Two of Settings' pages natively (bug list item 76), as the page's (docs/specs/screens.json, settings-account and
 * settings-keys; settings-account.js, settings.js's wireKey; style.css .acct-*, .settings-token-*, .token-check): the
 * account (the devices signed in, signing out, a new password) and the API keys (each pasted, saved and checked).
 */

/**
 * Account: who is signed in; the devices signed in, each but this one with its Sign out; Sign out of this device (the
 * app goes to its sign-in); the current password and the new one twice, Change password, and what came of it.
 */
@Composable
internal fun SettingsAccount(client: () -> ServerClient?, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var account by remember { mutableStateOf<AccountDevices?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }   // a device being signed out, or "password"
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("") }
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    LaunchedEffect(Unit) {
        val c = client() ?: return@LaunchedEffect
        withContext(Dispatchers.IO) { runCatching { c.accountDevices() } }
            .onSuccess { account = it }
    }
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-account.back", Contract.label("settings-account.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Account", Modifier.parity("settings-account.heading"))
        BlockTitle("Signed-in devices", Modifier.parity("settings-account.title"))
        val devices = account?.devices.orEmpty()
        val now = System.currentTimeMillis()
        devices.forEachIndexed { i, d ->
            Row(Modifier.parity("settings-account.device").fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(d.name, color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
                    Text(d.sub(now), Modifier.padding(top = 2.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.sp)
                }
                if (!d.current) UpdateButton("Sign out", busy == d.id, Modifier.parity("settings-account.revoke", Contract.label("settings-account.revoke")).clickable(enabled = busy == null) {
                    val c = client() ?: return@clickable
                    busy = d.id
                    scope.launch {
                        val r = withContext(Dispatchers.IO) { runCatching { c.revokeDevice(d.id) } }
                        busy = null
                        r.onSuccess { account = account?.let { a -> a.copy(devices = a.devices - d) }; toast("${d.name} signed out") }.onFailure { toast(com.musicd.server.client.Failure.said(it, "Couldn't sign it out")) }
                    }
                })
            }
            if (i < devices.size - 1) Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
        }
        Note(AnnotatedString("Sign out a device you've lost or don't use. It will need the password to come back."), Modifier.parity("settings-account.note"))
        UpdateButton("Sign out of this device", false, Modifier.parity("settings-account.signout", Contract.label("settings-account.signout")).padding(top = 20.dp).clickable {
            val activity = context as? Activity
            scope.launch {
                client()?.let { c -> withContext(Dispatchers.IO) { Account(c).signOut() } }
                Store.setToken(context, null)
                context.startActivity(Intent(context, SignInActivity::class.java))
                activity?.finish()
            }
        })
        SettingsDivider()
        BlockTitle("Change password", Modifier.parity("settings-account.title"))
        val focus = remember { List(3) { MutableInteractionSource() } }
        BasicTextField(current, { current = it }, Modifier.parity("settings-account.current", Contract.label("settings-account.current")).fillMaxWidth().padding(bottom = 8.dp),
            singleLine = true, interactionSource = focus[0], textStyle = PASSWORD, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), decorationBox = { PasswordBox(current, "Current password", focus[0], it) })
        BasicTextField(new, { new = it }, Modifier.parity("settings-account.new", Contract.label("settings-account.new")).fillMaxWidth().padding(bottom = 8.dp),
            singleLine = true, interactionSource = focus[1], textStyle = PASSWORD, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), decorationBox = { PasswordBox(new, "New password (8 or more characters)", focus[1], it) })
        BasicTextField(again, { again = it }, Modifier.parity("settings-account.again", Contract.label("settings-account.again")).fillMaxWidth().padding(bottom = 8.dp),
            singleLine = true, interactionSource = focus[2], textStyle = PASSWORD, cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), decorationBox = { PasswordBox(again, "New password again", focus[2], it) })
        UpdateButton("Change password", busy == "password", Modifier.parity("settings-account.change", Contract.label("settings-account.change")).padding(top = 8.dp).clickable(enabled = busy == null) {
            AccountDevices.passwordProblem(current, new, again)?.let { status = it; return@clickable }
            val c = client() ?: return@clickable
            val username = account?.username.orEmpty()
            busy = "password"; status = "Checking…"
            scope.launch {
                val r = withContext(Dispatchers.IO) { runCatching { Account(c).changePassword(username, current, new) } }
                busy = null
                r.onSuccess { current = ""; new = ""; again = ""; status = "Password changed." }.onFailure { status = com.musicd.server.client.Failure.said(it, "Couldn't change it") }
            }
        })
        if (status.isNotEmpty()) Text(status, Modifier.parity("settings-account.status").padding(top = 8.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 11.sp, lineHeight = 15.sp)
        Note(buildAnnotatedString {
            append("Devices already signed in stay signed in. Forgot it? On the server run ")
            withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append("docker exec musicd-server /app/server/bin/mandarin-server reset-password") }
            append(" and create the account again.")
        }, Modifier.parity("settings-account.note").padding(top = 4.dp))
    }
}

/**
 * API Keys: what they are for; Discogs, FanArt.tv and Last.fm, each with its ⓘ (its help along the foot for as long as
 * it takes to read), the box to paste the key into (its ✓ or ✕ once checked, what the box says), Save, and what the
 * server says of the key.
 */
@Composable
internal fun SettingsKeys(client: () -> ServerClient?, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val keys = remember { mutableStateOf<Map<String, ApiKey>>(emptyMap()) }
    val typed = remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var saving by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        val c = client() ?: return@LaunchedEffect
        for (spec in ApiKeySpec.ALL) withContext(Dispatchers.IO) { runCatching { c.apiKey(spec.route) }.getOrNull() }?.let { keys.value = keys.value + (spec.route to it) }
    }
    // The help shown long enough to read: four seconds and a fifth of one a word, 25 at most, as the page's.
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-keys.back", Contract.label("settings-keys.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "API Keys", Modifier.parity("settings-keys.heading"))
            ApiKeySpec.ALL.forEachIndexed { i, spec ->
                if (i > 0) SettingsDivider()
                val k = keys.value[spec.route]
                Row(Modifier.padding(top = if (i == 0) 4.dp else 0.dp).heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(spec.name, Modifier.parity("settings-keys.name"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
                    Box(Modifier.parity("settings-keys.info", Contract.label("settings-keys.info", 0, spec.name)).size(32.dp).clickable { info = spec.info }.padding(start = 4.dp),
                        contentAlignment = Alignment.Center) {
                        Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 16.sp)
                    }
                }
                Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val value = typed.value[spec.route].orEmpty()
                    val focus = remember { MutableInteractionSource() }
                    val focused by focus.collectIsFocusedAsState()
                    val shape = RoundedCornerShape(8.dp)
                    val edge = when { focused -> Palette.ACCENT; k?.ok == true -> Palette.ACCENT; k?.bad == true -> Palette.DANGER; else -> Palette.BORDER }
                    // The box (.token-field) and its ✓ or ✕, 7 in from its right edge, over the room its padding keeps.
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                        BasicTextField(value, { typed.value = typed.value + (spec.route to it) }, Modifier.parity("settings-keys.field", Contract.label("settings-keys.field", 0, spec.name)).fillMaxWidth(),
                            singleLine = true, interactionSource = focus, textStyle = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 18.sp),
                            cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false),
                            decorationBox = { field ->
                                Box(Modifier.fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(edge), shape)
                                    .padding(start = 10.dp, top = 7.dp, end = 34.dp, bottom = 7.dp), contentAlignment = Alignment.CenterStart) {
                                    if (value.isEmpty()) Text(k?.placeholder(spec.emptyHint) ?: spec.emptyHint, color = paletteColor(if (k?.ok == true) Palette.ACCENT_TEXT else Palette.TEXT_FAINT),
                                        fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    field()
                                }
                            })
                        k?.badge?.let {
                            Box(Modifier.parity("settings-keys.check").padding(end = 7.dp).size(20.dp).background(paletteColor(if (k.ok) Palette.ACCENT else Palette.DANGER), CircleShape),
                                contentAlignment = Alignment.Center) {
                                Text(it, color = if (k.ok) paletteColor(Palette.ON_ACCENT) else Color.White, fontSize = 12.sp, lineHeight = 12.sp, fontWeight = FontWeight.W800)
                            }
                        }
                    }
                    UpdateButton("Save", saving == spec.route, Modifier.parity("settings-keys.save", Contract.label("settings-keys.save")).clickable(enabled = saving == null) {
                        val v = value.trim()
                        val c = client() ?: return@clickable
                        if (v.isEmpty()) return@clickable
                        saving = spec.route
                        scope.launch {
                            val r = withContext(Dispatchers.IO) { runCatching { c.saveApiKey(spec.route, spec.field, v) } }
                            saving = null
                            r.onSuccess { nk -> keys.value = keys.value + (spec.route to nk); typed.value = typed.value - spec.route; Toast.makeText(context, spec.saved(nk), Toast.LENGTH_SHORT).show() }
                                .onFailure { Toast.makeText(context, com.musicd.server.client.Failure.said(it, "Failed to save ${spec.noun}"), Toast.LENGTH_SHORT).show() }
                        }
                    })
                }
                Text(k?.status.orEmpty(), Modifier.parity("settings-keys.status").padding(top = 4.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 11.sp, lineHeight = 15.sp)
            }
        }
        // The ⓘ's help (.settings-info-toast): along the foot, over the page, until it has been read.
        info?.let { t ->
            val box = RoundedCornerShape(12.dp)
            Box(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 88.dp).widthIn(max = minOf(400, (LocalConfiguration.current.screenWidthDp * 0.92f).toInt()).dp)
                .clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), box)
                .parity("settings-keys.info").padding(horizontal = 18.dp, vertical = 12.dp)) {
                Text(t, color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 21.sp)
            }
        }
    }
}

/** A block's title (.settings-block-title): 13 in 700, spaced, in capitals, faint; 4 over and 10 under it. */
@Composable
private fun BlockTitle(text: String, modifier: Modifier) {
    Text(text.uppercase(), modifier.padding(top = 4.dp, bottom = 10.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
}

/** A note (.settings-note): 12 faint in 1.45, 6 over it. */
@Composable
private fun Note(text: AnnotatedString, modifier: Modifier) {
    Text(text, modifier.padding(top = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
}

/** A Settings button (.settings-update-btn): 36 tall, 14 in, 8 round, the raised ground and its edge, 13 dim; dim while it works ([busy]). */
@Composable
private fun UpdateButton(words: String, busy: Boolean, modifier: Modifier) {
    val shape = RoundedCornerShape(8.dp)
    Box(modifier.heightIn(min = 36.dp).alpha(if (busy) 0.6f else 1f).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape)
        .padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
        Text(words, color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
    }
}

/** The passwords' words: 16 in the text's colour. */
private val PASSWORD = TextStyle(color = Color(Palette.TEXT.toInt()), fontSize = 16.sp, lineHeight = 22.sp)

/** A password's box (.acct-input): the raised ground, 8 round, 10 and 12 in, 44 tall, its edge the accent while typed in; [hint] while it is empty. */
@Composable
private fun PasswordBox(value: String, hint: String, focus: MutableInteractionSource, field: @Composable () -> Unit) {
    val focused by focus.collectIsFocusedAsState()
    val shape = RoundedCornerShape(8.dp)
    Box(Modifier.fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(if (focused) Palette.ACCENT else Palette.BORDER), shape)
        .padding(horizontal = 12.dp, vertical = 10.dp)) {
        if (value.isEmpty()) Text(hint, color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        field()
    }
}
