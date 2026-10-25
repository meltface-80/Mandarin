package com.musicd.server.android

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ServiceAlbum
import com.musicd.server.client.ServiceArtist
import com.musicd.server.client.ServiceBrowse
import com.musicd.server.client.ServicePage
import com.musicd.server.client.ServiceTab
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A list the browser shows (a tab's, a search's, an artist's): its albums, the artists a search found, its status line, its paging, an artist's head. */
internal class ServiceView {
    val albums = androidx.compose.runtime.mutableStateListOf<ServiceAlbum>()
    var artists by mutableStateOf<List<ServiceArtist>>(emptyList())
    var status by mutableStateOf("")
    var hasMore by mutableStateOf(false)
    var offset = 0
    var limit = ServiceBrowse.PAGE_SIZE
    var head by mutableStateOf<ServicePage?>(null)
    var more by mutableStateOf(false)
    /** Which ask is the latest: a late answer to an earlier one is dropped. */
    var seq = 0
}

/** A browser as opened (one a time it is navigated to), kept while it is on the back stack: Back from an album's page finds it as it was. */
internal class ServiceKept(val service: String) {
    var tabs by mutableStateOf(ServiceBrowse.tabs(service))
    var tabsAsked = false
    var tab by mutableStateOf(tabs.first().id)
    var field by mutableStateOf("")
    /** The words of the search shown ("": the tab's list). */
    var searched by mutableStateOf("")
    val root = ServiceView()
    /** An artist over the list: their id and name, and their albums. */
    var artist by mutableStateOf<Triple<String, String, ServiceView>?>(null)
    val favs = mutableStateMapOf<String, Boolean>()
    /** The album whose page was opened last: its favourite is read again when the browser is back. */
    var opened: String? = null
    var started = false
}

internal object ServiceBrowsers {
    private val kept = HashMap<String, ServiceKept>()
    @Synchronized fun kept(key: String, service: String): ServiceKept = kept.getOrPut(key) { ServiceKept(service) }
}

/**
 * The Qobuz or Tidal browser natively (the group B of old/plan-android-native.md, B2; bug list item 73), drawn as the
 * page's (docs/specs/screens.json, service-browser and service-artist; service-browser*.js; style.css .qobuz-*): over the
 * whole screen, its title and ✕, the search field (450 ms after the last key, or Enter) and the tabs (New Releases, then
 * Qobuz's lists or the ones Tidal says) pinned at its head, the line saying what is shown, the albums as tiles with the
 * service's favourite (+ or ✓) on each cover; a search's artists as a strip above its albums; an artist's ‹ Back, their
 * picture, name and biography, their albums with Load more. A tile opens the album's own page natively (the server makes
 * its library rows first, [onAlbum] with its offset); its favourite is read again when the browser comes back.
 * [kept] holds what it shows; [startArtist] an artist to open straight away (the search's), [startSearch] words to search
 * for straight away (Pitchfork's Find on Qobuz).
 */
@Composable
internal fun ServiceBrowserScreen(kept: ServiceKept, startArtist: Pair<String, String>?, startSearch: String, prefs: WallPrefs, client: () -> ServerClient?, onClose: () -> Unit, onAlbum: (Long) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val service = kept.service
    val (cols, _) = wallColumns(prefs)
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    fun tabOf(id: String): ServiceTab = kept.tabs.firstOrNull { it.id == id } ?: kept.tabs.first()

    /** [v] read from [path] (its first page), its status line written by [status]; a failure said in the status line. */
    fun show(v: ServiceView, path: String, loading: String, status: (ServicePage) -> String) {
        val c = client() ?: return
        val seq = ++v.seq
        v.status = loading
        scope.launch {
            val got = withContext(Dispatchers.IO) { runCatching { ServicePage.parse(service, c.getJson(path)) } }
            if (seq != v.seq) return@launch
            got.onSuccess { p ->
                v.albums.clear(); v.albums.addAll(p.albums); v.artists = p.artists; v.head = p
                v.offset = 0; v.limit = p.limit; v.hasMore = p.hasMore; v.status = status(p)
                for (a in p.albums) if (a.id !in kept.favs) kept.favs[a.id] = a.favourited
            }.onFailure { e -> v.albums.clear(); v.artists = emptyList(); v.hasMore = false; v.status = ServiceBrowse.failure(service, e.message) }
        }
    }
    fun showTab(id: String) { kept.tab = id; kept.searched = ""; val t = tabOf(id); show(kept.root, ServiceBrowse.tabPath(service, t), ServiceBrowse.loading(t)) { ServiceBrowse.tabStatus(t, it) } }
    fun showSearch(q: String) { kept.searched = q; show(kept.root, ServiceBrowse.searchPath(service, q, 0), ServiceBrowse.SEARCHING) { ServiceBrowse.searchStatus(q, it) } }
    fun showArtist(id: String, name: String) {
        val v = ServiceView()
        kept.artist = Triple(id, name, v)
        show(v, ServiceBrowse.artistPath(service, id, 0), "Loading…") { ServiceBrowse.artistStatus(it) }
    }
    /** The search's words applied: two letters or more search, none go back to the tab, one waits (or, asked with Enter, says so). */
    fun applySearch(q: String, asked: Boolean) {
        when {
            q.isEmpty() -> if (kept.searched.isNotEmpty()) showTab(kept.tab)
            q.length < 2 -> if (asked) kept.root.status = ServiceBrowse.TOO_SHORT
            q != kept.searched -> { kept.artist = null; showSearch(q) }
        }
    }
    fun loadMore(v: ServiceView, path: (Int) -> String) {
        val c = client() ?: return
        if (!v.hasMore || v.more) return
        val seq = ++v.seq
        val next = v.offset + v.limit
        v.more = true
        scope.launch {
            val got = withContext(Dispatchers.IO) { runCatching { ServicePage.parse(service, c.getJson(path(next))) } }
            v.more = false
            if (seq != v.seq) return@launch
            got.onSuccess { p -> v.offset = next; v.hasMore = p.hasMore; v.limit = p.limit; v.albums.addAll(p.albums); for (a in p.albums) if (a.id !in kept.favs) kept.favs[a.id] = a.favourited }
                .onFailure { toast("Couldn't load more: " + (com.musicd.server.client.Failure.said(it, "no answer"))) }
        }
    }
    fun favourite(a: ServiceAlbum) {
        val c = client() ?: return
        val was = kept.favs[a.id] ?: a.favourited
        scope.launch {
            val j = withContext(Dispatchers.IO) { runCatching { c.serviceFavourite(service, a.id, !was) } }
            j.onSuccess { r -> if (r.optBoolean("ok")) { kept.favs[a.id] = !was; toast(ServiceBrowse.favourited(service, !was)) } else toast(r.optString("error").ifEmpty { "Couldn't update favourite" }) }
                .onFailure { toast("Failed: " + (com.musicd.server.client.Failure.said(it, "no answer"))) }
        }
    }
    fun open(a: ServiceAlbum) {
        val c = client() ?: return
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { c.serviceOpen(service, a.id) } }
                .onSuccess { kept.opened = a.id; onAlbum(it) }.onFailure { toast(com.musicd.server.client.Failure.said(it, "Couldn't open that album")) }
        }
    }

    // Opened: the first tab (or the artist asked for over it), and Tidal's own lists; back from an album's page: its favourite read again.
    LaunchedEffect(Unit) {
        if (!kept.started) {
            kept.started = true
            showTab(kept.tab)
            if (startSearch.isNotBlank()) kept.field = startSearch
            startArtist?.let { (id, name) -> if (id.isNotEmpty()) showArtist(id, name) }
        }
        val c = client() ?: return@LaunchedEffect
        if (service == "tidal" && !kept.tabsAsked) {
            kept.tabsAsked = true
            withContext(Dispatchers.IO) { runCatching { c.getJson("/api/tidal/lists") }.getOrNull() }?.let { kept.tabs = ServiceBrowse.lists(kept.tabs, it) }
        }
        kept.opened?.let { id ->
            kept.opened = null
            withContext(Dispatchers.IO) { runCatching { c.serviceFavouriteNow(service, id) }.getOrNull() }?.let { kept.favs[id] = it }
        }
    }
    // The search 450 ms after the last key; emptied, the tab at once.
    LaunchedEffect(kept.field) {
        val q = kept.field.trim()
        if (q.isNotEmpty()) delay(450)
        applySearch(q, false)
    }
    BackHandler { if (kept.artist != null) kept.artist = null else onClose() }

    val artist = kept.artist
    val view = artist?.third ?: kept.root
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant)) {
        // The pinned head: the title and the close disc over a brass hairline, the search, the tabs.
        Column(Modifier.padding(start = 14.dp, top = 12.dp, end = 14.dp, bottom = 2.dp)) {
            Row(Modifier.fillMaxWidth().height(42.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                val size = (24 * prefs.title).sp
                Text(ServiceBrowse.name(service), Modifier.parity("service-browser.title"), color = MaterialTheme.colorScheme.onSurface, fontFamily = youngSerif, fontSize = size, lineHeight = size, letterSpacing = 0.01.em)
                Box(Modifier.parity("service-browser.close", Contract.label("service-browser.close")).size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).clickable(onClick = onClose),
                    contentAlignment = Alignment.Center) {
                    Icon(painterResource(R.drawable.np_close), contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(20.dp))
                }
            }
            Box(Modifier.padding(top = 11.dp).fillMaxWidth().height(1.dp).background(paletteColor(Palette.ACCENT).copy(alpha = 0.12f)))
            Spacer(Modifier.height(10.dp))
            SearchRow(kept.field, ServiceBrowse.name(service), onField = { kept.field = it }, onSearch = { applySearch(kept.field.trim(), true); focus.clearFocus() }, onClear = { kept.field = "" })
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 6.dp, top = 2.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (t in kept.tabs) {
                    val on = artist == null && kept.searched.isEmpty() && kept.tab == t.id
                    BrowserTab(Modifier.parity("service-browser.tab", Contract.label("service-browser.tab", 0, t.label)).clip(CircleShape).clickable { kept.field = ""; kept.artist = null; if (kept.tab != t.id || kept.searched.isNotEmpty()) showTab(t.id) }, t.label, on)
                }
            }
        }
        LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 40.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column {
                    Text(view.status, Modifier.parity("service-browser.status").padding(top = 4.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp, lineHeight = 15.sp)
                    if (artist != null) ArtistHead(artist.second, view.head, onBack = { kept.artist = null })
                    else if (view.artists.isNotEmpty()) ServiceArtistStrip(view.artists) { ar -> showArtist(ar.id, ar.name) }
                    else Spacer(Modifier.height(4.dp))
                }
            }
            items(view.albums.size, key = { "a" + view.albums[it].id + "/" + it }) { i ->
                val a = view.albums[i]
                ServiceAlbumTile(a, kept.favs[a.id] ?: a.favourited, prefs, onFav = { favourite(a) }, onOpen = { open(a) })
            }
            if (view.hasMore) item("more", span = { GridItemSpan(maxLineSpan) }) {
                val path: (Int) -> String = if (artist != null) { n -> ServiceBrowse.artistPath(service, artist.first, n) } else { n -> ServiceBrowse.searchPath(service, kept.searched, n) }
                Box(Modifier.parity("service-browser.load-more", Contract.label("service-browser.load-more")).padding(top = 10.dp, bottom = 4.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)).clickable(enabled = !view.more) { loadMore(view, path) }
                    .padding(horizontal = 12.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
                    Text(if (view.more) "Loading…" else "Load more", color = MaterialTheme.colorScheme.onSurface, fontSize = 13.sp, lineHeight = 18.sp)
                }
            }
        }
    }
}

