package com.musicd.server.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Choice
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SetupSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * Setup's small pages of Settings natively (the group T of docs/specs/plan-android-native.md, T2; bug list item 78),
 * as the page's (docs/specs/screens.json, settings-picks, -labels, -ui, -display and -shelf; style.css .settings-row,
 * .switch, .settings-select, .settings-range): each row a setting's name with its ⓘ and its switch, list or button; a
 * list opens as the WebView's did, the phone's own list of choices. What the server keeps is saved there at once; what
 * the page keeps on this device (UI Settings, a label's order and minimum) is handed to it and kept by the app too.
 */

/** One of Setup's pages the app draws here ([pane], the page's name for it). */
internal val SETUP_PANES = setOf("smartpicks", "labels", "ui", "display", "shelfset")

@Composable
internal fun SettingsSetupPane(pane: String, client: () -> ServerClient?, onBack: () -> Unit) {
    var info by remember { mutableStateOf<String?>(null) }
    // The help shown long enough to read: four seconds and a fifth of one a word, 25 at most, as the page's.
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    val showInfo = { t: String -> info = t }
    Box(Modifier.fillMaxSize()) {
        when (pane) {
            "smartpicks" -> PicksPane(client, onBack, showInfo)
            "labels" -> LabelsPane(client, onBack, showInfo)
            "ui" -> UiPane(onBack, showInfo)
            "display" -> DisplayPane(client, onBack, showInfo)
            else -> ShelfPane(client, onBack, showInfo)
        }
        info?.let { InfoTip(it, Modifier.parity("settings-picks.info settings-labels.info settings-ui.info settings-display.info settings-shelf.info")) }
    }
}

@Composable
private fun PicksPane(client: () -> ServerClient?, onBack: () -> Unit, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf(false) }
    var hour by remember { mutableStateOf(4) }
    var rebuilding by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { readSetting(client, "smart-picks")?.let { on = it.optBoolean("enabled"); hour = it.optInt("hour", hour) } }
    fun save(patch: JSONObject, said: String, undo: () -> Unit) = saveSetting(scope, context, client, "smart-picks", patch, said, undo)
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-picks.back", Contract.label("settings-picks.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Smart Picks", Modifier.parity("settings-picks.heading"))
        SettingsDesc("Daily discoveries & schedule", Modifier.parity("settings-picks.desc"))
        Block {
            SetupRow("Smart Picks", Modifier.parity("settings-picks.name"), Modifier.parity("settings-picks.info", Contract.label("settings-picks.info", 0, "Smart Picks")).clickable { info(PICKS_INFO) }) {
                Toggle(on, Modifier.parity("settings-picks.enabled", Contract.label("settings-picks.enabled")).clickable { val was = on; on = !on; save(JSONObject().put("enabled", on), SetupSettings.picksSaid(on)) { on = was } })
            }
            SetupNote("On by default. Everything below applies only while this is on.", Modifier.parity("settings-picks.note"))
        }
        Block {
            SetupRow("Build the day's picks at", Modifier.parity("settings-picks.name"), Modifier.parity("settings-picks.info", Contract.label("settings-picks.info", 0, "Build the day's picks at")).clickable { info(HOUR_INFO) }) {
                SelectBox(SetupSettings.HOURS[hour.coerceIn(0, 23)].words, SetupSettings.HOURS, null, Modifier.parity("settings-picks.hour", Contract.label("settings-picks.hour")).clickable {
                    pickChoice(context, SetupSettings.HOURS, hour.toString()) { v -> val was = hour; hour = v.toInt(); save(JSONObject().put("hour", hour), SetupSettings.hourSaid(hour)) { hour = was } }
                })
            }
            SetupNote("Reads your library and play history on this server; only the related-artist lookups leave your network.", Modifier.parity("settings-picks.note"))
        }
        Block {
            SetupRow("Rebuild today's picks now", Modifier.parity("settings-picks.name"), null) {
                SetupButton(if (rebuilding) "…" else "Rebuild", rebuilding, Modifier.parity("settings-picks.rebuild", Contract.label("settings-picks.rebuild")).clickable(enabled = !rebuilding) {
                    val c = client() ?: return@clickable
                    rebuilding = true
                    scope.launch {
                        val r = withContext(Dispatchers.IO) { runCatching { c.rebuildPicks() } }
                        rebuilding = false
                        setupToast(context, r.fold({ "Rebuilding today's picks — check back in a minute" }, { "Couldn't rebuild: " + (it.message ?: "no answer") }))
                    }
                })
            }
            SetupNote("Discards today's set and chooses five again. Takes a minute or two.", Modifier.parity("settings-picks.note"))
        }
    }
}

