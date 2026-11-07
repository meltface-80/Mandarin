// Library.Artists.cs — acts that share a name, told apart in the library (item 330). An album's lead name (the first of
// its credit's names) is what the Artists wall, an artist's page and "More by" go by; where the albums of one name are
// filed under artists MusicBrainz tells apart (two ids or more: Airbag from Norway and Airbag from Argentina, ArtistRows.cs),
// each of those albums is its act's (Album.ActId), with a word to tell the acts apart (Album.ActNote): MusicBrainz's own,
// else the years of the act's albums. A name only one act has is left as it was: one artist, by its name.
using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Library
{
    private static void Acts(SqliteConnection c, Snapshot s)
    {
        Dictionary<long, (string? Mbid, string? Note)> artists;
        try { artists = ArtistRows.All(c); }
        catch (SqliteException) { return; }   // a database without the table yet
        foreach (var name in s.Albums.Where(al => !al.Compilation && al.ArtistNames.Length > 0).GroupBy(al => al.ArtistNames[0].N, StringComparer.Ordinal))
        {
            // Each album's artist, where its credit is still the one it was filed by (one renamed by hand is by its new name).
            long? Of(Album al) => al.ArtistId is long id && artists.ContainsKey(id) && Names.ArtistKey(al.Artist) == Names.ArtistKey(al.ScannedArtist) ? id : null;
            var albums = name.ToList();
            var told = albums.Select(Of).OfType<long>().Select(id => artists[id].Mbid).OfType<string>().Distinct(StringComparer.Ordinal).Count();
            if (told < 2) continue;
            foreach (var act in albums.GroupBy(al => Of(al) ?? 0))
            {
                var note = act.Key != 0 ? artists[act.Key].Note : null;
                note ??= Years(act) ?? "";   // "": shared, with nothing to say of it
                foreach (var al in act) { al.ActId = act.Key != 0 ? act.Key : null; al.ActNote = note; }
            }
        }
    }

    /* The years an act's albums are from ("2004–2016", "2009"); null where none says. */
    private static string? Years(IEnumerable<Album> albums)
    {
        var years = albums.Select(al => al.Year).OfType<long>().Where(y => y > 0).ToList();
        if (years.Count == 0) return null;
        long first = years.Min(), last = years.Max();
        return first == last ? first.ToString(CultureInfo.InvariantCulture) : $"{first.ToString(CultureInfo.InvariantCulture)}–{last.ToString(CultureInfo.InvariantCulture)}";
    }

    /* The key an album's lead act goes by on the Artists wall: its name, or, where acts share it, the name and its act. */
    public static string ActKey(Album al) => al.ArtistNames.Length == 0 ? "" : al.ActNote != null ? al.ArtistNames[0].N + "#" + (al.ActId ?? 0).ToString(CultureInfo.InvariantCulture) : al.ArtistNames[0].N;

    /* Whether [al] is by act [id] where acts share its lead name ([id] null: the act with no MusicBrainz id); true where they don't. */
    public static bool ByAct(Album al, long? id) => al.ActNote == null || al.ActId == id;

    /* [o], an artist as a list shows it ([key] what it is listed by, [al] an album of it), given its act's id and word
       where acts share its name: artist_id (0: the act MusicBrainz says nothing of) and note. */
    private static JsonObject WithAct(JsonObject o, string key, Album al)
    {
        if (al.ActNote == null || key != ActKey(al)) return o;
        o["artist_id"] = al.ActId ?? 0;
        if (al.ActNote.Length > 0) o["note"] = al.ActNote;
        return o;
    }

    /* ?artist_id=: the act asked for where acts share a name (0: the one with no MusicBrainz id); not given, every act. */
    private static (bool Given, long? Id) ActOf(HttpContext ctx) =>
        long.TryParse(Q(ctx, "artist_id"), NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? (true, id == 0 ? null : id) : (false, null);
}