/** The search field (.qobuz-search-row): the raised ground, its edge brass while typing, the × at its right once there are words. */
@Composable
private fun SearchRow(field: String, name: String, onField: (String) -> Unit, onSearch: () -> Unit, onClear: () -> Unit) {
    val box = RoundedCornerShape(8.dp)
    Box(Modifier.padding(start = 6.dp, top = 2.dp, end = 6.dp, bottom = 8.dp).fillMaxWidth()) {
        BasicTextField(field, onField, Modifier.parity("service-browser.search", Contract.label("service-browser.search", 0, name)).fillMaxWidth(), singleLine = true,
            textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 14.sp, lineHeight = 19.sp), cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { onSearch() }), decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, MaterialTheme.colorScheme.outline, box).padding(start = 10.dp, top = 8.dp, end = 36.dp, bottom = 8.dp)) {
                    if (field.isEmpty()) Text("Search the $name catalogue…", color = paletteColor(Palette.TEXT_FAINT), fontSize = 14.sp, lineHeight = 19.sp, maxLines = 1)
                    inner()
                }
            })
        if (field.isNotEmpty()) Box(Modifier.parity("service-browser.search-clear", Contract.label("service-browser.search-clear")).align(Alignment.CenterEnd).padding(end = 4.dp).size(28.dp).clip(CircleShape)
            .clickable(onClick = onClear), contentAlignment = Alignment.Center) {
            Text("×", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 18.sp, lineHeight = 18.sp)
        }
    }
}