@Composable
private fun LabelsPane(client: () -> ServerClient?, onBack: () -> Unit, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("Off by default. Everything below applies only while this is on.") }
    var prefs by remember { mutableStateOf(pagePrefs(context)) }
    var rescan by remember { mutableStateOf("Force rescan") }
    var rescanSaid by remember { mutableStateOf<String?>(null) }
    var depth by remember { mutableStateOf("") }
    var depthStatus by remember { mutableStateOf("") }
    var savingDepth by remember { mutableStateOf(false) }
    suspend fun reload() {
        readSetting(client, "labels")?.let { on = it.optBoolean("enabled"); note = SetupSettings.labelsNote(it) }
        readSetting(client, "label-folder-depth")?.let { val d = it.optInt("depth"); depth = d.toString(); depthStatus = SetupSettings.depthStatus(d) }
    }
    LaunchedEffect(Unit) { reload() }
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-labels.back", Contract.label("settings-labels.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Record labels", Modifier.parity("settings-labels.heading"))
        SettingsDesc("From your files' tags: on or off, ordering, folders", Modifier.parity("settings-labels.desc"))
        Block {
            SetupRow("Record labels", Modifier.parity("settings-labels.name"), Modifier.parity("settings-labels.info", Contract.label("settings-labels.info", 0, "Record labels")).clickable { info(LABELS_INFO[0]) }) {
                Toggle(on, Modifier.parity("settings-labels.enabled", Contract.label("settings-labels.enabled")).clickable {
                    val was = on; on = !on
                    saveSetting(scope, context, client, "labels", JSONObject().put("enabled", on), if (on) "Labels on" else "Labels off", undo = { on = was }) { scope.launch { reload() } }
                })
            }
            SetupNote(note, Modifier.parity("settings-labels.note"))
        }
        Block {
            SetupRow("Label album order", Modifier.parity("settings-labels.name"), Modifier.parity("settings-labels.info", Contract.label("settings-labels.info", 0, "Label album order")).clickable { info(LABELS_INFO[1]) }) {
                SelectBox(choiceWords(SetupSettings.LABEL_ORDER, prefs.labelOrder), SetupSettings.LABEL_ORDER, Modifier.parity("settings-labels.caret"),
                    Modifier.parity("settings-labels.order", Contract.label("settings-labels.order")).clickable {
                        pickChoice(context, SetupSettings.LABEL_ORDER, prefs.labelOrder) { v -> prefs = setPagePref(context, "labelOrder", v) }
                    })
            }
        }
        Block {
            SetupRow("Minimum albums per label", Modifier.parity("settings-labels.name"), Modifier.parity("settings-labels.info", Contract.label("settings-labels.info", 0, "Minimum albums per label")).clickable { info(LABELS_INFO[2]) }) {
                SelectBox(choiceWords(SetupSettings.LABEL_MIN, prefs.labelMin.toString()), SetupSettings.LABEL_MIN, Modifier.parity("settings-labels.caret"),
                    Modifier.parity("settings-labels.min", Contract.label("settings-labels.min")).clickable {
                        pickChoice(context, SetupSettings.LABEL_MIN, prefs.labelMin.toString()) { v -> prefs = setPagePref(context, "labelMin", v) }
                    })
            }
        }
        SettingsDivider()
        Block {
            SetupRow("Label data", Modifier.parity("settings-labels.name"), Modifier.parity("settings-labels.info", Contract.label("settings-labels.info", 0, "Label data")).clickable { info(LABELS_INFO[3]) }) {
                SetupButton(rescan, rescan != "Force rescan", Modifier.parity("settings-labels.rescan", Contract.label("settings-labels.rescan")).clickable(enabled = rescan == "Force rescan") {
                    val c = client() ?: return@clickable
                    rescan = "Starting…"; rescanSaid = null
                    scope.launch {
                        val r = withContext(Dispatchers.IO) { runCatching { c.rescanLabelsNow() } }
                        r.onSuccess { rescan = SetupSettings.rescanWord(it); rescanSaid = SetupSettings.rescanSaid(it); delay(5000); rescan = "Force rescan" }
                            .onFailure { rescan = "Force rescan"; rescanSaid = "Error: " + (it.message ?: "no answer") }
                    }
                })
            }
            rescanSaid?.let { Text(it, Modifier.parity("settings-labels.rescan-status").padding(top = 10.dp, bottom = 4.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.sp, lineHeight = 18.sp) }
        }
        SettingsDivider()
        Block {
            SetupRow("Label from folder depth", Modifier.parity("settings-labels.name"), Modifier.parity("settings-labels.info", Contract.label("settings-labels.info", 0, "Label from folder depth")).clickable { info(LABELS_INFO[4]) }) {}
            Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val shape = RoundedCornerShape(8.dp)
                BasicTextField(depth, { depth = it.filter(Char::isDigit).take(1) }, Modifier.parity("settings-labels.depth", Contract.label("settings-labels.depth")).weight(1f), singleLine = true,
                    textStyle = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 18.sp), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), decorationBox = { field ->
                        Box(Modifier.fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 10.dp, vertical = 7.dp)) {
                            if (depth.isEmpty()) Text("0 = off (use file tag)", color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
                            field()
                        }
                    })
                SetupButton("Save", savingDepth, Modifier.parity("settings-labels.depth-save", Contract.label("settings-labels.depth-save")).clickable(enabled = !savingDepth) {
                    val c = client() ?: return@clickable
                    savingDepth = true
                    scope.launch {
                        val r = withContext(Dispatchers.IO) { runCatching { c.saveSetting("label-folder-depth", JSONObject().put("depth", depth.toIntOrNull() ?: 0)) } }
                        savingDepth = false
                        r.onSuccess { j -> setupToast(context, if (!j.optBoolean("ok")) j.optString("error").ifEmpty { "Failed to save" } else if (j.optBoolean("rescanning")) "Saved — re-scanning labels…" else "Saved"); reload() }
                            .onFailure { setupToast(context, "Failed: " + (it.message ?: "no answer")) }
                    }
                })
            }
            Text(depthStatus, Modifier.parity("settings-labels.depth-status").padding(top = 4.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 11.sp, lineHeight = 15.sp)
        }
    }
}

