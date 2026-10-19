using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// A classical album set out as works and movements (bug list item 48, Works.cs, Tags/Classical.cs):
/// from the files' WORK and MOVEMENT tags, or from their titles where the files carry none; the
/// composers, conductors and performers gathered for the page's head; and the album's page answering
/// with them, the tracks' rows holding what the tags said.
/// </summary>
public sealed class WorksTests
{
    private static object T(string title, string? work = null, string? movement = null, int? no = null, string? composer = null, string artist = "Kronos Quartet", int disc = 1, string? performers = null, string? conductor = null) =>
        new { title, artist, disc, length = 60, composer, conductor, work, movement, movement_no = no, performers };

    private static async Task<JsonNode> Works(string artist, params object[] tracks) =>
        await Score.Run(new { fn = "works", artist, tracks });

    private static IEnumerable<string?> Titles(JsonNode? works) => works.Items().Select(w => w.Str("title"));
    private static IEnumerable<string?> Movements(JsonNode? work) => (work?["movements"]).Items().Select(m => m.Str("title"));

    [Test]
    public async Task From_the_tags_a_one_track_work_and_a_work_of_four_movements_numbered_where_the_name_lacks_it()
    {
        const string q1 = "String Quartet No. 1, Op. 62 \"Already It Is Dusk\"", q2 = "String Quartet No. 2, Op. 64 \"Quasi una fantasia\"";
        var r = await Works("Kronos Quartet",
            T(q1, work: q1, composer: "Henryk Górecki", performers: "Kronos Quartet"),
            T(q2 + ": I. Largo sostenuto – Mesto", work: q2, movement: "Largo sostenuto – Mesto", no: 1, composer: "Henryk Górecki", performers: "Kronos Quartet"),
            T(q2 + ": II. Deciso – Energico", work: q2, movement: "II. Deciso – Energico", no: 2, composer: "Henryk Górecki", performers: "Kronos Quartet"),
            T(q2 + ": III. Arioso", work: q2, no: 3, composer: "Henryk Górecki", performers: "Kronos Quartet"),
            T("IV. Allegro", work: q2, no: 4, composer: "Henryk Górecki", performers: "Kronos Quartet"));
        Assert.Equal([q1, q2], Titles(r["works"]));
        var one = r["works"]![0]!;
        Assert.Equal([q1], Movements(one));
        Assert.Equal(60, one.Num("length"));
        Assert.Equal("Henryk Górecki", one.Str("composer"));
        var two = r["works"]![1]!;
        // The name as tagged, the numeral put on where the tag lacks it; the title's front taken off where there is no name; the title as it is otherwise.
        Assert.Equal(["I. Largo sostenuto – Mesto", "II. Deciso – Energico", "III. Arioso", "IV. Allegro"], Movements(two));
        Assert.Equal([1, 2, 3, 4], two["movements"].Items().Select(m => (int)m.Num("track")!));
        Assert.Equal(240, two.Num("length"));
        Assert.Equal(["Kronos Quartet"], two["performers"].Items().Select(p => (string?)p));
        // The head: the composer; the performers once, the album's own artist not repeated; no conductor.
        Assert.Equal(["Henryk Górecki"], r["composers"].Items().Select(c => (string?)c));
        Assert.Equal(["Kronos Quartet"], r["performers"].Items().Select(c => (string?)c));
        Assert.Empty(r["conductors"].Items());
    }