/** A tab (.qobuz-tab): a pill 32 tall, dim on an edge, the one shown in brass with a brass edge. */
@Composable
private fun BrowserTab(modifier: Modifier, word: String, on: Boolean) {
    Box(modifier.height(32.dp).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, CircleShape)
        .padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
        Text(word, color = if (on) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
    }
}

/** An artist over the list: ‹ Back, their round picture and name, their biography clipped with Show more and where it is from. */
@Composable
private fun ArtistHead(name: String, head: ServicePage?, onBack: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("‹ Back", Modifier.parity("service-artist.back", Contract.label("service-artist.back")).clickable(onClick = onBack).padding(horizontal = 2.dp, vertical = 4.dp),
            color = MaterialTheme.colorScheme.secondary, fontSize = 15.sp, lineHeight = 21.sp)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val image = rememberWebImage(head?.artistImage)
            Box(Modifier.parity("service-artist.art").size(64.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
                image?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
            }
            Text(head?.artistName?.ifEmpty { null } ?: name, Modifier.parity("service-artist.name").weight(1f), color = MaterialTheme.colorScheme.onSurface, fontSize = 17.sp, lineHeight = 23.sp,
                fontWeight = FontWeight.W700, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        val bio = head?.biography.orEmpty()
        if (bio.isNotEmpty()) {
            var more by remember(bio) { mutableStateOf(false) }
            var clipped by remember(bio) { mutableStateOf(false) }
            Column(Modifier.padding(top = 2.dp)) {
                Text(bio, Modifier.parity("service-artist.bio").fillMaxWidth(), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.5.sp, lineHeight = 21.6.sp,
                    maxLines = if (more) Int.MAX_VALUE else 5, onTextLayout = { if (!more) clipped = it.hasVisualOverflow })
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (clipped || more) Text(Contract.label("service-artist.bio-more", if (more) 1 else 0), Modifier.parity("service-artist.bio-more", Contract.label("service-artist.bio-more", if (more) 1 else 0))
                        .clickable { more = !more }.padding(top = 6.dp, bottom = 4.dp), color = MaterialTheme.colorScheme.secondary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
                    Text("Bio: Qobuz", Modifier.parity("service-artist.bio-source").padding(top = 2.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 16.sp)
                }
            }
        }
    }
}
