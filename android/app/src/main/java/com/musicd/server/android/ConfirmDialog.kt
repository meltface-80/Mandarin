package com.musicd.server.android

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.musicd.server.client.Contract

/**
 * The page's yes-or-no sheet, natively (docs/specs/screens.json, confirm):
 * the question, No and Yes. A tap outside is a No, as on the page.
 */
@Composable
internal fun ConfirmDialog(message: String, onAnswer: (Boolean) -> Unit) {
    AlertDialog(
        onDismissRequest = { onAnswer(false) },
        text = { Text(message, Modifier.parity("confirm.message"), style = MaterialTheme.typography.bodyLarge) },
        dismissButton = {
            TextButton(onClick = { onAnswer(false) }, modifier = Modifier.parity("confirm.no", Contract.label("confirm.no"))) {
                Text(Contract.label("confirm.no"))
            }
        },
        confirmButton = {
            TextButton(onClick = { onAnswer(true) }, modifier = Modifier.parity("confirm.yes", Contract.label("confirm.yes"))) {
                Text(Contract.label("confirm.yes"))
            }
        },
        containerColor = MaterialTheme.colorScheme.surface
    )
}
