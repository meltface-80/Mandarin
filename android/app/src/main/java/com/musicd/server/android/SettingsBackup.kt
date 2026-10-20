package com.musicd.server.android

import android.app.Activity
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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.BackupEntry
import com.musicd.server.client.BackupSettings
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.Date

/*
 * Settings → Backup & restore natively (the group T of docs/specs/plan-android-native.md, T9; bug list item 92), as the
 * page's (docs/specs/screens.json, settings-backup; settings-backup.js): Back up, its parts ticked, a passphrase, to a file
 * on this phone (Android's own "save as", AppBackup.saveTo) or to the server; Restore, from a file on this phone (Android's
 * "open") or from any backup in the list, the server's and this phone's, newest first, each with Restore… (its parts
 * ticked, a sealed one's passphrase, Restore now, asked first), Download (the server's, saved to this phone) and Delete
 * (asked first). This screen's settings travel with a backup and come back with a restore (handed to and from the page,
 * where they live); the app's are AppBackup's. A restore is made on the app's lane of changes (ServerWrites, item 85),
 * and once the server is back from its restart the app starts again on what was restored, as the page reloads.
 */

/** Settings' Backup & restore ([client]: the server's, [onBack]: back to Settings). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SettingsBackup(client: () -> ServerClient?, onBack: () -> Unit) {
    val context = LocalContext.current
    val activity = context as? MainActivity
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<JSONObject?>(null) }
    var phone by remember { mutableStateOf(JSONArray()) }
    var ticked by remember { mutableStateOf(BackupSettings.backupParts(true).toSet()) }
    var pass by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    // The restore panel open (a backup's key, or FILE for one from a file), its ticks and its passphrase; the question asked.
    var open by remember { mutableStateOf<String?>(null) }
    var panelTicked by remember { mutableStateOf(emptySet<String>()) }
    var panelPass by remember { mutableStateOf("") }
    var ask by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    var tip by remember { mutableStateOf<String?>(null) }
    val dates = remember { java.text.SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(java.util.Locale.getDefault(), "yMMMdhhmm"), java.util.Locale.getDefault()) }
    val date = { ms: Long -> dates.format(Date(ms)) }
    suspend fun load() {
        val c = client() ?: return
        withContext(Dispatchers.IO) { runCatching { c.getJson("/api/backup") }.getOrNull() }?.let { info = it }
        phone = withContext(Dispatchers.IO) { runCatching { AppBackup.files(context) }.getOrDefault(JSONArray()) }
    }
    LaunchedEffect(Unit) { load() }
    LaunchedEffect(tip) { val t = tip ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); tip = null }
    fun want(parts: List<String>, set: Set<String>) = parts.filter { it in set }
    // A restore or a delete asked first (the page's yes-or-no sheet), [yes] once answered so.
    fun askFirst(question: String, yes: () -> Unit) { ask = question to yes }

    // A restore's answer (the page's finishRestore): this screen's settings handed back to the page, the app's put back, then
    // the app starts again on them, once the server is back from its restart where it restarts.
    fun finish(j: JSONObject) {
        val said = BackupSettings.restoreSaid(j)
        if (!j.optBoolean("ok")) { busy = false; said?.let { setupToast(context, it) }; return }
        j.optJSONObject("page")?.let { NativeShell.toPage("backup-page-restore", it.toString()) }
        j.optJSONObject("app")?.let { runCatching { AppBackup.import(context, it) } }
        scope.launch {
            if (j.optBoolean("restarting")) {
                note = "Restoring… Mandarin is restarting with the restored settings. The app starts again when it's back." + (said?.let { " $it" } ?: "")
                val c = client()
                var wasDown = false
                while (c != null) {
                    delay(1_000)
                    val up = withContext(Dispatchers.IO) { runCatching { c.getJson("/api/health") }.isSuccess }
                    if (up && wasDown) break
                    if (!up) wasDown = true
                }
            } else { said?.let { setupToast(context, it) }; delay(if (said != null) 2_500 else 300) }
            (context as? Activity)?.recreate()
        }
    }
    // A restore made on the lane ([made]: the call), its answer finished here.
    fun restore(made: () -> JSONObject) {
        busy = true; open = null
        val f = ServerWrites.write { runCatching(made).getOrElse { JSONObject().put("ok", false).put("error", it.message ?: "Restore failed") } }
        scope.launch { ServerWrites.await(f).onSuccess(::finish).onFailure { busy = false; setupToast(context, "Couldn't reach the server") } }
    }
    fun openPanel(key: String, parts: List<String>) { open = if (open == key) null else key; panelTicked = parts.toSet(); panelPass = "" }

    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-backup.back", Contract.label("settings-backup.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "Backup & restore", Modifier.parity("settings-backup.heading"))
            Block {
                BackupTitle("Back up", Modifier.parity("settings-backup.info", Contract.label("settings-backup.info", 0, "Back up")).clickable { tip = BackupSettings.BACKUP_INFO })
                val parts = BackupSettings.backupParts(true)
                if (info != null) PartTicks(parts.map { it to BackupSettings.partName(it, info?.optLong("db_bytes")) }, BackupSettings.HINT, ticked) { p -> ticked = if (p in ticked) ticked - p else ticked + p }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Column {
                        Text("Passphrase", Modifier.parity("settings-backup.pass-name"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W700)
                        Text(BackupSettings.PASS_HINT, Modifier.parity("settings-backup.pass-hint"), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 16.875.sp)
                    }
                    BasicTextField(pass, { pass = it }, Modifier.parity("settings-backup.pass", Contract.label("settings-backup.pass")).fillMaxWidth(), singleLine = true,
                        textStyle = PASS_STYLE.copy(color = paletteColor(Palette.TEXT)), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), visualTransformation = PASS_HIDDEN,
                        keyboardOptions = PASS_KEYS, decorationBox = { inner -> PassBox(pass.isEmpty(), "8 characters or more", inner) })
                }
                FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SetupButton("Back up to a file on this phone", busy, Modifier.parity("settings-backup.to-file", Contract.label("settings-backup.to-file")).clickable(enabled = !busy) {
                        val w = want(parts, ticked)
                        if (w.isEmpty()) { setupToast(context, "Tick something to back up"); return@clickable }
                        val a = activity ?: return@clickable
                        busy = true; note = "Choose where to save the backup…"
                        scope.launch {
                            val page = if ("page" in w) BackupPage.ask() else null
                            val req = JSONObject().put("include", JSONArray(BackupSettings.serverParts(w))).put("noApp", "app" !in w)
                            if (pass.isNotEmpty()) req.put("passphrase", pass)
                            page?.let { req.put("page", it) }
                            a.chooseBackupFile(AppBackup.fileName()) { uri ->
                                if (uri == null) { busy = false; note = ""; return@chooseBackupFile }
                                note = "Backing up…"
                                scope.launch {
                                    val r = withContext(Dispatchers.IO) { runCatching { AppBackup.saveTo(context, uri, req) }.getOrElse { JSONObject().put("ok", false).put("error", it.message ?: "Backup failed") } }
                                    busy = false
                                    if (r.optBoolean("ok")) { note = BackupSettings.backedUp(r.optLong("bytes"), r.optLong("created", System.currentTimeMillis()), date); load() }
                                    else { note = ""; setupToast(context, r.optString("error").ifEmpty { "Backup failed" }) }
                                }
                            }
                        }
                    })
                    SetupButton("Back up to the server", busy, Modifier.parity("settings-backup.to-server", Contract.label("settings-backup.to-server")).clickable(enabled = !busy) {
                        val w = want(parts, ticked)
                        if (w.isEmpty()) { setupToast(context, "Tick something to back up"); return@clickable }
                        val c = client() ?: return@clickable
                        busy = true; note = "Backing up…"
                        scope.launch {
                            val body = JSONObject().put("include", JSONArray(BackupSettings.serverParts(w)))
                            if (pass.isNotEmpty()) body.put("passphrase", pass)
                            if ("page" in w) BackupPage.ask()?.let { body.put("page", it) }
                            if ("app" in w) body.put("app", AppBackup.export(context))
                            val r = withContext(Dispatchers.IO) { runCatching { c.post("/api/backup/save", body, 600_000) } }
                            busy = false
                            r.onSuccess { j -> val b = j.optJSONObject("backup"); note = BackupSettings.backedUp(b?.optLong("bytes") ?: 0, b?.optLong("created") ?: 0, date); load() }
                                .onFailure { note = ""; setupToast(context, it.message ?: "Backup failed") }
                        }
                    })
                }
                Spacer(Modifier.height(6.dp))
                if (note.isNotEmpty()) Text(note, Modifier.parity("settings-backup.note"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
            }
            Block {
                BackupTitle("Restore", Modifier.parity("settings-backup.info", Contract.label("settings-backup.info", 0, "Restore")).clickable { tip = BackupSettings.RESTORE_INFO })
                SetupButton("Restore from a file on this phone…", busy, Modifier.parity("settings-backup.from-file", Contract.label("settings-backup.from-file")).clickable(enabled = !busy) {
                    openPanel(FILE, BackupSettings.backupParts(true))
                })
                if (open == FILE) RestorePanel {
                    RestoreChoices(BackupSettings.backupParts(true), panelTicked, { panelTicked = it }, BackupSettings.FILE_PASS, panelPass, { panelPass = it }, 1) { w ->
                        askFirst(BackupSettings.restoreQuestion(w)) {
                            val p = panelPass
                            activity?.openBackupFile { uri -> if (uri != null) restore { AppBackup.restoreFrom(context, uri, w.joinToString(","), p) } }
                        }
                    }
                }
                val list = BackupSettings.list(info, phone)
                Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (info != null && list.isEmpty()) Text(BackupSettings.empty(true), Modifier.parity("settings-backup.empty").padding(top = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
                    for (b in list) BackupItem(b, date, open == keyOf(b), busy,
                        onRestore = { openPanel(keyOf(b), BackupSettings.restoreParts(b, true)) },
                        onDownload = { download(activity, context, b, scope) { load() } },
                        onDelete = {
                            askFirst(BackupSettings.deleteQuestion(b, date)) {
                                scope.launch {
                                    withContext(Dispatchers.IO) { runCatching { if (b.onPhone) AppBackup.deleteFile(context, Uri.parse(b.uri)) else client()?.deleteBackup(b.id) } }
                                    load()
                                }
                            }
                        }) {
                        RestoreChoices(BackupSettings.restoreParts(b, true), panelTicked, { panelTicked = it }, if (b.sealed) BackupSettings.SEALED else null, panelPass, { panelPass = it }, 0) { w ->
                            askFirst(BackupSettings.restoreQuestion(w)) {
                                val p = panelPass
                                if (b.onPhone) restore { AppBackup.restoreFrom(context, Uri.parse(b.uri), w.joinToString(","), p) }
                                else restore {
                                    val c = client() ?: throw IllegalStateException("No server")
                                    val body = JSONObject().put("include", JSONArray(w))
                                    if (p.isNotEmpty()) body.put("passphrase", p)
                                    c.post("/api/backup/restore/" + Uri.encode(b.id), body, 600_000)
                                }
                            }
                        }
                    }
                }
            }
        }
        ask?.let { (q, yes) -> ConfirmDialog(q) { ok -> ask = null; if (ok) yes() } }
        tip?.let { InfoTip(it, Modifier.parity("settings-backup.info")) }
    }
}

private const val FILE = "file"
private fun keyOf(b: BackupEntry) = if (b.onPhone) "phone:" + b.uri else "server:" + b.id

/** One backup's card: where, when and what, Restore… (its panel under it while open), Download (the server's) and Delete. */
@Composable
private fun BackupItem(b: BackupEntry, date: (Long) -> String, opened: Boolean, busy: Boolean, onRestore: () -> Unit, onDownload: () -> Unit, onDelete: () -> Unit,
                       panel: @Composable () -> Unit) {
    BackupCard(BackupSettings.title(b), BackupSettings.meta(b, date), BackupSettings.partsLine(b), actions = {
        SetupButton("Restore…", busy, Modifier.parity("settings-backup.restore", Contract.label("settings-backup.restore")).clickable(enabled = !busy, onClick = onRestore))
        if (!b.onPhone) SetupButton("Download", false, Modifier.parity("settings-backup.download", Contract.label("settings-backup.download")).clickable(onClick = onDownload))
        SetupButton("Delete", busy, Modifier.parity("settings-backup.delete", Contract.label("settings-backup.delete")).clickable(enabled = !busy, onClick = onDelete))
    }, panel = if (opened) panel else null)
}

