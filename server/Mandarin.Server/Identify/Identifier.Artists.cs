// Identifier.Artists.cs — the act's own id for albums identified before item 330 (item 333). A match keeps the release's
// lead act's MusicBrainz id since item 330 (MusicBrainz.CandidateOf: artist_mbid, artist_note), and the library files an
// album by it (ArtistRows.cs), so two acts of one name are two artists; a match made before kept the release alone.
// Each such applied match is asked of MusicBrainz once, its release looked up again on the web (the pack keeps no act's
// id), the act's id and MusicBrainz's word for it kept in the match, and the album filed under that act at once. The
// names with the most albums go first: a name with one album is never two acts. It takes turns with identifying new
// albums, and waits whenever they would (the hours allowed, MusicBrainz not answering). The library is read again once a
// minute at most while albums are filed, and once the last is (item 335: it was read again, and the album edits'
// backup written, for every album, every few seconds through a whole library).
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Identifier
{
    private int artistTurn;
    private bool artistsFiled;
    private double artistsToldAt;

    /* Albums filed since the library was last read again: read again now where a minute has gone by, or [done] (the last filed). */
    private async Task ArtistsTold(bool done)
    {
        if (!artistsFiled || (!done && Now - artistsToldAt < 60_000)) return;
        artistsFiled = false;
        artistsToldAt = Now;
        await Library.Tell(new System.Text.Json.Nodes.JsonObject { ["artists"] = true });
    }

    /* The next album whose applied match doesn't yet say its act's id, asked at most once each; null where none is left. */
    private static Album? NextUntold(Snapshot lib)
    {
        HashSet<string> untold;
        using (var c = Db.Open())
            untold = Rows(c, @"SELECT key FROM album_matches WHERE status = 'applied' AND mbid IS NOT NULL AND candidate IS NOT NULL
                               AND candidate NOT LIKE '%""artist_mbid"":%'").Select(r => Js.Str(r[0])).ToHashSet(StringComparer.Ordinal);
        if (untold.Count == 0) return null;
        return lib.Albums.Where(a => a.ArtistNames.Length > 0 && untold.Contains(a.Key))
            .GroupBy(a => a.ArtistNames[0].N, StringComparer.Ordinal)
            .Where(g => lib.Albums.Count(a => a.ArtistNames.Length > 0 && a.ArtistNames[0].N == g.Key) > 1)
            .OrderByDescending(g => lib.Albums.Count(a => a.ArtistNames.Length > 0 && a.ArtistNames[0].N == g.Key))
            .SelectMany(g => g).FirstOrDefault();
    }

    /* [al]'s match asked of MusicBrainz for its act's id and word, kept in the match (null where it names none: asked); [al] filed under that act. */
    private async Task TellArtist(Album al)
    {
        MatchRow? row;
        using (var c = Db.Open()) row = Row(c, al.Key);
        if (row?.Mbid is not string mbid || mbid.Length == 0) return;
        var rel = await Mb.Mb.Release(mbid);   // the web's: the pack keeps the act's name alone
        await Writing(async () =>
        {
            await Task.CompletedTask;
            using var c = Db.Open();
            var now = Row(c, al.Key);
            if (now == null || now.Status != "applied" || now.Candidate is not string text || JsJson.Parse(text) is not JsObj cand) return false;
            cand["artist_mbid"] = rel != null && Js.Truthy(rel["artist_mbid"]) ? rel["artist_mbid"] : null;
            cand["artist_note"] = rel != null && Js.Truthy(rel["artist_note"]) ? rel["artist_note"] : null;
            var json = Js.Json(cand);
            Exec(c, null, "UPDATE album_matches SET candidate = $1 WHERE key = $2", json, al.Key);
            var album = Rows(c, "SELECT artist, mb_artist FROM albums WHERE key = $1", al.Key).FirstOrDefault();
            if (album == null || album[1] is string) return false;   // filed by its files' own id already
            var name = Js.Str(album[0]);
            var (id, note) = ArtistRows.FromMatch(json, name);
            if (id == null) return false;
            var act = ArtistRows.For(c, null, name, id, note);
            Exec(c, null, "UPDATE albums SET mb_artist = $1, artist_id = $2 WHERE key = $3", id, act, al.Key);
            log($"[identify] {al.Artist} — {al.Title}: filed under its act ({id}{(note != null ? ", " + note : "")})");
            artistsFiled = true;
            return false;   // no edit: the library read again by ArtistsTold, a minute at a time
        });
    }
}
