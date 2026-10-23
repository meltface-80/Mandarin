// SpotifyCommand.cs — Spotify's rules asked directly (bug list item 142), through `mandarin-server score`
// (Identify/ScoreCommand.cs), a line of JSON in and a line out (test/Mandarin.Tests/SpotifyRulesTests.cs):
//
//   { fn: "spotify",
//     follows: [{ playback, last, want, playing_in, room: { live, state } | null, starting }]   SpotifyFollow.Decide
//     proofs: [[s32 sample, …]]                       SoloistProof: each list of samples (interleaved stereo) heard afresh
//     builds: [{ version, exists, today }]            SoloistDownload.Expires and Plan
//     prefs: [text | null]                            Soloist.AskLossless on an account's prefs file as it was (null: none)
//     entities: [JSON text]                           Soloist.Entity: a track as Soloist's WebSocket says it
//     cleans: [[line, key]] }                         Soloist.Clean
//   → { follows, proofs, builds: [{ expires, plan }], prefs: [{ changed, text }], entities, cleans }
using System.Globalization;
using System.Text.Json;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Spotify;

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
        o["prefs"] = L(job["prefs"]).Select(Prefs).ToList();
        o["entities"] = L(job["entities"]).Select(e0 =>
        {
            using var doc = JsonDocument.Parse(S(e0));
            if (Soloist.Entity(doc.RootElement) is not { } t) return null;
            var x = new JsObj();
            x["title"] = t.Title; x["artists"] = t.Artists; x["album"] = t.Album; x["cover"] = t.Cover; x["duration"] = t.Duration; x["uri"] = t.Uri;
            return (object?)x;
        }).ToList();
        o["cleans"] = L(job["cleans"]).Select(c0 => { var c = L(c0); return (object?)Soloist.Clean(S(c.ElementAtOrDefault(0)), S(c.ElementAtOrDefault(1))); }).ToList();
        return o;
    }

    // An account's prefs as Soloist left them ([text], null for none), asked for lossless in a folder of its own.
    private static object? Prefs(object? text)
    {
        var data = Directory.CreateTempSubdirectory("mandarin-spotify-prefs-").FullName;
        try
        {
            var account = Path.Combine(data, "settings", "Users", "abc-user");
            Directory.CreateDirectory(account);
            var file = Path.Combine(account, "prefs");
            if (text is string t) File.WriteAllText(file, t);
            var x = new JsObj();
            x["changed"] = Soloist.AskLossless(data);
            x["text"] = File.Exists(file) ? File.ReadAllText(file) : null;
            return x;
        }
        finally { Directory.Delete(data, recursive: true); }
    }
}
