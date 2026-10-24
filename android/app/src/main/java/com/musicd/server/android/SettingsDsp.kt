package com.musicd.server.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.DevicePage
import com.musicd.server.client.DspCurve
import com.musicd.server.client.DspDraft
import com.musicd.server.client.EqBand
import com.musicd.server.client.HeadphoneProfile
import com.musicd.server.client.HeadphoneResult
import com.musicd.server.client.Palette
import com.musicd.server.client.SegChoice
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder

/*
 * A device's DSP natively (T6; bug list item 89), as the page's (audio-devices-page.js renderDsp, audio-devices-dsp.js
 * renderHeadphones and drawDsp; style.css .dsp-*, .hp-*): the switch, a headphone profile (AutoEq's, found by its name, or
 * one pasted), the bands' curve over 20 Hz–20 kHz with the headroom's dashed under it, a row a band (its type, Hz, dB, Q),
 * Add band, the headroom Auto or set, Save. Edits stay in the draft until Save; the switch saves at once, the draft with it.
 */

private data class HpUi(val mode: String, val q: String = "", val results: List<HeadphoneResult> = emptyList(), val busy: Boolean = false,
                        val error: String? = null, val name: String = "", val text: String = "")

/** The DSP block of [d]'s page; [onPatch] saves (the body, what to say once saved). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DspBlock(d: DevicePage, client: () -> ServerClient?, busy: Boolean, info: (String) -> Unit, onPatch: (JSONObject, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var draft by remember(d.id) { mutableStateOf(DspDraft.from(d.dsp)) }
    var ui by remember(d.id) { mutableStateOf<HpUi?>(null) }
    // The server's setting taken again once saved (a draft being edited is kept).
    LaunchedEffect(d.dsp.toString()) { if (!draft.dirty) draft = DspDraft.from(d.dsp) }
    val phone = d.kind == "phone"
    fun save(on: Boolean) { onPatch(JSONObject().put("dsp", draft.setting(on)), DspDraft.saved(on, phone)); draft = draft.copy(dirty = false) }
    fun ask(path: String, post: JSONObject? = null, done: (JSONObject) -> Unit, failed: (String) -> Unit) {
        val c = client() ?: return
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { if (post != null) c.post(path, post) else c.getJson(path) } }.onSuccess(done).onFailure { failed(com.musicd.server.client.Failure.said(it, "Couldn't reach the server")) }
        }
    }
    // AutoEq asked a quarter of a second after the name stops changing, as the page's.
    LaunchedEffect(ui?.q) {
        val u = ui ?: return@LaunchedEffect
        if (u.mode != "search") return@LaunchedEffect
        val q = u.q.trim()
        if (q.length < 2) { ui = u.copy(results = emptyList(), busy = false); return@LaunchedEffect }
        delay(250)
        ui = u.copy(busy = true)
        ask("/api/dsp/headphones?q=" + URLEncoder.encode(q, "UTF-8"), done = { j -> if (ui?.q?.trim() == q) ui = ui?.copy(results = DspDraft.results(j), busy = false, error = null) },
            failed = { e -> ui = ui?.copy(busy = false, error = e) })
    }
    SettingsDivider(18, 18)
    Block {
        NameRow("DSP", Modifier.parity("settings-device.name"), Modifier.parity("settings-device.info", Contract.label("settings-device.info", 0, "DSP")).clickable { info(d.dspInfo) }) {
            Toggle(d.dspOn, Modifier.parity("settings-device.dsp", Contract.label("settings-device.dsp")).clickable(enabled = !busy) { save(!d.dspOn) })
        }
        DeviceNote(d.dspNote, Modifier.parity("settings-device.note"))
        CapGroup("Headphones", Modifier.parity("settings-device.cap-label")) {
            val hp = draft.headphone
            val u = ui
            if (hp != null) {
                val box = RoundedCornerShape(10.dp)
                Column(Modifier.padding(top = 8.dp).fillMaxWidth().clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), box).padding(horizontal = 12.dp, vertical = 10.dp)) {
                    Text(hp.name, Modifier.parity("settings-device.hp-name"), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600)
                    Text(hp.sub, Modifier.parity("settings-device.hp-sub").padding(top = 2.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 17.sp)
                }
            } else if (u == null) DeviceNote(DspDraft.NONE, Modifier.parity("settings-device.note"))
            when (u?.mode) {
                null -> FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SetupButton(if (hp != null) "Change…" else "Choose from AutoEq…", false,
                        Modifier.parity("settings-device.hp-choose", Contract.label("settings-device.hp-choose", if (hp != null) 1 else 0)).clickable { ui = HpUi("search") })
                    SetupButton("Paste a profile…", false, Modifier.parity("settings-device.hp-paste", Contract.label("settings-device.hp-paste")).clickable { ui = HpUi("paste") })
                    if (hp != null) SetupButton("Remove", false, Modifier.parity("settings-device.hp-remove", Contract.label("settings-device.hp-remove")).clickable { draft = draft.copy(headphone = null, dirty = true) })
                }
                "search" -> Column(Modifier.padding(top = 8.dp)) {
                    BasicTextField(u.q, { ui = ui?.copy(q = it) }, Modifier.parity("settings-device.hp-search", Contract.label("settings-device.hp-search")).fillMaxWidth(), singleLine = true,
                        textStyle = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)),
                        decorationBox = { inner -> InputBox(u.q.isEmpty(), DspDraft.SEARCH_HINT, inner) })
                    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        val said = DspDraft.resultsNote(u.q, u.busy, u.error, u.results.size)
                        if (said != null) DeviceNote(said, Modifier.parity("settings-device.note"), danger = u.error != null)
                        else for (r in u.results) ResultRow(r, Modifier.parity("settings-device.hp-result", Contract.label("settings-device.hp-result", 0, r.name)).clickable {
                            ui = u.copy(busy = true)
                            ask("/api/dsp/headphones/profile?id=" + URLEncoder.encode(r.id, "UTF-8"), done = { j ->
                                val p = HeadphoneProfile(j.optJSONObject("profile") ?: JSONObject())
                                draft = draft.copy(headphone = p, dirty = true); ui = null; setupToast(context, p.name + " — Save to use it")
                            }, failed = { e -> ui = ui?.copy(busy = false, error = e) })
                        })
                    }
                    Box(Modifier.padding(top = 10.dp)) { SetupButton("Cancel", false, Modifier.parity("settings-device.hp-cancel", Contract.label("settings-device.hp-cancel")).clickable { ui = null }) }
                }
                else -> Column(Modifier.padding(top = 8.dp)) {
                    BasicTextField(u.name, { if (it.length <= 120) ui = ui?.copy(name = it) }, Modifier.parity("settings-device.hp-label", Contract.label("settings-device.hp-label")).fillMaxWidth(), singleLine = true,
                        textStyle = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)),
                        decorationBox = { inner -> InputBox(u.name.isEmpty(), "A name for it", inner) })
                    val shape = RoundedCornerShape(10.dp)
                    BasicTextField(u.text, { ui = ui?.copy(text = it) }, Modifier.parity("settings-device.hp-text", Contract.label("settings-device.hp-text")).padding(top = 8.dp).fillMaxWidth(),
                        textStyle = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 12.5.sp, lineHeight = 17.5.sp, fontFamily = FontFamily.Monospace), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)),
                        decorationBox = { inner -> Box(Modifier.fillMaxWidth().heightIn(min = 127.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape)
                            .padding(horizontal = 12.dp, vertical = 10.dp)) {
                            if (u.text.isEmpty()) Text(DspDraft.PASTE_HINT, color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.5.sp, lineHeight = 17.5.sp, fontFamily = FontFamily.Monospace)
                            inner()
                        } })
                    u.error?.let { DeviceNote(it, Modifier.parity("settings-device.note"), danger = true) }
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PrimaryButton("Use it", true, Modifier.parity("settings-device.hp-use", Contract.label("settings-device.hp-use")).clickable {
                            ask("/api/dsp/headphones/parse", JSONObject().put("name", u.name).put("text", u.text), done = { j ->
                                draft = draft.copy(headphone = HeadphoneProfile(j.optJSONObject("profile") ?: JSONObject()), dirty = true); ui = null
                            }, failed = { e -> ui = ui?.copy(error = e) })
                        })
                        SetupButton("Cancel", false, Modifier.parity("settings-device.hp-cancel", Contract.label("settings-device.hp-cancel")).clickable { ui = null })
                    }
                }
            }
        }
        CapGroup("Parametric EQ · ${draft.bands.size} of 10 bands", Modifier.parity("settings-device.cap-label")) {
            DspCurveView(draft.curve(), Modifier.parity("settings-device.curve").padding(top = 10.dp).fillMaxWidth().height(150.dp))
            if (draft.bands.isEmpty()) DeviceNote(DspDraft.NO_BANDS, Modifier.parity("settings-device.note"))
            Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((i, b) in draft.bands.withIndex()) BandRow(b, { draft = draft.with(i, it) }) { draft = draft.removed(i) }
            }
            if (draft.bands.size < 10) Box(Modifier.padding(top = 10.dp)) {
                SetupButton("Add band", false, Modifier.parity("settings-device.band-add", Contract.label("settings-device.band-add")).clickable { draft = draft.added() })
            }
        }
        CapGroup("Headroom", Modifier.parity("settings-device.cap-label")) {
            val manual = draft.headroom != null
            Seg(listOf(SegChoice("auto", "Auto"), SegChoice("set", "Set")), if (manual) "set" else "auto",
                key = { i, c -> Modifier.parity("settings-device.headroom", Contract.label("settings-device.headroom", i)).clickable { draft = draft.headroomAuto(c.value == "auto") } })
            val set = draft.headroom
            if (set != null) Column(Modifier.parity("settings-device.headroom-db").padding(top = 8.dp).widthIn(max = 140.dp)) {
                FieldLabel("dB", Modifier.parity("settings-device.headroom-db"))
                var t by numberText(set)
                BasicTextField(t, { v -> t = v; number(v)?.let { draft = draft.copy(headroom = it.coerceIn(-30.0, 0.0), dirty = true) } },
                    Modifier.parity("settings-device.headroom-db", Contract.label("settings-device.headroom-db")).padding(top = 3.dp).fillMaxWidth(), singleLine = true,
                    textStyle = numberStyle(), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = NUMBER_KEYS, decorationBox = { NumberBox(it) })
            }
            DeviceNote(draft.headroomNote, Modifier.parity("settings-device.note"))
        }
        Row(Modifier.padding(top = 16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            Text(if (draft.dirty) "Not saved yet" else "", Modifier.parity("settings-device.dirty"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.5.sp, lineHeight = 17.sp)
            PrimaryButton("Save", draft.dirty && !busy, Modifier.parity("settings-device.save", Contract.label("settings-device.save")).clickable(enabled = draft.dirty && !busy) { save(d.dspOn) })
        }
    }
}

/** A band's row (.dsp-band): its type, Hz, dB (none for a pass) and Q, 5 apart, and × to take it away. */
@Composable
private fun BandRow(b: EqBand, onChange: (EqBand) -> Unit, onRemove: () -> Unit) {
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.Bottom) {
        val shape = RoundedCornerShape(9.dp)
        Box(Modifier.parity("settings-device.band-type", Contract.label("settings-device.band-type")).clickable {
            pickChoice(context, DspDraft.TYPES, b.type) { t -> onChange(b.copy(type = t, gain = if (t == "low_pass" || t == "high_pass") 0.0 else b.gain)) }
        }.weight(1.45f).height(40.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(start = 7.dp, end = 6.dp),
            contentAlignment = Alignment.CenterStart) {
            Text(DspDraft.TYPES.firstOrNull { it.value == b.type }?.words ?: b.type, Modifier.padding(end = 16.dp), color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 19.sp, maxLines = 1)
            Icon(painterResource(R.drawable.st_caret), contentDescription = null, tint = paletteColor(Palette.TEXT_DIM), modifier = Modifier.align(Alignment.CenterEnd).size(14.dp))
        }
        Column(Modifier.parity("settings-device.band-freq").weight(0.95f)) {
            FieldLabel("Hz", Modifier.parity("settings-device.band-freq"))
            var t by numberText(b.freq)
            BasicTextField(t, { v -> t = v; number(v)?.let { onChange(b.copy(freq = it.coerceIn(10.0, 24000.0))) } },
                Modifier.parity("settings-device.band-freq", Contract.label("settings-device.band-freq")).padding(top = 3.dp).fillMaxWidth(), singleLine = true,
                textStyle = numberStyle(), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = NUMBER_KEYS, decorationBox = { NumberBox(it) })
        }
        Column(Modifier.parity("settings-device.band-gain").weight(0.8f).alpha(if (b.pass) 0.4f else 1f)) {
            FieldLabel("dB", Modifier.parity("settings-device.band-gain"))
            var t by numberText(if (b.pass) 0.0 else b.gain)
            BasicTextField(t, { v -> t = v; number(v)?.let { onChange(b.copy(gain = it.coerceIn(-20.0, 20.0))) } },
                Modifier.parity("settings-device.band-gain", Contract.label("settings-device.band-gain")).padding(top = 3.dp).fillMaxWidth(), enabled = !b.pass, singleLine = true,
                textStyle = numberStyle(), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = NUMBER_KEYS, decorationBox = { NumberBox(it) })
        }
        Column(Modifier.parity("settings-device.band-q").weight(0.9f)) {
            FieldLabel("Q", Modifier.parity("settings-device.band-q"))
            var t by numberText(b.q, q = true)
            BasicTextField(t, { v -> t = v; number(v)?.let { onChange(b.copy(q = it.coerceIn(0.1, 20.0))) } },
                Modifier.parity("settings-device.band-q", Contract.label("settings-device.band-q")).padding(top = 3.dp).fillMaxWidth(), singleLine = true,
                textStyle = numberStyle(), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = NUMBER_KEYS, decorationBox = { NumberBox(it) })
        }
        Box(Modifier.parity("settings-device.band-remove", Contract.label("settings-device.band-remove")).clickable(onClick = onRemove).width(26.dp).height(40.dp).clip(shape),
            contentAlignment = Alignment.Center) {
            Text("×", color = paletteColor(Palette.TEXT_DIM), fontSize = 20.sp, lineHeight = 20.sp)
        }
    }
}