    [Test]
    public async Task From_the_titles_numbered_movements_group_a_compilations_dashes_do_not_and_a_composer_lets_unnumbered_ones_group()
    {
        // "Work: I. Movement" twice over, on a disc each, the second work on the second disc.
        var r = await Works("Berliner Philharmoniker",
            T("Symphony No. 5 in C minor, Op. 67: I. Allegro con brio", artist: "Berliner Philharmoniker"),
            T("Symphony No. 5 in C minor, Op. 67: II. Andante con moto", artist: "Berliner Philharmoniker"),
            T("Symphony No. 5 in C minor, Op. 67 - III. Allegro", artist: "Berliner Philharmoniker"),
            T("Leonore Overture No. 3", artist: "Berliner Philharmoniker"),
            T("Symphony No. 7 in A major, Op. 92: 1. Poco sostenuto", artist: "Berliner Philharmoniker", disc: 2),
            T("Symphony No. 7 in A major, Op. 92: 2. Allegretto", artist: "Berliner Philharmoniker", disc: 2));
        Assert.Equal(["Symphony No. 5 in C minor, Op. 67", null, "Symphony No. 7 in A major, Op. 92"], Titles(r["works"]));
        Assert.Equal(["I. Allegro con brio", "II. Andante con moto", "III. Allegro"], Movements(r["works"]![0]));
        Assert.Equal(["Leonore Overture No. 3"], Movements(r["works"]![1]));
        Assert.Equal(2, r["works"]![2].Num("disc"));
        Assert.Empty(r["composers"].Items());
        Assert.Empty(r["performers"].Items());

        // A compilation's "Artist - Title": nothing numbered, no composer, so each track is its own.
        var pop = await Works("Various Artists", T("Oasis - Wonderwall", artist: "Oasis"), T("Oasis - Live Forever", artist: "Oasis"), T("Blur - Parklife", artist: "Blur"));
        Assert.Equal([null, null, null], Titles(pop["works"]));
        Assert.Equal(["Oasis - Wonderwall"], Movements(pop["works"]![0]));

        // Movements unnumbered, but the tracks name a composer: the shared front is the work.
        var named = await Works("Jacqueline du Pré",
            T("Cello Concerto in E minor, Op. 85: Adagio – Moderato", composer: "Edward Elgar", artist: "Jacqueline du Pré"),
            T("Cello Concerto in E minor, Op. 85: Lento – Allegro molto", composer: "Edward Elgar", artist: "Jacqueline du Pré"));
        Assert.Equal(["Cello Concerto in E minor, Op. 85"], Titles(named["works"]));
        Assert.Equal(["Adagio – Moderato", "Lento – Allegro molto"], Movements(named["works"]![0]));
        Assert.Equal("Edward Elgar", named["works"]![0].Str("composer"));
    }

    [Test]
    public async Task Several_composers_a_conductor_and_the_soloist_each_named_once()
    {
        var r = await Works("Anne-Sophie Mutter",
            T("Violin Concerto in D major, Op. 61: I. Allegro ma non troppo", work: "Violin Concerto in D major, Op. 61", movement: "I. Allegro ma non troppo", composer: "Ludwig van Beethoven",
                artist: "Anne-Sophie Mutter, Berliner Philharmoniker", conductor: "Herbert von Karajan", performers: "Anne-Sophie Mutter (violin); Berliner Philharmoniker"),
            T("Violin Concerto in D major, Op. 61: II. Larghetto", work: "Violin Concerto in D major, Op. 61", movement: "II. Larghetto", composer: "Ludwig van Beethoven",
                artist: "Anne-Sophie Mutter, Berliner Philharmoniker", conductor: "Herbert von Karajan", performers: "Anne-Sophie Mutter (violin); Berliner Philharmoniker"),
            T("Violin Concerto in D major, Op. 77: I. Allegro non troppo", work: "Violin Concerto in D major, Op. 77", movement: "I. Allegro non troppo", composer: "Johannes Brahms",
                artist: "Anne-Sophie Mutter, Berliner Philharmoniker", conductor: "Herbert von Karajan", performers: "Anne-Sophie Mutter (violin); Berliner Philharmoniker", disc: 2));
        Assert.Equal(["Violin Concerto in D major, Op. 61", "Violin Concerto in D major, Op. 77"], Titles(r["works"]));
        Assert.Equal("Ludwig van Beethoven", r["works"]![0].Str("composer"));
        Assert.Equal("Johannes Brahms", r["works"]![1].Str("composer"));
        Assert.Equal("Herbert von Karajan", r["works"]![0].Str("conductor"));
        Assert.Equal(["Ludwig van Beethoven", "Johannes Brahms"], r["composers"].Items().Select(c => (string?)c));
        Assert.Equal(["Herbert von Karajan"], r["conductors"].Items().Select(c => (string?)c));
        // The performers as tagged; the track's own credit only where there are no PERFORMER tags.
        Assert.Equal(["Anne-Sophie Mutter (violin)", "Berliner Philharmoniker"], r["performers"].Items().Select(c => (string?)c));
    }

