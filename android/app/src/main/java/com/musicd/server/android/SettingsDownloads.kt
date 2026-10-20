package com.musicd.server.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Choice
import com.musicd.server.client.Contract
import com.musicd.server.client.DlAlbum
import com.musicd.server.client.DlSettings
import com.musicd.server.client.Downloads
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/*
 * Settings → Setup → Downloads natively (the group T of docs/specs/plan-android-native.md, T8; bug list item 91), as the
 * page's (docs/specs/screens.json, settings-downloads and settings-downloads-albums; android-downloads.js; android.css
 * .dl-folder, .settings-subhead, .dl-row): the Downloads row opening the albums, Offline mode, Downloading, Playing away
 * from home, Cached ahead and Automatic downloads. What it shows and every change go through the app's own downloads
 * bridge (DownloadsBridge, as the page's did), read again every two seconds while the page is open, so a download moving
 * on is seen moving. The albums are SettingsDownloadsList.kt's.
 */

/** Settings' Downloads ([client]: the server's, for the albums' covers; [onBack]: back to Setup). */
@Composable
internal fun SettingsDownloads(client: () -> ServerClient?, onBack: () -> Unit) {
    val context = LocalContext.current
    val bridge = remember(context) { (context as? Activity)?.let { DownloadsBridge(it) } } ?: return
    var settings by remember { mutableStateOf<DlSettings?>(null) }
    var albums by remember { mutableStateOf<List<DlAlbum>>(emptyList()) }
    var cache by remember { mutableStateOf("…") }
    var reads by remember { mutableIntStateOf(0) }
    var showAlbums by remember { mutableStateOf(false) }
    var info by remember { mutableStateOf<String?>(null) }
    // Read now, after a change (reads), and every two seconds while open: a download moving on, the cache filling.
    LaunchedEffect(reads) {
        while (true) {
            val got = withContext(Dispatchers.IO) {
                runCatching { Triple(DlSettings.parse(JSONObject(bridge.settings())), DlAlbum.list(JSONArray(bridge.all())), Downloads.cacheLine(JSONObject(bridge.cacheStatus()))) }.getOrNull()
            }
            if (got != null) { settings = got.first; albums = got.second; cache = got.third }
            delay(2_000)
        }
    }
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    fun set(key: String, value: String) { bridge.set(key, value); reads++ }
    if (showAlbums) {
        BackHandler { showAlbums = false }
        SettingsDownloadsList(albums, settings?.used ?: 0, client, bridge, onBack = { showAlbums = false }, changed = { reads++ })
        return
    }
    val s = settings
    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-downloads.back", Contract.label("settings-downloads.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "Downloads", Modifier.parity("settings-downloads.heading"))
            if (s == null) return@SettingsFrame
            Block { FolderRow(Downloads.folderSub(albums, s.used), Modifier.parity("settings-downloads.folder", Contract.label("settings-downloads.folder")).clickable { showAlbums = true }) }
            SettingsDivider(18, 18)
            s.offlineMode?.let { on ->
                Block {
                    Spaced { DlToggle("Offline mode", on) { set("offlineMode", (!on).toString()) } }
                    SetupNote(Downloads.offlineNote(on), Modifier.parity("settings-downloads.note"))
                }
                SettingsDivider(18, 18)
            }
            Block {
                Subhead("Downloading", Modifier.parity("settings-downloads.subhead"), null)
                DlSelect("Quality", Modifier.parity("settings-downloads.info", Contract.label("settings-downloads.info", 0, "Quality")).clickable { info = Downloads.QUALITY_INFO },
                    Downloads.QUALITY, s.quality, first = true) { set("quality", it) }
                DlSelect("Save to", Modifier.parity("settings-downloads.info", Contract.label("settings-downloads.info", 0, "Save to")).clickable { info = Downloads.PLACE_INFO },
                    Downloads.places(s), s.location) { set("location", it) }
                FolderParts(s, bridge, context) { reads++ }
                DlSelect("Size limit", null, Downloads.LIMIT, s.limitGb.toString()) { set("limitGb", it) }
                Spaced { DlToggle("Wi-Fi only", s.wifiOnly) { set("wifiOnly", (!s.wifiOnly).toString()) } }
            }
            s.awayQuality?.let { away ->
                SettingsDivider(18, 18)
                Block {
                    Subhead("Playing away from home", Modifier.parity("settings-downloads.subhead"), null)
                    DlSelect("Stream as", Modifier.parity("settings-downloads.info", Contract.label("settings-downloads.info", 0, "Stream as")).clickable { info = Downloads.AWAY_INFO },
                        Downloads.AWAY, away, first = true) { set("awayQuality", it) }
                    SetupNote("At home it’s always the original.", Modifier.parity("settings-downloads.note"))
                }
            }
            if (s.cacheWifiChoices.isNotEmpty()) {
                SettingsDivider(18, 18)
                Block {
                    Subhead("Cached ahead", Modifier.parity("settings-downloads.subhead"), Modifier.parity("settings-downloads.info", Contract.label("settings-downloads.info", 0, "Cached ahead")).clickable { info = Downloads.cacheInfo(s.cacheMobile) })
                    DlSelect("On Wi-Fi", null, Downloads.tracks(s.cacheWifiChoices), s.cacheWifi.toString(), first = true) { set("cacheWifi", it) }
                    DlSelect("On mobile data", null, Downloads.tracks(s.cacheMobileChoices), s.cacheMobile.toString()) { set("cacheMobile", it) }
                    DlSelect("Cache size", null, Downloads.gbs(s.cacheGbChoices), s.cacheGb.toString()) { set("cacheGb", it) }
                    Spaced {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text(cache, Modifier.parity("settings-downloads.cache-status").weight(1f).padding(end = 10.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 17.55.sp)
                            SetupButton("Clear cache", false, Modifier.parity("settings-downloads.clear-cache", Contract.label("settings-downloads.clear-cache")).clickable { bridge.clearCache(); reads++ })
                        }
                    }
                }
            }
            SettingsDivider(18, 18)
            Block {
                Subhead("Automatic downloads", Modifier.parity("settings-downloads.subhead"), Modifier.parity("settings-downloads.info", Contract.label("settings-downloads.info", 0, "Automatic downloads")).clickable { info = Downloads.AUTO_INFO })
                DlToggle("Today’s Smart Picks", s.autoPicks) { set("autoPicks", (!s.autoPicks).toString()) }
                Spaced { DlToggle("Album of the day", s.autoAotd) { set("autoAotd", (!s.autoAotd).toString()) } }
                DlSelect("Recently added", null, Downloads.RECENT, s.autoRecent.toString()) { set("autoRecent", it) }
                SetupNote("Removed again when they drop off the list.", Modifier.parity("settings-downloads.note"))
            }
        }
        info?.let { InfoTip(it, Modifier.parity("settings-downloads.info")) }
    }
}