@Composable
private fun UiPane(onBack: () -> Unit, info: (String) -> Unit) {
    val context = LocalContext.current
    var prefs by remember { mutableStateOf(pagePrefs(context)) }
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-ui.back", Contract.label("settings-ui.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "UI Settings", Modifier.parity("settings-ui.heading"))
        SettingsDesc("Text size, layout & tile size", Modifier.parity("settings-ui.desc"))
        for ((i, key) in listOf("text", "title", "menu", "layout", "tile").withIndex()) {
            val choices = when (key) { "layout" -> SetupSettings.LAYOUT; "tile" -> SetupSettings.TILE; else -> SetupSettings.TEXT }
            val value = SetupSettings.uiValue(prefs, key)
            Block {
                SetupRow(UI_NAMES[i], Modifier.parity("settings-ui.name"), Modifier.parity("settings-ui.info", Contract.label("settings-ui.info", 0, UI_NAMES[i])).clickable { info(UI_INFO[i]) }) {
                    SelectBox(choiceWords(choices, value), choices, Modifier.parity("settings-ui.caret"),
                        Modifier.parity("settings-ui.text settings-ui.title settings-ui.menu settings-ui.layout settings-ui.tile", Contract.label("settings-ui.text")).clickable {
                            pickChoice(context, choices, value) { v -> prefs = setPagePref(context, key, v) }
                        }, width = 142.5.dp)
                }
            }
        }
        SetupNote("Saved on this device only. On a desktop the text sizes go to +75% and +100%.", Modifier.parity("settings-ui.note").padding(bottom = 12.dp))
    }
}

