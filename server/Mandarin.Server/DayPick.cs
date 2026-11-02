// DayPick.cs — which album is the day's (bug list item 236; HomeRoutes.cs keeps it for the day). Until now it was
// any album of the library, by the day's hash, so it was as likely to be last night's album as one not heard in
// years. The owner's rule:
//
//  - an album never played, or last played more than twelve months ago; never one played lately;
//  - for a newer listener (less than twelve months of plays), nothing like what has been heard lately: no album by
//    an artist, or in a genre, played in the last 30 days.
//
// A newer listener's plays are all inside the twelve months, so for them the first rule leaves the albums never
// played. Where a rule leaves nothing (a small library, nearly all of it heard) it is eased a step at a time: the
// genres first, then the artists, then an album not played for 30 days. Nothing even then: no album of the day.
// The pick among those left is the day's, by its hash, so every device that asks that day is given the same one.
namespace Mandarin.Server;

internal static class DayPick
{
    private const long DayMs = 86_400_000;
    /* Played within this long: heard lately, never the day's album. */
    public const long YearMs = 365 * DayMs;
    /* What a newer listener's recent listening is: the last 30 days, as Home's Recently played row. */
    public const long RecentMs = 30 * DayMs;

    /*
     * The day's album of [albums], by [lastPlayed] (an album's id → its last play, ms) and [firstPlay] (the first play
     * of all, ms, or null), at [now] on [day]; with why it was chosen and how many it was chosen from.
     */
    public static (Album? Pick, string Why, int Pool) Choose(IReadOnlyList<Album> albums, IReadOnlyDictionary<long, long> lastPlayed, long? firstPlay, long now, string day)
    {
        bool Unheard(Album a) => !lastPlayed.TryGetValue(a.Id, out var at) || at < now - YearMs;
        var unheard = albums.Where(Unheard).ToList();
        var newer = firstPlay == null || firstPlay > now - YearMs;
        List<(string Why, List<Album> Pool)> steps = [];
        if (newer)
        {
            var lately = albums.Where(a => lastPlayed.TryGetValue(a.Id, out var at) && at >= now - RecentMs).ToList();
            var artists = lately.Select(a => a.NArtist).Where(n => n.Length > 0).ToHashSet(StringComparer.Ordinal);
            var genres = lately.SelectMany(Genres).ToHashSet(StringComparer.Ordinal);
            bool NewArtist(Album a) => !artists.Contains(a.NArtist);
            steps.Add(("never played, unlike recent listening", unheard.Where(a => NewArtist(a) && !Genres(a).Any(genres.Contains)).ToList()));
            steps.Add(("never played, by an artist not heard lately", unheard.Where(NewArtist).ToList()));
            steps.Add(("never played", unheard));
        }
        else steps.Add(("not played for a year or more", unheard));
        steps.Add(("not played for 30 days", albums.Where(a => !lastPlayed.TryGetValue(a.Id, out var at) || at < now - RecentMs).ToList()));
        foreach (var (why, pool) in steps)
        {
            if (pool.Count == 0) continue;
            var sorted = pool.OrderBy(a => a.Id).ToList();
            return (sorted[(int)(Library.Fnv1a(day) % (uint)sorted.Count)], why, sorted.Count);
        }
        return (null, "every album played in the last 30 days", 0);
    }

    private static IEnumerable<string> Genres(Album a) => a.Genres.Select(g => g.Trim().ToLowerInvariant()).Where(g => g.Length > 0);

    /* For the tests: albums [[id, artist, [genre]]] and plays [[id, ts]] as rules, at [now] on [day]. */
    public static Tags.JsObj Rules(List<object?> albums, List<object?> plays, long now, string day)
    {
        static List<object?> L(object? v) => v as List<object?> ?? [];
        var list = albums.Select(x => L(x)).Select(a => new Album
        {
            Id = (long)Tags.Js.ToNumber(a.ElementAtOrDefault(0)),
            NArtist = Tags.Js.Str(a.ElementAtOrDefault(1)),
            Genres = L(a.ElementAtOrDefault(2)).Select(Tags.Js.Str).ToList(),
        }).ToList();
        var last = new Dictionary<long, long>();
        long? first = null;
        foreach (var p in plays.Select(x => L(x)))
        {
            var id = (long)Tags.Js.ToNumber(p.ElementAtOrDefault(0)); var ts = (long)Tags.Js.ToNumber(p.ElementAtOrDefault(1));
            last[id] = Math.Max(ts, last.GetValueOrDefault(id, long.MinValue));
            first = first == null ? ts : Math.Min(first.Value, ts);
        }
        var (pick, why, pool) = Choose(list, last, first, now, day);
        return new Tags.JsObj { ["pick"] = pick == null ? null : (double)pick.Id, ["why"] = why, ["pool"] = (double)pool };
    }
}
