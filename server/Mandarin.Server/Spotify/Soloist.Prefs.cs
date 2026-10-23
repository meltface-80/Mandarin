// Soloist.Prefs.cs — Lossless, asked for (bug list item 142). Soloist plays Ogg Vorbis at 160 kbps, loudness
// normalised, unless each account's prefs file says otherwise: DATA/settings/Users/<id>-user/prefs, key=value
// lines (as spotifast-lossless's prefs.rs writes them). Mandarin writes Spotify's number for lossless (5) for both
// kinds of network, and normalisation off, before every start; Soloist reads the file as the account signs in, so
// the first time an account is signed in (by the Spotify app) Soloist is started again once to take it up. On a plan
// without lossless Spotify plays what it may, and the samples say lossy (SoloistProof.cs).
using System.Diagnostics;

namespace Mandarin.Server.Spotify;

internal sealed partial class Soloist
{
    internal static readonly (string Key, string Value)[] Lossless =
    [
        ("audio.play_bitrate_enumeration", "5"),
        ("audio.play_bitrate_non_metered_enumeration", "5"),
        ("audio.normalize_v2", "false")
    ];

    /* Every account's prefs under [data] made to ask for lossless; true when one of them changed. */
    internal static bool AskLossless(string data)
    {
        var users = Path.Combine(data, "settings", "Users");
        if (!Directory.Exists(users)) return false;
        bool changed = false;
        foreach (var dir in Directory.GetDirectories(users, "*-user"))
        {
            var file = Path.Combine(dir, "prefs");
            var lines = File.Exists(file) ? File.ReadAllLines(file).ToList() : [];
            var kept = lines.Where(l => !Lossless.Any(k => l.StartsWith(k.Key + "=", StringComparison.Ordinal))).ToList();
            var wanted = kept.Concat(Lossless.Select(k => k.Key + "=" + k.Value)).ToList();
            if (wanted.SequenceEqual(lines)) continue;
            // Another order of the same lines is the same: only a missing or different value is a change.
            var had = lines.Where(l => Lossless.Any(k => l.StartsWith(k.Key + "=", StringComparison.Ordinal))).ToHashSet();
            if (Lossless.All(k => had.Contains(k.Key + "=" + k.Value)) && had.Count == Lossless.Length) continue;
            var tmp = file + ".new";
            File.WriteAllLines(tmp, wanted);
            File.Move(tmp, file, overwrite: true);
            changed = true;
        }
        return changed;
    }

    private bool askedAfterSignIn;

    // Signed in: an account new to Soloist hasn't been asked for lossless yet; asked, Soloist starts again to take it up.
    private void SignedInNow()
    {
        if (askedAfterSignIn) return;
        askedAfterSignIn = true;
        try
        {
            if (!AskLossless(dataDir)) return;
            Log("lossless asked for on the account just signed in: starting Soloist again to take it up");
            Restart();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Log("couldn't ask for lossless: " + e.Message); }
    }

    /* Soloist started again (a new key, a new build, lossless asked for): the run ends and the next begins. */
    public void Restart()
    {
        Process? p;
        lock (gate) p = soloist;
        try { if (p is { HasExited: false }) p.Kill(entireProcessTree: true); }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { /* gone */ }
    }

    // ------------------------------------------------------------ what Now Playing sends

    public Task Play(string uri = "") => uri == "" ? Command("play") : Command("play", "\"uri\":" + System.Text.Json.JsonSerializer.Serialize(uri, SoloistJson.Default.String));
    public Task Pause() => Command("pause");
    public Task Next() => Command("skip_next");
    public Task Previous() => Command("skip_prev");
    public Task Seek(double seconds) => Command("seek", "\"position_ms\":" + Math.Max(0, (long)Math.Round(seconds * 1000)).ToString(System.Globalization.CultureInfo.InvariantCulture));

    /* Where it is in the track now: the position Soloist last said, moved on by the time since while it plays. */
    public double PositionNow()
    {
        var t = Track;
        double p = t.Position;
        if (Playback == "playing" && t.At > 0) p += (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - t.At) / 1000.0;
        return t.Duration > 0 ? Math.Min(p, t.Duration) : p;
    }
}
