package com.musicd.server.android

import android.app.Activity
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.musicd.server.client.Contract

/*
 * Settings → Setup → Logging (bug list item 121), under API Keys: the app's log, and the server's, for sending to the
 * developer when something is wrong. Always on (item 389), as the server's and the Bridges' are: there is no switch.
 * The user is told what it leaves out (item 235), and that it is theirs to look through before sending. Saved to
 * Downloads/Mandarin; the app sends its lines to the server now and then too, where Download all logs has them (AppLog).
 */

/** What the log leaves out. */
internal const val LOG_PRIVACY = "The log leaves out what is yours alone: no passwords, keys or tokens, no email addresses, no " +
    "account names or logins, no internet or Tailscale addresses. It keeps what helps find a fault: home-network addresses, " +
    "the names of rooms and devices, what was playing, error messages. Before you send it, " +
    "please look through it: what you send is your choice."

/** What it is, and what to do with it. */
internal const val LOG_ON = "Mandarin keeps a log always: this app's, the server's and every Mandarin Bridge's. When something " +
    "goes wrong, tap Save log: it is saved to Downloads/Mandarin on this phone, for you to send to the developer. This app's " +
    "lines are kept on your server too, beside the others. Nothing is sent anywhere else."

/** The Logging block of Setup's list. */
@Composable
internal fun LoggingBlock() {
    val context = LocalContext.current
    var about by remember { mutableStateOf(AppLog.about()) }
    SettingsDivider()
    Block {
        SetupRow("Logging", Modifier.parity("settings-setup.logging"), null) {}
        SetupNote(LOG_ON + "\n\n" + LOG_PRIVACY, Modifier.parity("settings-setup.logging-note"))
        SetupNote(about, Modifier.parity("settings-setup.log-about"))
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SetupButton(Contract.label("settings-setup.log-save"), busy = false, Modifier.parity("settings-setup.log-save", Contract.label("settings-setup.log-save")).clickable {
                val a = context as? Activity ?: return@clickable
                AppLog.save(a) { name ->
                    Toast.makeText(a, if (name != null) "Log saved to Downloads/Mandarin/$name" else "Couldn't save the log", Toast.LENGTH_LONG).show()
                    about = AppLog.about()
                }
            })
            SetupButton(Contract.label("settings-setup.log-clear"), busy = false, Modifier.parity("settings-setup.log-clear", Contract.label("settings-setup.log-clear")).clickable {
                AppLog.clear(context)
                about = "Cleared"
            })
        }
    }
}