/** The download folder's row (chosen, changed, forgotten), the access it needs, and the albums saved elsewhere moved. */
@Composable
private fun FolderParts(s: DlSettings, bridge: DownloadsBridge, context: Context, changed: () -> Unit) {
    for (part in Downloads.folderParts(s)) {
        if (part.note) { SetupNote(part.text, Modifier.parity("settings-downloads.note")); continue }
        Spaced {
            SetupRow(part.text, Modifier.parity("settings-downloads.name"), null) {
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    for (a in part.actions) when (a) {
                        "choose" -> SetupButton(if (s.folderChosen) "Change" else "Choose", false,
                            Modifier.parity("settings-downloads.folder-choose", Contract.label("settings-downloads.folder-choose", if (s.folderChosen) 1 else 0)).clickable { bridge.chooseDownloadFolder() })
                        "forget" -> SetupButton("Forget", false, Modifier.parity("settings-downloads.folder-forget", Contract.label("settings-downloads.folder-forget")).clickable {
                            askFirst(context, Downloads.ASK_FORGET, "Forget") { bridge.forgetDownloadFolder(); changed() }
                        })
                        "allow" -> SetupButton("Allow", false, Modifier.parity("settings-downloads.allow", Contract.label("settings-downloads.allow")).clickable { bridge.allowAllFiles() })
                        "move" -> SetupButton("Move all here", false, Modifier.parity("settings-downloads.move", Contract.label("settings-downloads.move")).clickable {
                            askFirst(context, Downloads.ASK_MOVE, "Move") { bridge.moveDownloads(); changed() }
                        })
                    }
                }
            }
        }
    }
}

