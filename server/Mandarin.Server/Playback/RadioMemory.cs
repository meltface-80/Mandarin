// RadioMemory.cs — what Random Album Radio has played, and the rule built on
// it (v0.8.38), from lib/radio-memory.js, rule for rule: an album the radio
// played is not played by the radio again for six months (183 days).
//
// Albums only, by their identity (RadioKey: the title and artist as the
// library folds them, so a rescan is the same album), and only the radio's
// own plays: an album you played yourself leans the pick away (heard) but
// never rules it out. Never a dead end: with everything the radio's within
// six months, the album whose radio play is oldest comes round.
//
// Storage and the clock are handed in, as there: the Node server keeps the
// memory in the radio_played table (lib/server/features.js) and saves it
// whole after each play; Load and Save here take the same { key: ms } object.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal sealed class RadioMemory
{
    public const double SixMonthsMs = 183.0 * 24 * 60 * 60 * 1000;

    private readonly Func<double> now;
    private readonly double windowMs;
    private readonly Action<JsObj>? save;
    // A Map: keys in the order first noted.
    private readonly OrderedDictionary<string, double> played = new(StringComparer.Ordinal);

    /* load() → { key: ms } as last saved (or null); save({ key: ms }); now() → ms; windowMs: six months unless set. */
    public RadioMemory(Func<object?>? load, Action<JsObj>? save, Func<double>? now, object? windowMs = null)
    {
        this.now = now ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        this.windowMs = Jv.T(windowMs) ? Jv.Num(windowMs) : SixMonthsMs;
        this.save = save;
        var saved = load?.Invoke();
        if (Jv.T(saved) && saved is JsObj or List<object?>)
        {
            IEnumerable<(string, object?)> entries = saved is JsObj o
                ? o.Keys.Select(k => (k, o[k]))
                : ((List<object?>)saved).Select((v, i) => (i.ToString(System.Globalization.CultureInfo.InvariantCulture), v));
            foreach (var (k, v) in entries)
            {
                var at = Jv.Num(v);
                if (k.Length > 0 && double.IsFinite(at)) played[k] = at;
            }
        }
        Prune();
    }

    // Entries past the window can never exclude anything again.
    private void Prune()
    {
        var cutoff = now() - windowMs;
        foreach (var k in played.Where(e => e.Value <= cutoff).Select(e => e.Key).ToList()) played.Remove(k);
    }

    private void Persist()
    {
        if (save == null) return;
        var out_ = new JsObj();
        foreach (var (k, at) in played) out_[k] = at;
        save(out_);
    }

    /* When the radio last played this album, if inside the window; else null. */
    public double? PlayedAt(string? key)
    {
        if (string.IsNullOrEmpty(key)) return null;
        return played.TryGetValue(key, out var at) && at > now() - windowMs ? at : null;
    }

    /* The radio has just played (or queued) this album. */
    public void Note(string? key)
    {
        if (string.IsNullOrEmpty(key)) return;
        played[key] = now();
        Prune();
        Persist();
    }

    public int Size => played.Count;

    /*
     * One album for the radio from the pool: one the radio hasn't played
     * within the window, and of those one not heard lately when there is one
     * (random() picks); with none free, the one played longest ago. The index
     * in the pool, or -1 for an empty pool.
     */
    public int Pick<T>(IReadOnlyList<T> pool, Func<T, string?> keyOf, Func<T, bool>? heard, Func<double> random)
    {
        if (pool.Count == 0) return -1;
        var free = Enumerable.Range(0, pool.Count).Where(i => PlayedAt(keyOf(pool[i])) == null).ToList();
        if (free.Count > 0)
        {
            var fresh = heard != null ? free.Where(i => !heard(pool[i])).ToList() : free;
            var from = fresh.Count > 0 ? fresh : free;
            var at = (int)Math.Floor(random() * from.Count);
            return at >= 0 && at < from.Count ? from[at] : -1;
        }
        // Everything has been the radio's within six months: the longest ago.
        int best = -1;
        var bestAt = double.PositiveInfinity;
        for (var i = 0; i < pool.Count; i++)
        {
            var t = PlayedAt(keyOf(pool[i])) ?? double.NegativeInfinity;
            if (t < bestAt) { bestAt = t; best = i; }
        }
        return best;
    }

    /*
     * An album's identity for the memory: its title and artist as the library
     * folds them; where the fold empties either, the names as they are, lower
     * case — an empty key could never be remembered.
     */
    public static string RadioKey(object? al)
    {
        var title = Jv.Str(Jv.T(al) ? Jv.Or(Jv.Get(al, "title"), "") : "");
        var artist = Jv.Str(Jv.T(al) ? Jv.Or(Jv.Get(al, "artist"), "") : "");
        var t = Names.Fold(title);
        var a = Names.ArtistKey(artist);
        if (t.Length > 0 && (a.Length > 0 || Js.Trim(artist).Length == 0)) return t + "|" + a;
        if (Js.Trim(title).Length == 0 && Js.Trim(artist).Length == 0) return "";
        return "raw|" + Js.Lower(Js.Trim(title)) + "|" + Js.Lower(Js.Trim(artist));
    }
}
