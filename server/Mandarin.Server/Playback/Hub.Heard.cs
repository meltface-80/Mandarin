// Hub.Heard.cs — whether music is playing now, as the Album Scanner asks it (Identify/AlbumScanner.cs, bug list item
// 411): it starts no album while anything plays. Since item 417b, which rooms and phones those are, by name, for its
// readout and its log; and only Mandarin's own music in a room Mandarin plays (below). Since item 421, /api/health's
// busy.playing too (HealthRoutes.cs), which Mandarin OS's upkeep waits on before an update or a restart.
using Mandarin.Server.Renderers;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

/*
 * A room or phone the Album Scanner waits for (item 417b): its [Id] and [Name] (as the page names it), [Kind] (room or
 * phone), [State] (playing or loading), [Since] when it came to that state and [At] when it was last heard (ms), and
 * what [Says] it ("the Sonos says PLAYING").
 */
internal sealed record Heard(string Id, string Name, string Kind, string State, double Since, double At, string Says);

internal sealed partial class Hub
{
    // A playing room or phone last heard from this long ago at most (a phone reports every ten seconds while it plays,
    // a room is asked every few); a track loading this long at most (MANDARIN_HEARD_LOADING_MS: a test's shorter one).
    private const double HeardMs = 120_000;
    private static readonly double LoadingMs = double.TryParse(Environment.GetEnvironmentVariable("MANDARIN_HEARD_LOADING_MS"),
        System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var l) && l > 0 ? l : 30_000;
    // Asked at every block a fingerprint reads: what was found kept this long (ms), or until something changes (Bump).
    private const long HeardKeptMs = 1000;
    private (long At, List<Heard> List)? heardKept;

    /* How many rooms and phones play Mandarin's music now (Holding). */
    public int PlayingNow() => Holding().Count;

    /*
     * The rooms and phones playing now: playing and heard from lately, or loading a track, begun lately. A phone told to
     * play that never answers (its app closed), or one gone quiet mid-track, isn't held to be playing for ever, as a
     * count of every room playing would; nor a room that says it is loading (a Sonos's TRANSITIONING) at every read
     * (item 417): its state is read every second or few, so it was always heard lately. Paused and stopped never count.
     * Nor (item 417b) a room hidden or switched off in Audio Devices, nor one playing what isn't Mandarin's (Ours): the
     * owner's Sonos Beam, hidden, playing a film from the TV held the Album Scanner all evening.
     */
    public List<Heard> Holding()
    {
        var tick = Environment.TickCount64;
        lock (Gate) if (heardKept is { } k && tick - k.At < HeardKeptMs) return k.List;
        var now = Now();
        List<(string Id, ZoneState St)> playing;
        lock (Gate)
            playing = State.Where(kv => kv.Value.State == "playing" && now - kv.Value.At < HeardMs ||
                kv.Value.State == "loading" && now - (kv.Value.LoadingSince > 0 ? kv.Value.LoadingSince : kv.Value.At) < LoadingMs)
                .Select(kv => (kv.Key, kv.Value)).ToList();
        var list = new List<Heard>();
        if (playing.Count > 0)
        {
            using var c = Db.Open();
            foreach (var (id, st) in playing)
            {
                if (!Ours(id, st) || Zone(id) is not { } z || !InUse(c, z)) continue;
                var phone = Phones.IsPhoneId(id);
                list.Add(new Heard(id, PlaybackRoutes.ZoneName(c, z), phone ? "phone" : "room", st.State, st.Since > 0 ? st.Since : st.At, st.At, Says(id, st)));
            }
            list.Sort((a, b) => Library.Lc(a.Name, b.Name));
        }
        lock (Gate) heardKept = (tick, list);
        return list;
    }

    /*
     * Whether [st] is Mandarin's music: a phone, a Mandarin Bridge or Squeezelite (SlimProto) and a sound device here
     * play nothing else; a Sonos or a renderer only while what it says it plays is one of this server's streams (a
     * renderer not yet read since a restart: while it has a queue of ours). A Sonos on its TV or line-in
     * (x-sonos-htastream:, x-rincon-stream:), another app, a radio, AirPlay: not.
     */
    private bool Ours(string id, ZoneState st)
    {
        if (Phones.IsPhoneId(id) || id.StartsWith("SLIM_", StringComparison.Ordinal) || id.StartsWith(Players.LocalPrefix, StringComparison.Ordinal)) return true;
        if (st.DeviceUri.Length == 0) return IsUpnp(id) && st.OnQueue;
        return OwnUri(st.DeviceUri);
    }

    /* One of this server's streams (/stream/…, at its port), as it gives them to the rooms (Items.cs). */
    public bool OwnUri(string? uri) => Uri.TryCreate(uri, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" && u.Port == Config.Port &&
        u.AbsolutePath.StartsWith("/stream/", StringComparison.Ordinal);

    /* A room in use in Mandarin: one of its outputs neither switched off nor hidden in Audio Devices; a phone, not hidden. */
    private static bool InUse(SqliteConnection c, ZoneInfo z) =>
        z.Outputs.Any(o => Register.Get(c, o.OutputId) is var r && !Devices.Hidden(r) && (z.IsPhone || Devices.Enabled(r)));

    /* What it says, as the log has it: "the Sonos says PLAYING", "the phone says playing". */
    private string Says(string id, ZoneState st)
    {
        if (Phones.IsPhoneId(id)) return "the phone says " + st.State;
        var word = st.State == "loading" ? "TRANSITIONING" : "PLAYING";
        if (id.StartsWith("SLIM_", StringComparison.Ordinal)) return "the Bridge says " + word;
        if (id.StartsWith(Players.LocalPrefix, StringComparison.Ordinal)) return "its sound device says " + word;
        return (IsUpnp(id) ? "the renderer says " : "the Sonos says ") + word;
    }

    /* The room or phone on track [trackId] (a making's: Cpu.MakingWhat), by name; null where none is. */
    public string? PlayingTrack(long trackId)
    {
        List<string> ids;
        lock (Gate) ids = State.Where(kv => kv.Value.TrackId == trackId && kv.Value.State is "playing" or "loading" or "paused").Select(kv => kv.Key).ToList();
        if (ids.Count == 0) return null;
        using var c = Db.Open();
        return ids.Select(Zone).OfType<ZoneInfo>().Select(z => PlaybackRoutes.ZoneName(c, z)).FirstOrDefault();
    }
}
