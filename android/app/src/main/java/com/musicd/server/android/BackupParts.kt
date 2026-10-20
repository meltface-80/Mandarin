package com.musicd.server.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/*
 * The pieces of Settings → Backup & restore (bug list item 92; SettingsBackup.kt draws the page with them), as the page
 * draws them (style.css .backup-part, .backup-pass, .backup-item, .backup-restore): a part's tick box with its name and
 * what it holds, the passphrase's field, a backup's card and its buttons. And this screen's own settings, which live in
 * the page (its localStorage): asked of it for a backup ([BackupPage]).
 */

/** This screen's settings, asked of the page for a backup (the page hands them back through MusicdApp.backupPageSettings). */
internal object BackupPage {
    @Volatile private var waiting: CompletableDeferred<String>? = null

    /** The page's answer (from its bridge, on any thread). */
    fun answered(json: String) { waiting?.complete(json) }

    /** This screen's settings, or none when the page doesn't answer within two seconds. Ask on the main thread. */
    suspend fun ask(): JSONObject? {
        val d = CompletableDeferred<String>()
        waiting = d
        NativeShell.toPage("backup-page", null)
        val got = withTimeoutOrNull(2_000) { d.await() }
        waiting = null
        return got?.let { runCatching { JSONObject(it) }.getOrNull() }
    }
}

/**
 * The parts to tick (.backup-parts): 8 apart, 6 over them and 12 under; each (.backup-part) its box, 18 square, 3 down and 4
 * in, then 13 on, its name in 16/600 and what it holds in 12.5 dim under it ([names]: each part and its name).
 */
@Composable
internal fun PartTicks(names: List<Pair<String, String>>, hints: Map<String, String>, ticked: Set<String>, onTick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((part, name) in names) {
            Row(Modifier.parity("settings-backup.part", Contract.label("settings-backup.part", 0, name)).fillMaxWidth().clickable { onTick(part) }) {
                TickBox(part in ticked, Modifier.padding(start = 4.dp, top = 3.dp, end = 3.dp))
                Column(Modifier.padding(start = 10.dp)) {
                    Text(name, Modifier.parity("settings-backup.part-name"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W600)
                    Text(hints[part].orEmpty(), Modifier.parity("settings-backup.part-hint"), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 16.875.sp)
                }
            }
        }
    }
}

/** A tick box as the page's is drawn (the browser's, in the accent): ticked, brass with its tick dark; not, white in a grey edge. */
@Composable
private fun TickBox(on: Boolean, modifier: Modifier) {
    val shape = RoundedCornerShape(2.dp)
    val ink = paletteColor(Palette.ON_ACCENT)
    Box(modifier.size(18.dp).clip(shape).background(if (on) paletteColor(Palette.ACCENT) else Color.White)
        .border(1.dp, if (on) Color.Transparent else Color(0xFF767676), shape)) {
        if (on) Canvas(Modifier.size(18.dp)) {
            val p = Path().apply { moveTo(size.width * 0.22f, size.height * 0.52f); lineTo(size.width * 0.42f, size.height * 0.72f); lineTo(size.width * 0.78f, size.height * 0.3f) }
            drawPath(p, ink, style = Stroke(width = 2.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

/** What a passphrase field's text looks like, and how it is typed: 13, hidden, the phone's password keyboard. */
internal val PASS_STYLE = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
internal val PASS_KEYS = KeyboardOptions(keyboardType = KeyboardType.Password)
internal val PASS_HIDDEN = PasswordVisualTransformation()

/** A backup's card (.backup-item): 12 round in its edge, 10 and 12 in; where it is in 16/700, then when and the rest in 13 dim, then what it holds in 12.5 dim. */
@Composable
internal fun BackupCard(title: String, meta: String, parts: String, actions: @Composable () -> Unit, panel: (@Composable () -> Unit)?) {
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, Modifier.parity("settings-backup.item-title"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W700)
            Text(meta, Modifier.parity("settings-backup.item-meta"), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp)
            Text(parts, Modifier.parity("settings-backup.item-parts"), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 16.875.sp)
        }
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { actions() }
        panel?.let { RestorePanel(it) }
    }
}

/** A restore's panel (.backup-restore): 10 under a rule, 10 over it. */
@Composable
internal fun RestorePanel(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
        Column(Modifier.padding(top = 10.dp)) { content() }
    }
}