/**
 * A restore's choices (the page's openRestorePanel): the parts it holds, each ticked, a sealed one's passphrase ([passHint];
 * none when not sealed), and Restore now (Choose the file… for one from a file, [go] 1); [onGo] with the parts ticked.
 */
@Composable
private fun RestoreChoices(parts: List<String>, ticked: Set<String>, onTicked: (Set<String>) -> Unit, passHint: String?, pass: String, onPass: (String) -> Unit, go: Int,
                           onGo: (List<String>) -> Unit) {
    val context = LocalContext.current
    PartTicks(parts.map { it to BackupSettings.partName(it, null) }, BackupSettings.HINT, ticked) { p -> onTicked(if (p in ticked) ticked - p else ticked + p) }
    if (passHint != null) BasicTextField(pass, onPass, Modifier.parity("settings-backup.restore-pass", Contract.label("settings-backup.restore-pass")).padding(bottom = 10.dp).fillMaxWidth(),
        singleLine = true, textStyle = PASS_STYLE.copy(color = paletteColor(Palette.TEXT)), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), visualTransformation = PASS_HIDDEN,
        keyboardOptions = PASS_KEYS, decorationBox = { inner -> PassBox(pass.isEmpty(), passHint, inner) })
    SetupButton(Contract.label("settings-backup.go", go), false, Modifier.parity("settings-backup.go", Contract.label("settings-backup.go", go)).clickable {
        val w = parts.filter { it in ticked }
        if (w.isEmpty()) setupToast(context, "Tick something to restore") else onGo(w)
    })
}