private val NUMBER_KEYS = KeyboardOptions(keyboardType = KeyboardType.Decimal)
/** A number as typed: a point or a comma, and only a finite one. */
private fun number(t: String): Double? = t.replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() }

/** A number's text as typed, taken from [value] again whenever what is typed no longer reads as it (a band removed, a value clamped). */
@Composable
private fun numberText(value: Double, q: Boolean = false): MutableState<String> {
    val s = remember { mutableStateOf(DspDraft.field(value, q)) }
    LaunchedEffect(value) { if (number(s.value)?.let { if (q) Math.round(it * 100) == Math.round(value * 100) else it == value } != true) s.value = DspDraft.field(value, q) }
    return s
}

@Composable
private fun numberStyle() = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 20.sp)

/** A number's name over its field (.dsp-field > span): 10.5/700, spaced capitals, faint. */
@Composable
private fun FieldLabel(name: String, modifier: Modifier) {
    Text(name.uppercase(), modifier, color = paletteColor(Palette.TEXT_FAINT), fontSize = 10.5.sp, lineHeight = 14.sp, fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
}

/** A number's field (.dsp-field input): 40 tall, 9 round on the raised ground, 7 in. */
@Composable
private fun NumberBox(inner: @Composable () -> Unit) {
    val shape = RoundedCornerShape(9.dp)
    Box(Modifier.fillMaxWidth().height(40.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 7.dp),
        contentAlignment = Alignment.CenterStart) { inner() }
}

/** A field's ground for typing in (.dev-name-input): 44 tall, 10 round on the raised ground, its [hint] faint while empty. */
@Composable
private fun InputBox(empty: Boolean, hint: String, inner: @Composable () -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    Box(Modifier.fillMaxWidth().height(44.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 12.dp),
        contentAlignment = Alignment.CenterStart) {
        if (empty) Text(hint, color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 22.sp, maxLines = 1)
        inner()
    }
}

/** One of AutoEq's answers (.hp-row): its name in 14.5/600 over whose measurement it is, on the raised ground, 10 round. */
@Composable
private fun ResultRow(r: HeadphoneResult, modifier: Modifier) {
    val shape = RoundedCornerShape(10.dp)
    Column(modifier.fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 12.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(r.name, color = paletteColor(Palette.TEXT), fontSize = 14.5.sp, lineHeight = 20.sp, fontWeight = FontWeight.W600)
        if (r.sub.isNotEmpty()) Text(r.sub, color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 16.sp)
    }
}

/** A filled button (.action-btn.primary): 40 tall, a pill on the brass, 13/500, 110 wide at least; dimmed while it can't be pressed. */
@Composable
internal fun PrimaryButton(words: String, enabled: Boolean, modifier: Modifier) {
    val pill = RoundedCornerShape(999.dp)
    Box(modifier.alpha(if (enabled) 1f else 0.55f).widthIn(min = 110.dp).height(40.dp).clip(pill).background(paletteColor(Palette.ACCENT)).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Text(words, color = paletteColor(Palette.ON_ACCENT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500, maxLines = 1)
    }
}

/**
 * The bands' response (the page's drawDsp): 10 round on the raised ground; the frequency lines (the decades darker, five
 * labelled under), the level lines (0 darker, labelled at the left), the response in the brass, and the same with the
 * headroom taken, dashed, where there is headroom.
 */
@Composable
private fun DspCurveView(c: DspCurve, modifier: Modifier) {
    val measurer = rememberTextMeasurer()
    val border = paletteColor(Palette.BORDER); val faint = paletteColor(Palette.TEXT_FAINT); val accent = paletteColor(Palette.ACCENT)
    val box = RoundedCornerShape(10.dp)
    Canvas(modifier.clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, border, box)) {
        val padL = 30.dp.toPx(); val padR = 8.dp.toPx(); val padT = 8.dp.toPx(); val padB = 18.dp.toPx()
        val w = size.width - padL - padR; val h = size.height - padT - padB
        val label = TextStyle(color = faint, fontSize = 10.sp, lineHeight = 12.sp)
        for (f in DspCurve.GRID) {
            val x = padL + c.x(f.toDouble(), w)
            drawLine(border.copy(alpha = if (f in DspCurve.STRONG) 1f else 0.45f), Offset(x, padT), Offset(x, padT + h), 1.dp.toPx())
            if (f in DspCurve.LABELLED) { val t = measurer.measure(DspCurve.label(f), label); drawText(t, topLeft = Offset(x - t.size.width / 2f, padT + h + 4.dp.toPx())) }
        }
        for (v in listOf(c.top, c.top / 2, 0.0, -c.top / 2, -c.top)) {
            val y = padT + c.y(v, h)
            drawLine(border.copy(alpha = if (v == 0.0) 1f else 0.45f), Offset(padL, y), Offset(padL + w, y), 1.dp.toPx())
            val t = measurer.measure((if (v > 0) "+" else "") + DspDraft.field(v), label)
            drawText(t, topLeft = Offset(padL - 4.dp.toPx() - t.size.width, y - t.size.height / 2f))
        }
        fun line(dbs: List<Double>, dash: Boolean) {
            val p = Path()
            dbs.forEachIndexed { i, v -> val x = padL + c.x(c.freqs[i], w); val y = padT + c.y(v, h); if (i == 0) p.moveTo(x, y) else p.lineTo(x, y) }
            drawPath(p, accent, style = Stroke(2.dp.toPx(), pathEffect = if (dash) PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())) else null))
        }
        if (c.pre < 0) line(c.db.map { it + c.pre }, true)
        line(c.db, false)
    }
}
