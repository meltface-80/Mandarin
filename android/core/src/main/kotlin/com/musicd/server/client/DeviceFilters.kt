package com.musicd.server.client

import org.json.JSONObject

/**
 * A device's upsampling filters (items 248, 259, 298), as the page's app/device-filters.js has them: two rows, the filter
 * for CD-rate sources (44.1 and 48 kHz) and the one for hi-res sources (88.2 kHz and up, or the same), each opening the
 * list of filters, each with what it does. The words are the page's.
 */
object DeviceFilters {
    /** One filter of the list: the value the server keeps, its name and what it does. */
    data class Filter(val value: String, val name: String, val note: String)

    val ALL: List<Filter> = listOf(
        Filter("standard", "Standard", "Linear phase, steep: flat to 21 kHz for a CD. SoX’s filter for PCM; Mandarin’s own on the way to DSD."),
        Filter("minphase", "Minimum phase", "Standard’s response with all its ringing after a sound, none before. Mandarin’s own, made as it plays."),
        Filter("gentle", "Gentle", "Linear phase, rolling off from 19.8 kHz for a CD: its ringing half as long; −6 dB at 21 kHz."),
        Filter("gaussian", "Gaussian", "A smooth roll-off: flat to 19.75 kHz for a CD (−0.5 dB at 20 kHz), 100 dB down by 22.05 kHz; 1.8 ms of ringing before a sound."),
        Filter("gaussian-steep", "Gaussian steep", "Flat to 21.8 kHz for a CD and half down at 22.05 kHz, every sample of the file kept as it is (not apodizing); 5.9 ms of ringing before a sound."),
        Filter("gaussian-hires", "Gaussian hi-res", "For 88.2 kHz and up: flat to 25.9 kHz from 96 kHz, 0.2 ms of ringing. For a CD it rolls off from 12 kHz."),
        Filter("long", "Long", "Very steep: flat to 21.8 kHz for a CD, 270 dB down from 22.1 kHz. 262,145 taps at ×16; 28 ms of ringing either side of a sound, at 22 kHz."),
        Filter("very-long", "Very long", "Steeper still: flat to 21.9 kHz for a CD, 284 dB down from 22.1 kHz. 1,048,577 taps at ×16; 47 ms of ringing either side, at 22 kHz. A track takes 0.6 s longer to start, and 400 MB while it plays."),
    )
    /** The hi-res list's first: the filter for CD-rate sources for every track. */
    val SAME = Filter("same", "Same as CD-rate sources", "The filter for CD-rate sources, for every track.")

    /** The name of the filter [v]; an unknown one is the standard one, as the server takes it. */
    fun name(v: String): String = (ALL.firstOrNull { it.value == v } ?: ALL[0]).name

    /** The rows: "filter" (CD-rate) and "filter_hires" (hi-res), each with its label, its rates and the filter in use. */
    data class Row(val which: String, val label: String, val sub: String, val value: String)

    fun rows(filter: String, hires: String?): List<Row> = listOf(
        Row("filter", "CD-rate sources", "44.1 and 48 kHz", name(filter)),
        Row("filter_hires", "Hi-res sources", "88.2 kHz and up", if (hires == null) "Same as CD-rate" else name(hires)),
    )

    /** The list a row [which] opens: its title, its filters, and the value now in use. */
    fun title(which: String): String = if (which == "filter") "Filter for CD-rate sources" else "Filter for hi-res sources"
    fun choices(which: String): List<Filter> = if (which == "filter_hires") listOf(SAME) + ALL else ALL
    fun current(which: String, filter: String, hires: String?): String = if (which == "filter") filter else hires ?: "same"

    /** The change a filter picked makes: PATCH {output: {[which]: v}} ("same" for hi-res sources clears it). */
    fun pick(which: String, v: String): JSONObject = JSONObject().put("output", JSONObject().put(which, v))

    /**
     * The notes under the rows: what the two are, and how fast the making goes (item 259) where a filter of Mandarin's
     * own is set; with PCM as DSD[dsdOut] on, the note says they are the DSD's, its speed said under PCM as DSD instead.
     */
    fun notes(dsdOut: Int, filter: String, hires: String?, making: String?): List<String> = listOfNotNull(
        if (dsdOut != 0) "With PCM as DSD$dsdOut on, these are the filters each track is upsampled with on its way to DSD$dsdOut: by its own rate, the first or the second."
        else "Each track is upsampled in the filter for its own rate: 44.1 and 48 kHz in the first, 88.2 kHz and up in the second.",
        if (dsdOut == 0 && (filter != "standard" || (hires != null && hires != "standard"))) making else null,
    )
}