    [Test]
    public async Task A_tagged_classical_album_scanned_its_page_set_out_as_works()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        const string q2 = "String Quartet No. 2, Op. 64";
        var dir = Path.Combine(lib.Music, "Henryk Górecki", "String Quartets");
        Dictionary<string, object> Tags(int i, string title, string work, string? movement, int? no)
        {
            var d = new Dictionary<string, object> { ["title"] = title, ["artist"] = "Kronos Quartet", ["album"] = "String Quartets", ["track"] = i, ["date"] = "1993", ["genre"] = "Classical",
                ["composer"] = "Henryk Górecki", ["work"] = work, ["performer"] = "Kronos Quartet" };
            if (movement != null) d["movementname"] = movement;
            if (no != null) d["movement"] = no;
            return d;
        }
        Fixtures.Gen(Path.Combine(dir, "01.flac"), seconds: 1, freq: 300, tags: Tags(1, "String Quartet No. 1, Op. 62", "String Quartet No. 1, Op. 62", null, null));
        Fixtures.Gen(Path.Combine(dir, "02.flac"), seconds: 1, freq: 350, tags: Tags(2, q2 + ": I. Largo sostenuto", q2, "Largo sostenuto", 1));
        Fixtures.Gen(Path.Combine(dir, "03.flac"), seconds: 1, freq: 400, tags: Tags(3, q2 + ": II. Deciso", q2, "Deciso", 2));
        await using var s = await LibraryServer.Start(lib);
        var albums = await s.Albums();
        var quartets = albums.FirstOrDefault(a => a.Str("title") == "String Quartets");
        Assert.True(quartets != null, string.Join("; ", albums.Select(a => a.Str("title"))));
        // The tracks' rows hold what the tags said.
        var rows = s.Server.Rows("SELECT composer, work, movement, movement_no, performers FROM tracks WHERE album_id = $1 ORDER BY track_no", quartets.Num("offset"));
        Assert.Equal(["Henryk Górecki", "Henryk Górecki", "Henryk Górecki"], rows.Select(r => (string?)r["composer"]));
        Assert.Equal(["String Quartet No. 1, Op. 62", q2, q2], rows.Select(r => (string?)r["work"]));
        Assert.Equal([null, "Largo sostenuto", "Deciso"], rows.Select(r => (string?)r["movement"]));
        Assert.Equal([null, 1L, 2L], rows.Select(r => r["movement_no"] is long n ? n : (long?)null));
        Assert.Equal(["Kronos Quartet", "Kronos Quartet", "Kronos Quartet"], rows.Select(r => (string?)r["performers"]));
        // The page: the head's names, and the tracks as works.
        var page = await s.Album(quartets.Num("offset")!);
        Assert.Equal(["Henryk Górecki"], page["album"]!["composers"].Items().Select(c => (string?)c));
        Assert.Equal(["Kronos Quartet"], page["album"]!["performers"].Items().Select(c => (string?)c));
        Assert.Null(page["album"]!["conductor"]);
        Assert.Equal(["String Quartet No. 1, Op. 62", q2], Titles(page["works"]));
        Assert.Equal(["I. Largo sostenuto", "II. Deciso"], Movements(page["works"]![1]));
        Assert.Equal([1, 2], page["works"]![1]!["movements"].Items().Select(m => (int)m.Num("track")!));
        // An album with no works answers as it did: nothing of this on Album One.
        var one = await s.Album(albums.First(a => a.Str("title") == "Album One").Num("offset")!);
        Assert.Null(one["works"]);
        Assert.Null(one["album"]!["composers"]);
    }
}
