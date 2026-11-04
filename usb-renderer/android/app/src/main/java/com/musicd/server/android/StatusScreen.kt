package com.musicd.server.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.musicd.server.client.UsbView

/*
 * The screen once the device is signed in: the player and the server, the
 * DAC as Mandarin's page shows it (Settings → Audio Devices → this phone →
 * USB DAC, through core's UsbView), the USB settings the driver has, and
 * what keeps the device awake.
 */
@Composable
internal fun StatusScreen(activity: MainActivity, s: MainActivity.Snapshot, crash: String?, again: () -> Unit) {
    val u = s.usb
    var crashShown by remember { mutableStateOf(crash != null) }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 24.dp)) {
        Text("Mandarin USB", style = MaterialTheme.typography.headlineMedium)
        Text(s.statusLine, Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary)
        if (s.title != null) {
            Text(s.title, Modifier.padding(top = 12.dp), style = MaterialTheme.typography.titleMedium)
            Text(listOfNotNull(s.artist, s.album).joinToString(" — "), style = MaterialTheme.typography.bodyMedium)
        }
        if (crashShown && crash != null) {
            Note("The app stopped last time:\n" + crash.take(600), danger = true)
            Row { TextButton({ copy(activity, "Mandarin USB crash", crash) }) { Text("Copy details") }; TextButton({ crashShown = false }) { Text("Close") } }
        }

        Section("Renderer")
        Line("Mandarin finds it on the network by itself: Settings → Audio Devices lists “${Store.friendlyName(activity)}”. Switch it on there, pick it as the speaker, and play.")
        Line(s.address?.let { "At $it (UPnP MediaRenderer). The DAC’s capabilities, as read: $it/dac.json" } ?: "No network address yet.")
        s.lastSearch?.let { (who, at) -> Line("Description last read by $who, ${ago(at)}.") }
        s.lastControl?.let { (who, at) -> Line("Last command from $who, ${ago(at)}." + (if (s.subscribers > 0) " Events go to ${s.subscribers} subscriber" + (if (s.subscribers == 1) "" else "s") + "." else "")) }
        var name by remember { mutableStateOf(Store.friendlyName(activity)) }
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text("Name on the network") }, singleLine = true)
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton({ Store.setFriendlyName(activity, name); DacService.stop(activity); DacService.start(activity); again() }, enabled = name.isNotBlank() && name.trim() != Store.friendlyName(activity)) { Text("Rename") }
            OutlinedButton({ DacService.stop(activity); DacService.start(activity); again() }) { Text("Restart renderer") }
        }

        Section("USB DAC")
        if (!u.attached) Note(UsbView.NOTHING)
        else {
            Line(u.name, strong = true)
            if (u.devices.size > 1) {
                // More than one USB audio device (a FiiO R7's own DAC is one): the one to play through, the driver's own choice marked.
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (c in u.devices) FilterChip(u.chosenDevice == c.value, { Store.setUsbDevice(activity, c.value); UsbDriver.close(); UsbDac.refresh(activity); again() }, { Text(c.words) })
                }
                Note("Which USB audio device to play through. The DAC plugged into the port is chosen by itself over the device’s own; tap the other to change.")
            }
            if (!u.permission) {
                Note(UsbView.ASK)
                u.error?.let { Note(it, danger = true) }
                Button({ UsbDac.requestPermission(activity) }, Modifier.padding(top = 4.dp)) { Text("Allow") }
            } else if (!u.hasInfo) Note(u.error ?: UsbView.READING, danger = u.error != null)
            else {
                Cap("Class", u.classLine)
                Cap("Sample rates (kHz)", if (u.rates.isEmpty()) "not stated" else u.rates.joinToString(", ") { com.musicd.server.client.DevicePage.rateWord(it) })
                Cap("Bit depth", if (u.bits.isEmpty()) "not stated" else u.bits.joinToString(", ") { "$it-bit" })
                Cap("DSD", u.dsdLine)
                Cap("Volume", u.volumeLine)
                u.clock?.let { Cap("Clock now", it) }
                u.streaming?.let { Cap("Streaming now", it) }
                u.streamError?.let { Note(it, danger = true) }

                Spacer(Modifier.height(8.dp))
                ToggleRow("Fixed volume", u.fixed) { Store.setUsbFixed(activity, it); UsbDriver.settingsChanged(); evented(); again() }
                Note(u.fixedNote)
                if (!u.fixed) {
                    var limit by remember(u.limit) { mutableFloatStateOf(u.limit.toFloat()) }
                    Line("Volume limit ${limit.toInt()}% · volume now ${s.volume}%")
                    Slider(limit, { limit = (Math.round(it / 5f) * 5).toFloat() }, Modifier.fillMaxWidth(), valueRange = 10f..100f, steps = 17,
                        onValueChangeFinished = { Store.setUsbLimit(activity, limit.toInt()); UsbDriver.settingsChanged(); evented(); again() })
                    Note(UsbView.LIMIT_NOTE + " The volume itself is set from Mandarin, or with this device's volume buttons while the app is in front.")
                }
                if (u.showDsd) {
                    Line("DSD", strong = true)
                    Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (c in u.dsdChoices) FilterChip(u.dsdMode == c.value, { Store.setUsbDsd(activity, c.value); DacService.current?.let { d -> d.main.post { d.usbChanged() } }; again() }, { Text(c.words) })
                    }
                    s.caps?.let { c -> Note("Advertised to Mandarin: " + c.rates.joinToString(", ") { com.musicd.server.client.DevicePage.rateWord(it) } + " kHz · " + c.bits.joinToString(", ") { "$it-bit" } +
                        (if (c.dsd.isNotEmpty()) " · DSD" + c.dsd.joinToString(", DSD") else " · no DSD")) }
                    Note(u.dsdNote)
                }
                Row(Modifier.padding(top = 8.dp)) {
                    OutlinedButton({ copy(activity, "Mandarin USB DAC", UsbDac.diagnostics(activity)) }) { Text("Copy diagnostics") }
                }
                Note(UsbView.DIAGNOSTICS_NOTE)
            }
            u.error?.takeIf { u.permission }?.let { Note(it, danger = true) }
        }

        Section("Keep awake")
        Line(if (s.awake) "The device is held awake: the CPU and Wi-Fi never doze while the renderer runs." else "The renderer isn't running, so nothing holds the device awake.")
        ToggleRow("Keep the screen on while this app is in front", Store.keepScreenOn(activity)) { Store.setKeepScreenOn(activity, it); activity.keepScreen(it); again() }
        ToggleRow("Start the renderer when the device starts", Store.startOnBoot(activity)) { Store.setStartOnBoot(activity, it); again() }
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (s.batteryExempt) "Battery optimisation is off for this app." else "Battery optimisation is on: Android may still stop the renderer after hours idle.", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            if (!s.batteryExempt) TextButton({ activity.askBatteryExemption() }) { Text("Turn off") }
        }
        Note("On a FiiO R7 also set Settings → Display → Screen timeout as you like it: the screen may go off, the device stays awake.")
        Spacer(Modifier.height(24.dp))
        // Which Mandarin the driver came from: its version and the commit, packed into the APK by app/build.gradle.kts.
        Text("Mandarin USB ${BuildConfig.VERSION_NAME} · driver from Mandarin ${BuildConfig.MANDARIN_VERSION}", style = MaterialTheme.typography.bodySmall)
    }
}