@Composable
private fun DisplayPane(client: () -> ServerClient?, onBack: () -> Unit, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf(false) }
    var seconds by remember { mutableStateOf(10) }
    LaunchedEffect(Unit) { readSetting(client, "display")?.let { on = it.optBoolean("enabled"); seconds = it.optInt("seconds", seconds) } }
    fun save() = saveSetting(scope, context, client, "display", JSONObject().put("enabled", on).put("seconds", seconds), null, undo = {}) { j ->
        if (!j.optBoolean("ok")) setupToast(context, "Display settings didn't persist — check the data volume")
    }
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-display.back", Contract.label("settings-display.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Wall Display", Modifier.parity("settings-display.heading"))
        SettingsDesc("Always-on screen & video", Modifier.parity("settings-display.desc"))
        Block {
            SetupRow("Wall display", Modifier.parity("settings-display.name"), Modifier.parity("settings-display.info", Contract.label("settings-display.info", 0, "Wall display")).clickable { info(DISPLAY_INFO) }) {
                Toggle(on, Modifier.parity("settings-display.enabled", Contract.label("settings-display.enabled")).clickable { on = !on; save() })
            }
            SetupRow("Rotate every ${seconds}s", Modifier.parity("settings-display.name"), null) {
                // The page's range (.settings-range): 5 to 60 seconds, 180 at most; the value beside it as it moves, saved once let go.
                val frac = (seconds - 5) / 55f
                RangeTrack(frac, Modifier.parity("settings-display.seconds", Contract.label("settings-display.seconds")).width(180.dp).height(22.dp).pointerInput(Unit) {
                    fun at(x: Float) { seconds = (5 + Math.round((x / size.width).coerceIn(0f, 1f) * 55)).toInt() }
                    detectTapGestures { at(it.x); save() }
                }.pointerInput(Unit) {
                    fun at(x: Float) { seconds = (5 + Math.round((x / size.width).coerceIn(0f, 1f) * 55)).toInt() }
                    detectHorizontalDragGestures(onDragEnd = { save() }) { change, _ -> at(change.position.x) }
                })
            }
        }
    }
}

@Composable
private fun ShelfPane(client: () -> ServerClient?, onBack: () -> Unit, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { readSetting(client, "shelf")?.let { on = it.optBoolean("enabled") } }
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-shelf.back", Contract.label("settings-shelf.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Shelf", Modifier.parity("settings-shelf.heading"))
        SettingsDesc("Flicking through your collection", Modifier.parity("settings-shelf.desc"))
        Block {
            SetupRow("Shelf", Modifier.parity("settings-shelf.name"), Modifier.parity("settings-shelf.info", Contract.label("settings-shelf.info", 0, "Shelf")).clickable { info(SHELF_INFO) }) {
                Toggle(on, Modifier.parity("settings-shelf.enabled", Contract.label("settings-shelf.enabled")).clickable {
                    val was = on; on = !on
                    saveSetting(scope, context, client, "shelf", JSONObject().put("enabled", on), null, undo = { on = was }, failed = "Couldn't change Shelf: ") { j -> on = j.optBoolean("enabled", on) }
                })
            }
        }
    }
}

/** A block of rows (.settings-block): 4 over and under. */
@Composable
private fun Block(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { content() }
}

/** A setting's row (.settings-row): its name in 16 (and its ⓘ, [info]: its key and tap) on the left, [control] on the right, 16 apart. */
@Composable
private fun SetupRow(name: String, nameMod: Modifier, info: Modifier?, control: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(Modifier.weight(1f).heightIn(min = if (info != null) 32.dp else 22.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(name, nameMod.weight(1f, fill = false), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
            if (info != null) Box(info.size(32.dp).padding(start = 4.dp), contentAlignment = Alignment.Center) {
                Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 16.sp)
            }
        }
        control()
    }
}

