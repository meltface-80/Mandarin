package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract

/**
 * The touch layout's row along the foot of the screen, natively
 * (docs/specs/screens.json, nav; style.css, `.touch-nav`): Menu, Home,
 * Library and Search, the one the page is on ([lit]: "home", "library", "search")
 * in brass, and the Offline sign between Home and Library when the app is
 * offline. Each tap is the page's own button's ([onTap], by name), so there
 * is one way to do each thing; but Menu, which opens the app's own side menu
 * over the screen (item 67), or offline, where the page's is the one.
 */
@Composable
internal fun TouchNav(lit: String, offline: Boolean, onTap: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        Box(Modifier.fillMaxWidth().height(58.dp)) {
            Row(Modifier.fillMaxSize().padding(horizontal = 10.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                NavButton(R.drawable.tn_menu, Contract.label("nav.menu"), false, Modifier.parity("nav.menu", Contract.label("nav.menu")).clickable { if (offline) onTap("menu") else NativeShell.menuOpen.value = true })
                NavButton(R.drawable.tn_home, Contract.label("nav.home"), lit == "home", Modifier.parity("nav.home", Contract.label("nav.home")).clickable { onTap("home") })
                NavButton(R.drawable.tn_library, Contract.label("nav.library"), lit == "library", Modifier.parity("nav.library", Contract.label("nav.library")).clickable { onTap("library") })
                NavButton(R.drawable.tn_search, Contract.label("nav.search"), lit == "search", Modifier.parity("nav.search", Contract.label("nav.search")).clickable { onTap("search") })
            }
            // A box of its own, not a button: a button's background lies outside its 48 touch target, and drew the disc 48 wide.
            if (offline) Box(Modifier.parity("nav.offline", Contract.label("nav.offline")).align(Alignment.Center).size(30.dp)
                .clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).clickable { onTap("offline") }, contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.tn_offline), contentDescription = null, tint = MaterialTheme.colorScheme.secondary, modifier = Modifier.size(18.dp))
            }
        }
    }
}

/** One of the row's buttons: its icon over its word, dim, or brass where the page is. */
@Composable
private fun NavButton(icon: Int, text: String, lit: Boolean, modifier: Modifier) {
    val color = if (lit) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier.width(64.dp).height(58.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(painterResource(icon), contentDescription = null, tint = color, modifier = Modifier.size(26.dp))
        Spacer(Modifier.height(3.dp))
        Text(text, color = color, fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.W600, letterSpacing = 0.02.em, maxLines = 1)
    }
}