/** "just now", "3 min ago", "2 h ago". */
private fun ago(at: Long): String {
    val s = (System.currentTimeMillis() - at) / 1000
    return when { s < 5 -> "just now"; s < 60 -> "$s s ago"; s < 3600 -> "${s / 60} min ago"; else -> "${s / 3600} h ago" }
}

/** A USB setting changed: the renderer's volume variables evented. */
private fun evented() { DacService.current?.let { d -> d.main.post { if (d.ready) d.renderer.evented() } } }

@Composable private fun Section(title: String) {
    HorizontalDivider(Modifier.padding(top = 20.dp, bottom = 12.dp))
    Text(title, style = MaterialTheme.typography.titleLarge)
}

@Composable private fun Line(text: String, strong: Boolean = false) {
    Text(text, Modifier.padding(top = 6.dp), style = if (strong) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium)
}

@Composable private fun Note(text: String, danger: Boolean = false) {
    Text(text, Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodySmall,
        color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
}

@Composable private fun Cap(label: String, value: String) {
    Text(label, Modifier.padding(top = 10.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
    Text(value, style = MaterialTheme.typography.bodyMedium)
}

@Composable private fun ToggleRow(label: String, on: Boolean, set: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(on, set)
    }
}

private fun copy(c: Context, label: String, text: String) {
    runCatching { (c.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, text)) }
        .fold({ Toast.makeText(c, "Copied", Toast.LENGTH_SHORT).show() }, { Toast.makeText(c, "Couldn't copy: ${it.message}", Toast.LENGTH_SHORT).show() })
}