/** A note under a setting (.settings-note): 12 faint in 1.45, 6 over it. */
@Composable
private fun SetupNote(text: String, modifier: Modifier) {
    Text(text, modifier.padding(top = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
}

/** A switch (.switch): 46 by 28, its 22 thumb dim on the raised ground, or white on the accent once on. */
@Composable
private fun Toggle(on: Boolean, modifier: Modifier) {
    Box(modifier.size(46.dp, 28.dp).clip(CircleShape).background(paletteColor(if (on) Palette.ACCENT else Palette.BG_ELEV_2))
        .border(1.dp, if (on) Color.Transparent else paletteColor(Palette.BORDER), CircleShape).padding(horizontal = 3.dp), contentAlignment = Alignment.CenterStart) {
        Box(Modifier.offset(x = if (on) 18.dp else 0.dp).size(22.dp).background(if (on) Color.White else paletteColor(Palette.TEXT_DIM), CircleShape))
    }
}

/**
 * A list (.settings-select): its choice in 15 on the raised ground, 12 round, 9 and 16 in (34 at the right, where its
 * caret is: [caret], its key, or none), as wide as its longest choice and 110 at least, or [width].
 */
@Composable
private fun SelectBox(words: String, choices: List<Choice>, caret: Modifier?, modifier: Modifier, width: Dp? = null) {
    val measurer = rememberTextMeasurer()
    val style = TextStyle(fontSize = 15.sp, lineHeight = 19.sp)
    val longest = choices.maxOfOrNull { measurer.measure(it.words, style).size.width } ?: 0
    val w = width ?: with(androidx.compose.ui.platform.LocalDensity.current) { maxOf(110.dp, longest.toDp() + 50.dp) }
    val shape = RoundedCornerShape(12.dp)
    Box(modifier.width(w).height(37.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape), contentAlignment = Alignment.CenterStart) {
        Text(words, Modifier.padding(start = 16.dp, end = 34.dp), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 19.sp, maxLines = 1)
        if (caret != null) Icon(painterResource(R.drawable.st_caret), contentDescription = null, tint = paletteColor(Palette.TEXT_DIM),
            modifier = caret.align(Alignment.CenterEnd).padding(end = 12.dp).size(16.dp))
    }
}

/** A button of a setting's (.settings-update-btn): 36 tall, 14 in, 8 round, 13 dim; dim while it works. */
@Composable
private fun SetupButton(words: String, busy: Boolean, modifier: Modifier) {
    val shape = RoundedCornerShape(8.dp)
    Box(modifier.heightIn(min = 36.dp).alpha(if (busy) 0.6f else 1f).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape)
        .padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
        Text(words, color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
    }
}

/** The range's track (the page's in the accent): the part chosen in the accent, the rest light, the 16 thumb at [frac]. */
@Composable
private fun RangeTrack(frac: Float, modifier: Modifier) {
    val accent = paletteColor(Palette.ACCENT)
    Canvas(modifier) {
        val r = 8.dp.toPx(); val h = 4.dp.toPx(); val y = size.height / 2
        val x = r + (size.width - 2 * r) * frac.coerceIn(0f, 1f)
        drawRoundRect(Color(0xFFEFEFEF), Offset(0f, y - h / 2), Size(size.width, h), CornerRadius(h / 2))
        drawRoundRect(accent, Offset(0f, y - h / 2), Size(x, h), CornerRadius(h / 2))
        drawCircle(accent, r, Offset(x, y))
    }
}

/** The ⓘ's help (.settings-info-toast): along the foot, over the page, until it has been read. */
@Composable
private fun BoxScope.InfoTip(text: String, modifier: Modifier) {
    val box = RoundedCornerShape(12.dp)
    Box(modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 88.dp).widthIn(max = minOf(400, (LocalConfiguration.current.screenWidthDp * 0.92f).toInt()).dp)
        .clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), box).padding(horizontal = 18.dp, vertical = 12.dp)) {
        Text(text, color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 21.sp)
    }
}
