// Written by tools/quality/parity.js from docs/specs/screens.json (npm run parity -- write); never by hand.
package com.musicd.server.client

/** The screens contract's labels, part 3 of 3 (Contract.kt joins them). */
internal object ContractLabels3 {
    val labels: Map<String, List<String>> = mapOf(
        "shelf-choices.reset" to listOf("Reset shelf"),
        "shelf-choices.chip-remove" to listOf("Remove {choice}"),
        "shelf-choices.tab-genre" to listOf("Genres", "Genres {count}"),
        "shelf-choices.tab-artist" to listOf("Artists", "Artists {count}"),
        "shelf-choices.tab-year" to listOf("Years", "Years {count}"),
        "shelf-choices.tab-label" to listOf("Labels", "Labels {count}"),
        "shelf-choices.tab-type" to listOf("Types", "Types {count}"),
        "shelf-choices.tab-format" to listOf("Formats", "Formats {count}"),
        "shelf-choices.tab-favourite" to listOf("Favourites", "Favourites {count}"),
        "shelf-choices.tab-order" to listOf("Order", "Order {count}"),
        "shelf-choices.clear" to listOf("Clear all"),
        "shelf-choices.genre-sort" to listOf("Most albums first", "A to Z", "Z to A"),
        "shelf-choices.genre" to listOf("{genre}"),
        "shelf-choices.letter" to listOf("Artists under {letter}"),
        "shelf-choices.decade" to listOf("The {decade}s", "Albums with no year"),
        "shelf-choices.label" to listOf("{label}"),
        "shelf-choices.type" to listOf("{type}"),
        "shelf-choices.format" to listOf("{format}"),
        "shelf-choices.favourite" to listOf("Favourites"),
        "shelf-choices.order" to listOf("{order}"),
        "shelf-choices.reshuffle" to listOf("Shuffle again"),
        "shelf-choices.spin" to listOf("Spin the shelf"),
        "shelf-choices.done" to listOf("Show {count} albums", "Show {count} album", "Show the shelf"),
    )
}