/** A row with its switch, keyed as the page's ([name]: the row's and the switch's name). */
@Composable
private fun DlToggle(name: String, on: Boolean, flip: () -> Unit) {
    SetupRow(name, Modifier.parity("settings-downloads.name"), null) {
        Toggle(on, Modifier.parity("settings-downloads.toggle", Contract.label("settings-downloads.toggle", 0, name)).clickable(onClick = flip))
    }
}

/** A row with its list ([info]: its ⓘ, or none), 14 under the row before it unless it is the first under a subhead ([first]). */
@Composable
private fun DlSelect(name: String, info: Modifier?, choices: List<Choice>, value: String, first: Boolean = false, pick: (String) -> Unit) {
    val context = LocalContext.current
    Box(Modifier.padding(top = if (first) 0.dp else 14.dp)) {
        SetupRow(name, Modifier.parity("settings-downloads.name"), info) {
            SelectBox(choiceWords(choices, value), choices, Modifier.parity("settings-downloads.caret"),
                Modifier.parity("settings-downloads.choice", Contract.label("settings-downloads.choice", 0, name)).clickable { pickChoice(context, choices, value, pick) })
        }
    }
}

/** A row 14 under the one before it (android.css, .settings-pane[data-pane="downloads"] .settings-row). */
@Composable
private fun Spaced(content: @Composable () -> Unit) { Box(Modifier.padding(top = 14.dp)) { content() } }

/**
 * A section's title (android.css .settings-subhead): 12 in 700, spaced, in capitals, faint, 4 over and 10 under, with its ⓘ
 * after it where it has one ([info]: its key and tap).
 */
@Composable
private fun Subhead(text: String, title: Modifier, info: Modifier?) {
    Row(Modifier.padding(top = 4.dp, bottom = 10.dp).heightIn(min = if (info != null) 32.dp else 17.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), title, color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.sp,
            fontWeight = FontWeight.W700, letterSpacing = 0.08.em)
        if (info != null) Box(info.size(32.dp).padding(start = 4.dp), contentAlignment = Alignment.Center) {
            Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 12.sp)
        }
    }
}

/**
 * The Downloads row (android.css .dl-folder): 14 round on the raised ground, 16 and 14 in, the folder in brass on the
 * ground in a 40 square, "Downloads" in 16/600 and [sub] in 13 dim under it, the chevron faint at the end.
 */
@Composable
private fun FolderRow(sub: String, modifier: Modifier) {
    val shape = RoundedCornerShape(14.dp)
    Row(modifier.fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(40.dp).background(paletteColor(Palette.BG_ELEV), RoundedCornerShape(11.dp)), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.st_folders), contentDescription = null, tint = paletteColor(Palette.ACCENT_TEXT), modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Downloads", Modifier.parity("settings-downloads.folder-title"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W600)
            Text(sub, Modifier.parity("settings-downloads.folder-sub"), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(painterResource(R.drawable.dl_chevron), contentDescription = null, tint = paletteColor(Palette.TEXT_FAINT), modifier = Modifier.size(18.dp))
    }
}

/** Asked first, as the page asks ([text]), [yes] the button that goes ahead; [then] once it is said. */
internal fun askFirst(context: Context, text: String, yes: String, then: () -> Unit) {
    AlertDialog.Builder(context).setMessage(text).setPositiveButton(yes) { _, _ -> then() }.setNegativeButton("Cancel", null).show()
}
