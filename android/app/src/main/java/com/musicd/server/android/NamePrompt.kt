package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogWindowProvider
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette

/**
 * The page's name prompt, natively (docs/specs/screens.json, prompt; album-grid.js promptDialog; bug list item 93), drawn
 * as the page draws it (style.css .confirm-box, .prompt-input): the ConfirmDialog's box, [message] at 16px in the middle,
 * the name in a field 46 tall (its [initial] suggestion chosen, so typing replaces it; the brass edge while it is in
 * use), then Cancel and [word] (Save) as two 44s, the second in brass. Save, or the keyboard's Done, answers the name; Cancel
 * or a tap outside answers none.
 */
@Composable
internal fun NamePrompt(message: String, initial: String, word: String = "Save", onAnswer: (String?) -> Unit) {
    Dialog(onDismissRequest = { onAnswer(null) }) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect { window?.setDimAmount(0.55f) }
        var name by remember { mutableStateOf(TextFieldValue(initial, TextRange(0, initial.length))) }
        val focus = remember { FocusRequester() }
        val source = remember { MutableInteractionSource() }
        val focused by source.collectIsFocusedAsState()
        LaunchedEffect(Unit) { focus.requestFocus() }
        val box = RoundedCornerShape(18.dp)
        val corner = RoundedCornerShape(12.dp)
        Column(Modifier.width(340.dp).clip(box).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outline, box)
            .padding(start = 20.dp, top = 22.dp, end = 20.dp, bottom = 16.dp)) {
            Text(message, Modifier.parity("prompt.message").fillMaxWidth().padding(bottom = 18.dp), color = MaterialTheme.colorScheme.onSurface,
                fontSize = 16.sp, lineHeight = 22.4.sp, textAlign = TextAlign.Center)
            BasicTextField(name, { name = it }, Modifier.parity("prompt.field", Contract.label("prompt.field")).padding(bottom = 16.dp).fillMaxWidth().focusRequester(focus),
                singleLine = true, interactionSource = source, textStyle = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp),
                cursorBrush = SolidColor(paletteColor(Palette.ACCENT)),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onAnswer(name.text) }), decorationBox = { inner ->
                    Box(Modifier.fillMaxWidth().height(46.dp).clip(corner).background(paletteColor(Palette.BG_ELEV_2))
                        .border(1.dp, paletteColor(if (focused) Palette.ACCENT else Palette.BORDER), corner).padding(horizontal = 14.dp), contentAlignment = Alignment.CenterStart) { inner() }
                })
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.parity("prompt.cancel", Contract.label("prompt.cancel")).weight(1f).height(44.dp).clip(corner).background(paletteColor(Palette.BG_ELEV_2))
                    .border(1.dp, MaterialTheme.colorScheme.outline, corner).clickable { onAnswer(null) }, contentAlignment = Alignment.Center) {
                    Text(Contract.label("prompt.cancel"), color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600)
                }
                Box(Modifier.parity("prompt.save", Contract.label("prompt.save", 1, word)).weight(1f).height(44.dp).clip(corner).background(MaterialTheme.colorScheme.primary)
                    .clickable { onAnswer(name.text) }, contentAlignment = Alignment.Center) {
                    Text(word, color = MaterialTheme.colorScheme.onPrimary, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600)
                }
            }
        }
    }
}
