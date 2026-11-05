package com.musicd.server.android

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.DevicePage
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Room correction (items 252, 258), as the page's: the impulse responses loaded for this renderer or sound device, one
 * a rate (each its name, facts and Remove), or a word on what one is; WAVs or a zip picked on the phone and sent to the
 * server as they are. The server answers with the device, handed to [onDevice].
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun RoomCorrection(d: DevicePage, client: () -> ServerClient?, busy: Boolean, onDevice: (JSONObject) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }
    fun send(call: (ServerClient) -> JSONObject, said: String) {
        val c = client() ?: return
        working = true
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { call(c) } }
                .onSuccess { onDevice(it); setupToast(context, said) }
                .onFailure { setupToast(context, com.musicd.server.client.Failure.said(it, "Couldn't reach the server")) }
            working = false
        }
    }
    // Several at once (item 258): WAVs, or a zip of them, sent one after another.
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val files = uris.map { uri ->
            val bytes = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
            val name = runCatching { context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } }.getOrNull()
            (name ?: "Impulse response") to bytes
        }
        if (files.any { it.second == null }) { setupToast(context, "Couldn't read that file."); return@rememberLauncherForActivityResult }
        send({ c -> files.map { (name, bytes) -> c.loadImpulse(d.id, name, bytes!!) }.last() }, "Room correction loaded")
    }
    CapGroup("Room correction", Modifier.parity("settings-device.cap-label")) {
        val rows = d.irRows
        val box = RoundedCornerShape(10.dp)
        rows.forEach { row ->
            Column(Modifier.padding(top = 8.dp).fillMaxWidth().clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), box).padding(horizontal = 12.dp, vertical = 10.dp)) {
                Text(row.name, Modifier.parity("settings-device.ir-name"), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600)
                Text(row.meta, Modifier.parity("settings-device.ir-meta").padding(top = 2.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 17.sp)
                SetupButton("Remove", false, Modifier.padding(top = 8.dp).parity("settings-device.ir-remove", Contract.label("settings-device.ir-remove"))
                    .clickable(enabled = !busy && !working) { send({ it.removeImpulse(d.id, row.rate) }, "Room correction removed") })
            }
        }
        DeviceNote(if (rows.isNotEmpty()) DevicePage.IR_SET_NOTE else DevicePage.IR_NONE, Modifier.parity("settings-device.note"))
        FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SetupButton(d.irLoad, false, Modifier.parity("settings-device.ir-load", Contract.label("settings-device.ir-load", if (rows.isNotEmpty()) 1 else 0))
                .clickable(enabled = !busy && !working) { pick.launch("*/*") })
        }
    }
}
