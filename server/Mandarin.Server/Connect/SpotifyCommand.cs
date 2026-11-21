// SpotifyCommand.cs — Spotify Connect's rules asked directly (bug list items 142, 501), through `mandarin-server score`
// (Identify/ScoreCommand.cs), a line of JSON in and a line out (test/Mandarin.Tests/SpotifyConnectRulesTests.cs):
//
//   { fn: "spotify",
//     follows: [{ playback, last, want, playing_in, room: { live, state } | null, starting }]   SpotifyFollow.Decide
//     proofs: [[s32 sample, …]]                       SoloistProof: each list of samples (interleaved stereo) heard afresh
//     builds: [{ version, exists, today }]            SoloistDownload.Expires and Plan
//     prefs: [text | null]                            Soloist.AskQuality (lossless, or each's quality) on an account's prefs file as it was (null: none)
//     prefs_quality: [quality]                        the quality asked of each of prefs (item 145)
//     entities: [JSON text]                           Soloist.Entity: a track as Soloist's WebSocket says it
//     cleans: [[line, key]]                           Soloist.Clean
//     paces: [[[frames, nowMs, leadMs], …]]          SoloistPace (item 146): each read's wait, a pace per list
//     rooms: [target | null]                          SpotifyRoomPlan.For (item 501): what a room with that target is sent
//     reads: [query] }                                SpotifyRoomPlan.Read: the sound a stream's address asks for
//   → { follows, proofs, builds: [{ expires, plan }], prefs: [{ changed, text }], entities, cleans, paces,
//       rooms: [{ rate, bits, factor, shape, query, words }], reads: [the same] }
using System.Globalization;
using System.Text.Json;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Connect;

internal static class SpotifyCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();
    private static string S(object? v) => v as string ?? "";

    /* Each list in the job answered in the same order. */
    public static JsObj Run(JsObj job)
    {
        var o = new JsObj();
        o["follows"] = L(job["follows"]).Select(f0 =>
        {
            var f = O(f0);
            var room = f["room"] is JsObj r ? new SpotifyRoom(r["live"] is true, S(r["state"])) : null;
            return (object?)SpotifyFollow.Decide(S(f["playback"]), S(f["last"]), S(f["want"]), f["playing_in"] as string, room, f["starting"] is true);
        }).ToList();
        o["proofs"] = L(job["proofs"]).Select(p0 =>
        {
            var proof = new SoloistProof();
            var samples = L(p0).Select(x => (int)(double)x!).ToArray();
            var bytes = new byte[samples.Length * 4];
            for (int i = 0; i < samples.Length; i++) BitConverter.TryWriteBytes(bytes.AsSpan(i * 4), samples[i]);
            proof.See(bytes);
            return (object?)proof.Says();
        }).ToList();
        o["builds"] = L(job["builds"]).Select(b0 =>
        {
            var b = O(b0);
            var expires = SoloistDownload.Expires(S(b["version"]));
            var x = new JsObj();
            x["expires"] = expires?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            x["plan"] = SoloistDownload.Plan(b["exists"] is true, expires, DateOnly.ParseExact(S(b["today"]), "yyyy-MM-dd", CultureInfo.InvariantCulture));
            return (object?)x;
        }).ToList();
        var qualities = L(job["prefs_quality"]);
        o["prefs"] = L(job["prefs"]).Select((t, i) => Prefs(t, i < qualities.Count ? S(qualities[i]) : "lossless")).ToList();
        o["entities"] = L(job["entities"]).Select(e0 =>
        {
            using var doc = JsonDocument.Parse(S(e0));
            if (Soloist.Entity(doc.RootElement) is not { } t) return null;
            var x = new JsObj();
            x["title"] = t.Title; x["artists"] = t.Artists; x["album"] = t.Album; x["cover"] = t.Cover; x["duration"] = t.Duration; x["uri"] = t.Uri;
            return (object?)x;
        }).ToList();
        o["cleans"] = L(job["cleans"]).Select(c0 => { var c = L(c0); return (object?)Soloist.Clean(S(c.ElementAtOrDefault(0)), S(c.ElementAtOrDefault(1))); }).ToList();
        o["paces"] = L(job["paces"]).Select(steps =>
        {
            var pace = new SoloistPace();
            return (object?)L(steps).Select(st => { var x = L(st); return (object?)(double)pace.Next((long)Tags.Js.ToNumber(x[0]), (long)Tags.Js.ToNumber(x[1]), (int)Tags.Js.ToNumber(x[2])); }).ToList();
        }).ToList();
        o["rooms"] = L(job["rooms"]).Select(t => Sound(SpotifyRoomPlan.For(t is JsObj ? t : null))).ToList();
        o["reads"] = L(job["reads"]).Select(q => Sound(SpotifyRoomPlan.Read(new QueryCollection(Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(S(q)))))).ToList();
        return o;
    }

    private static object? Sound(RoomSound r)
    {
        var x = new JsObj();
        x["rate"] = (double)r.Rate; x["bits"] = (double)r.Bits; x["factor"] = (double)r.Factor; x["shape"] = r.Shape; x["query"] = r.Query(); x["words"] = r.Words();
        return x;
    }

    // An account's prefs as Soloist left them ([text], null for none), asked for lossless in a folder of its own.
    private static object? Prefs(object? text, string quality)
    {
        var data = Directory.CreateTempSubdirectory("mandarin-spotify-prefs-").FullName;
        try
        {
            var account = Path.Combine(data, "settings", "Users", "abc-user");
            Directory.CreateDirectory(account);
            var file = Path.Combine(account, "prefs");
            if (text is string t) File.WriteAllText(file, t);
            var x = new JsObj();
            x["changed"] = Soloist.AskQuality(data, quality);
            x["text"] = File.Exists(file) ? File.ReadAllText(file) : null;
            return x;
        }
        finally { Directory.Delete(data, recursive: true); }
    }
}