/** One of the server's backups saved to this phone (Android's "save as"), then listed with this phone's files ([then]). */
private fun download(activity: MainActivity?, context: android.content.Context, b: BackupEntry, scope: kotlinx.coroutines.CoroutineScope, then: suspend () -> Unit) {
    val a = activity ?: return
    a.chooseBackupFile(AppBackup.fileName()) { uri ->
        if (uri == null) return@chooseBackupFile
        val meta = JSONObject().put("created", b.created).put("version", b.version).put("sealed", b.sealed).put("parts", JSONArray(b.parts))
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { AppBackup.download(context, b.id, uri, meta) }.getOrElse { JSONObject().put("ok", false).put("error", it.message) } }
            setupToast(context, if (r.optBoolean("ok")) "Saved: " + BackupSettings.bytes(r.optLong("bytes")) else r.optString("error").ifEmpty { "Couldn't save the backup" })
            then()
        }
    }
}

/** A block's title with its ⓘ (.settings-block-title): 13 in 700, spaced, in capitals, faint, the ⓘ's 32 beside it; 10 under it. */
@Composable
private fun BackupTitle(text: String, info: Modifier) {
    Row(Modifier.padding(bottom = 10.dp).heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), Modifier.parity("settings-backup.title"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp,
            fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
        Box(info.size(32.dp).padding(start = 4.dp), contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 13.sp) }
    }
}

/** A passphrase field's look (.settings-token-input): 34 tall, 8 round on the raised ground, 10 in, its [hint] faint while [empty]. */
@Composable
private fun PassBox(empty: Boolean, hint: String, inner: @Composable () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    Box(Modifier.fillMaxWidth().height(34.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 10.dp),
        contentAlignment = Alignment.CenterStart) {
        if (empty) Text(hint, color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
        inner()
    }
}
