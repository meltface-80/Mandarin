using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Album write-ups, artist stories, Pitchfork and Qobuz (v0.8.21): the server's readers of each source's
/// pages and answers (Extras/WriteUps*.cs) held to the Node server's, case for case — text (entities,
/// HTML, the name guards, slugs, titles), Qobuz's search and album page, Wikipedia's extracts and its
/// album and artist rules, Pitchfork's review pages, lists and feed, the three sources made one, and
/// MusicBrainz's year and the Qobuz app's link. The jobs its JavaScript made from a seeded generator are
/// kept as they were sent (test/golden/writeups-csharp.jobs.json.gz), the Node server's answers to them
/// beside them (writeups-csharp.json) (test/writeups-csharp.test.js, in C#).
/// </summary>
public sealed class WriteupsCsharpTests(WriteupsCsharpTests.Book book) : IClassFixture<WriteupsCsharpTests.Book>
{
    /// <summary>test/golden/writeups-csharp.json, every kept answer asked for by the class's end.</summary>
    public sealed class Book() : KeptBook("writeups-csharp");

    private static readonly Lazy<JsonArray> Jobs = new(() => Golden.Jobs("writeups-csharp"));

    // The job that asked for all of these, sent again: the job and the answer.
    private static async Task<(JsonObject Job, JsonNode Got)> Ask(params string[] keys)
    {
        Needs.Server();
        var job = Jobs.Value.Select(j => j!.AsObject()).Single(j => j.Count == keys.Length + 1 && keys.All(j.ContainsKey));
        return (job, await Golden.Score((JsonObject)job.DeepClone()));
    }

    // Each answer the Node server's (kept), the first that isn't shown with its case.
    private void Same(string what, JsonNode? cases, JsonNode? got)
    {
        var list = cases!.AsArray().ToList();
        book.Kept.Same(what, [.. list.Select((_, i) => (object?)(what + " " + i))], list, [.. got!.AsArray()]);
    }

    [Test]
    public async Task Text_entities_HTML_the_name_guards_slugs_titles()
    {
        var (job, got) = await Ask("normalize", "decode", "strip", "first", "lead", "slug", "title_base", "pairs", "page_titles");
        Same("normalize", job["normalize"], got["normalize"]);
        Same("decode", job["decode"], got["decode"]);
        Same("strip", job["strip"], got["strip"]);
        Same("first", job["first"], got["first"]);
        Same("lead", job["lead"], got["lead"]);
        Same("slug", job["slug"], got["slug"]);
        Same("title_base", job["title_base"], got["title_base"]);
        Same("disambiguator", job["title_base"], got["disambiguator"]);
        Same("loose", job["pairs"], got["loose"]);
        Same("overlap", job["pairs"], got["overlap"]);
        Same("page_title", job["page_titles"], got["page_title"]);
    }

    [Test]
    public async Task Qobuz_the_searchs_album_and_what_its_page_says()
    {
        var (job, got) = await Ask("qobuz_search", "qobuz_pages");
        Same("qobuz_pick", job["qobuz_search"], got["qobuz_pick"]);
        Same("qobuz_page", job["qobuz_pages"], got["qobuz_page"]);
    }

    [Test]
    public async Task Wikipedia_the_extract_the_album_rule_the_artist_rules()
    {
        // The artists' primary names the cases were made with, held to the Node server's.
        var (names, primaries) = await Ask("artist_names");
        Same("artist_primary (to make cases)", names["artist_names"], primaries["artist_primary"]);
        var (job, got) = await Ask("extracts", "wiki_albums", "artist_names", "artist_titles", "artist_extracts");
        Same("extract", job["extracts"], got["extract"]);
        Same("wiki_album", job["wiki_albums"], got["wiki_album"]);
        Same("artist_primary", job["artist_names"], got["artist_primary"]);
        Same("artist_title", job["artist_titles"], got["artist_title"]);
        Same("artist_extract", job["artist_extracts"], got["artist_extract"]);
    }

    [Test]
    public async Task Pitchfork_a_review_pages_score_and_Best_New_Music_and_whose_review_it_is()
    {
        var (artists, primaries) = await Ask("pf_artists");
        Same("pf_primary (to make cases)", artists["pf_artists"], primaries["pf_primary"]);
        var (job, got) = await Ask("pf_pages", "pf_artists", "pf_verdicts");
        Same("pf_parse", job["pf_pages"], got["pf_parse"]);
        Same("pf_primary", job["pf_artists"], got["pf_primary"]);
        Same("pf_verdict", job["pf_verdicts"], got["pf_verdict"]);
    }

    [Test]
    public async Task The_three_sources_made_one_the_write_up_shown_its_source_and_link_the_artists_story_every_page_found()
    {
        var (job, got) = await Ask("combines");
        Same("combine", job["combines"], got["combine"]);
    }

    [Test]
    public async Task Pitchforks_lists_the_listings_state_the_RSS_feed_the_artist_from_an_address_newest_first_the_search()
    {
        var (titles, slugs) = await Ask("slug");
        Same("slug (to make cases)", titles["slug"], slugs["slug"]);
        var (job, got) = await Ask("listings", "rss", "review_urls", "items", "sorts", "matches");
        Same("state", job["listings"], got["state"]);
        Same("listing", job["listings"], got["listing"]);
        Same("rss", job["rss"], got["rss"]);
        Same("from_url", job["review_urls"], got["from_url"]);
        Same("item_out", job["items"], got["item_out"]);
        Same("newest", job["sorts"], got["newest"]);
        Same("match", job["matches"], got["match"]);
    }

    [Test]
    public async Task MusicBrainzs_year_and_the_Qobuz_apps_link()
    {
        var (job, got) = await Ask("years", "canon", "album_ids");
        Same("year", job["years"], got["year"]);
        Same("canon", job["canon"], got["canon"]);
        Same("album_id", job["album_ids"], got["album_id"]);
    }
}
