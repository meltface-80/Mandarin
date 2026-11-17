// Identifier.Played.cs — an iBroadcast album matched by sound when it is chosen to play (item 459). The Album Scanner
// identifies iBroadcast's albums by what iBroadcast says of them only, nothing fetched from it in the background (the
// owner's choice); one it leaves unsure (unidentified, or proposed below the apply threshold) is matched by sound
// when the owner chooses it to play: each track's first two minutes read from iBroadcast's stream (Fingerprints.Make
// reads no more), fingerprinted and asked of AcoustID as a file's are (Identifier.Sound.cs), whatever the scanner's
// hours, the music playing being the album's own. Once an album, a run of the server; one at a time; never an album
// matched, edited or turned down by hand; never without an AcoustID key. Match by sound in Edit album
// (Identifier.SoundByHand.cs) reads iBroadcast's tracks the same way.
//
// The stream's address carries the sign-in's token: never logged, never kept; a track that can't be read is said so
// in Mandarin's words, never ffmpeg's (which name the address), and not kept as unreadable (asked again next time).
using Mandarin.Server.Services.IBroadcast;

namespace Mandarin.Server.Identify;

internal sealed partial class Identifier
{
    // Set for the work an album chosen to play starts: its iBroadcast tracks are read, whatever the hour or the music.
    private static readonly AsyncLocal<bool> played = new();
    private readonly SemaphoreSlim playedGate = new(1, 1);
    private readonly HashSet<string> playedTried = new(StringComparer.Ordinal);

    /// <summary>Whether the work going on is for an album chosen to play.</summary>
    private static bool PlayedNow => played.Value;

    /// <summary>The album at [offset] of [s], chosen to play: matched by sound where it is iBroadcast's and unsure.</summary>
    public static void Chosen(Snapshot s, double offset)
    {
        if (Jobs.Identify is { } id && s.Find(offset) is { } al) id.Played(al);
    }

    /// <summary>[al] chosen to play: an iBroadcast album the scan left unsure matched by sound, now, in the background.</summary>
    public void Played(Album al)
    {
        if (al.Service != "ibroadcast" || al.Edited || Sound is null || AcoustId.Key().Length == 0) return;
        var row = Row(al.Key);
        if (row != null && row.Status is not ("unidentified" or "proposed")) return;
        lock (playedTried) if (!playedTried.Add(al.Key)) return;
        _ = Task.Run(async () =>
        {
            await playedGate.WaitAsync();
            try
            {
                played.Value = true;
                log($"[identify] {al.Artist} — {al.Title}: chosen to play, matched by sound from iBroadcast");
                await Identify(al);
            }
            catch (Exception e) when (e is Services.ServiceError or Tags.JsError or HttpRequestException or IOException or InvalidOperationException)
            {
                log($"[identify] {al.Artist} — {al.Title}: not matched by sound: {e.GetType().Name}");
            }
            finally { playedGate.Release(); }
        });
    }

    /// <summary>Where [path]'s sound is read from: the file, or an iBroadcast track's stream (its address made now, never kept).</summary>
    private static async Task<string> SourceOf(string path) =>
        IBroadcastDownloads.Is(path) && Jobs.IBroadcastStreams is { } ib ? await ib.Url(path["ibroadcast://track/".Length..]) : path;
}
