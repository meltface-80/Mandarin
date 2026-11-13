// CoverCatalogues.cs — the three catalogues as the cover finder asks them
// (AutoCovers.cs, item 409): ArtFind.cs's questions, each kept to what its
// service asks of a program that asks by itself, unlike the album editor's
// one search when you press Find.
//
//   - MusicBrainz through MusicBrainz.Ask, as every request to it is: one a
//     second at musicbrainz.org (Lookups.MbWait, the whole server's), the
//     app's name as User-Agent, and not at all while it rests after a 503.
//   - The Cover Art Archive likewise one a second, with the same User-Agent.
//   - iTunes one every 3.2 seconds (ITunes.GapMs, Apple's twenty a minute);
//     a 403 or 429 rests it a quarter of an hour (ITUNES_PAUSE_MS), said once.
//   - Deezer a quarter of a second apart (its own limit is fifty in five);
//     its "quota" answer (error code 4) is a refusal like iTunes's.
//
// The addresses ArtFind writes are the real services'; where the configuration
// points a service elsewhere (the tests' stand-ins: ITUNES_URL, DEEZER_URL,
// MUSICBRAINZ_URL, COVERART_URL) they are asked there, without the gaps, as
// ITunes.cs and MusicBrainz.cs do. A service that didn't answer, or rests,
// marks the album's look Short: what it found isn't the whole answer, so a
// look that found nothing sure is not remembered as "nothing to find".
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal sealed class CoverCatalogues
{
    public const string Itunes = "https://itunes.apple.com", Deezer = "https://api.deezer.com",
        Mb = MusicBrainz.DefaultBase, Caa = "https://coverartarchive.org";

    /* One album's look: whether a catalogue failed to answer it whole. */
    public sealed class Look { public volatile bool Short; }

    private sealed class Service(string name, string real, string? said, int gapMs)
    {
        public readonly string Name = name, Real = real, Base = (string.IsNullOrEmpty(said) ? real : said).TrimEnd('/');
        public readonly int Gap = string.IsNullOrEmpty(said) || said.TrimEnd('/') == real ? gapMs : 0;
        public long Last, PausedUntil;
        public readonly object Slot = new();
    }

    private readonly Service itunes, deezer, mb, caa;
    private readonly Service[] all;
    private readonly string userAgent;
    private readonly Action<string> log;
    private readonly long itunesPause = long.TryParse(Environment.GetEnvironmentVariable("ITUNES_PAUSE_MS"), out var ms) && ms > 0 ? ms : ITunes.PauseMs;

    public CoverCatalogues(string? itunesUrl, string? deezerUrl, string? mbUrl, string? caaUrl, string version, Action<string> log)
    {
        itunes = new Service("iTunes", Itunes, itunesUrl, ITunes.GapMs);
        deezer = new Service("Deezer", Deezer, deezerUrl, 250);
        mb = new Service("MusicBrainz", Mb, mbUrl, 0);   // MusicBrainz.Ask keeps its second
        caa = new Service("the Cover Art Archive", Caa, caaUrl, 1100);
        all = [itunes, deezer, mb, caa];
        userAgent = $"Mandarin/{version} ( https://github.com/meltface-80/Mandarin )";
        this.log = log;
    }

    private static long Now => Environment.TickCount64;

    /* [url] as it is asked here: a real service's address at the one the configuration names. */
    public string Here(string url)
    {
        foreach (var s in all)
            if (s.Base != s.Real && url.StartsWith(s.Real, StringComparison.Ordinal)) return s.Base + url[s.Real.Length..];
        return url;
    }

    /* The service an address is (asked here), or null: the longest base it starts with (the tests' are under one another). */
    private Service? Of(string url) => all.Where(s => url.StartsWith(s.Base + "/", StringComparison.Ordinal) || url == s.Base).MaxBy(s => s.Base.Length);

    /* ArtFind's get for one album's look. */
    public ArtFind.Get For(Look look) => async url =>
    {
        var u = Here(url);
        var s = Of(u);
        object? answer;
        try
        {
            if (s == mb) return await MusicBrainz.Ask(mb.Base, u, [("User-Agent", userAgent), ("Accept", "application/json")], 9000);
            if (s != null)
            {
                if (Now < Volatile.Read(ref s.PausedUntil)) throw new LookupError($"{s.Name} asked us to wait") { Paused = true };
                await Turn(s);
            }
            answer = await Lookups.Json(u, [("User-Agent", userAgent), ("Accept", "application/json")], 9000);
        }
        catch (LookupError e) when (s != null && s != mb && e.Status is 403 or 429) { throw Refused(look, s); }
        catch (LookupError e) when (e.Paused || e.Status is 0 or >= 500)
        {
            // Not there, resting, or not answering: this look isn't the whole answer.
            look.Short = true;
            throw;
        }
        // Deezer's refusal comes as an answer: { error: { code: 4, "Quota limit exceeded" } }.
        if (s == deezer && answer is JsObj o && o["error"] is JsObj err && Js.ToNumber(err["code"]) == 4) throw Refused(look, s);
        return answer;
    };

    /* A service that said too many: rested a quarter of an hour, said once. */
    private LookupError Refused(Look look, Service s)
    {
        look.Short = true;
        if (Interlocked.Exchange(ref s.PausedUntil, Now + itunesPause) < Now)
            log($"[covers] {s.Name} asked us to slow down; asking it again in a quarter of an hour");
        return new LookupError($"{s.Name} asked us to slow down") { Status = 429, Paused = true };
    }

    /* One after another, a service's gap apart, however many ask at once. */
    private static async Task Turn(Service s)
    {
        if (s.Gap <= 0) return;
        long at;
        lock (s.Slot)
        {
            at = Math.Max(Now, s.Last + s.Gap);
            s.Last = at;
        }
        var wait = at - Now;
        if (wait > 0) await Task.Delay(TimeSpan.FromMilliseconds(wait));
    }

    /* Where a sure cover came from, as album_edits.art_source keeps it (auto:itunes, auto:deezer, auto:caa), and its name in the log. */
    public static (string Source, string Name)? SourceOf(object? candidateSource) => (candidateSource as string) switch
    {
        "Apple Music" => ("auto:itunes", "iTunes"),
        "Deezer" => ("auto:deezer", "Deezer"),
        "MusicBrainz" => ("auto:caa", "the Cover Art Archive"),
        _ => null
    };
}
