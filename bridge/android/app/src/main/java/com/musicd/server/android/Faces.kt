package com.musicd.server.android

import androidx.compose.material3.Typography
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/*
 * Mandarin's colours and faces for the Bridge's screens (item 430), as Mandarin's own app has them (its Theme.kt): the
 * graphite and the brass, Manrope for the words and Young Serif for a title. The fonts are Mandarin's, read from its
 * app's res/font at build time (bridge/driver-files.txt), never copied in.
 */

internal val Graphite = Color(0xFF17191C)
internal val Brass = Color(0xFFC9A45C)
internal val BrassText = Color(0xFFD4B06A)
internal val Ink = Color(0xFFEFEDE8)
internal val Soft = Color(0xFFCFD1D4)
internal val Muted = Color(0xFF8E9196)
internal val Faint = Color(0xFF6F7378)
internal val Rule = Color(0xFF3A3D42)
internal val Card = Color(0xFF1F2226)

internal val Manrope = FontFamily(
    Font(R.font.manrope_regular, FontWeight.W400), Font(R.font.manrope_medium, FontWeight.W500), Font(R.font.manrope_semibold, FontWeight.W600),
    Font(R.font.manrope_bold, FontWeight.W700), Font(R.font.manrope_extrabold, FontWeight.W800)
)
internal val YoungSerif = FontFamily(Font(R.font.young_serif, FontWeight.W400))

/** Material's type scale in Manrope, as Mandarin's app sets it: no letter-spacing of Material's own. */
internal fun bridgeTypography(): Typography {
    val t = Typography()
    fun TextStyle.ours() = copy(fontFamily = Manrope, letterSpacing = 0.sp)
    return Typography(
        displayLarge = t.displayLarge.ours(), displayMedium = t.displayMedium.ours(), displaySmall = t.displaySmall.ours(),
        headlineLarge = t.headlineLarge.ours(), headlineMedium = t.headlineMedium.ours(), headlineSmall = t.headlineSmall.ours(),
        titleLarge = t.titleLarge.ours(), titleMedium = t.titleMedium.ours(), titleSmall = t.titleSmall.ours(),
        bodyLarge = t.bodyLarge.ours(), bodyMedium = t.bodyMedium.ours(), bodySmall = t.bodySmall.ours(),
        labelLarge = t.labelLarge.ours(), labelMedium = t.labelMedium.ours(), labelSmall = t.labelSmall.ours()
    )
}
