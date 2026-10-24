// Covers.Ahead.cs — the covers the app asks for most, drawn ahead after a
// library scan: Home's Random and Not played rows pick new albums each time
// it opens, so their covers were seldom drawn yet, and each drawn on the ask
// is an ffmpeg run of 150–185 ms; a row of them added up to a second to Home.
//
// The tiles' two sizes (120, the lists' and the queue's; 300, Home's and the
// walls' on most phones) of every album of the library's whose cover isn't
// drawn yet, one at a time, behind anything asked for: never with the last
// free drawing turn, and waiting while a scan runs (one ends just before it
// says so). On disk (<data>/art, Images.cs), some 20–30 KB an album, the two
// together: about 350 MB for 14,000 albums, drawn in an hour or so.
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Covers
{
    /* The sizes drawn ahead: those the app's tiles ask for (Images.Snap's steps). */
    public static readonly int[] AheadSizes = [120, 300];

    // How many draw at once: as many as there are cores, two to four.
    private static int DrawLimit => Math.Clamp(Environment.ProcessorCount, 2, 4);

    private static int ahead, again;

    /* Set up from the configuration (Jobs.cs): on, except for the tests that haven't asked for it. */
    public static bool AheadOn { get; set; }

    /* An album's cover at this size drawn into `file`: its own, else its placeholder (CoversDrawn.cs). */
    public static async Task<Drawn> DrawAlbum(Album al, string file, int size)
    {
        var how = await Draw(al, file, size);
        return how == Drawn.NoCover ? await DrawPlaceholder(al, file, size) : how;
    }

    /* The covers not drawn yet drawn now, in the background; asked again while it runs, it goes round once more. */
    public static void DrawAhead()
    {
        if (!AheadOn || !Transcoder.FfOk) return;
        Interlocked.Exchange(ref again, 1);
        if (Interlocked.CompareExchange(ref ahead, 1, 0) != 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                // Asked as the server starts (Jobs.cs), before the art folder is set (Images.Use): once it is.
                while (Images.ArtDir.Length == 0) await Task.Delay(250);
                while (Interlocked.Exchange(ref again, 0) == 1) await AheadPass();
            }
            catch (Exception e) { Server.Log($"[art] drawing ahead: {e.GetType().Name}: {e.Message}"); }
            finally { Interlocked.Exchange(ref ahead, 0); }
        });
    }

    private static bool Scanning() => Scans.State["running"] is JsonValue rv && rv.TryGetValue<bool>(out var on) && on;

    private static async Task AheadPass()
    {
        if (await Library.CurrentCopy() is not { } s) return;
        int drawn = 0;
        foreach (var al in s.Albums)
        {
            if (al.Transient || al.Service != null || !al.ImageKey.StartsWith("al-", StringComparison.Ordinal)) continue;
            foreach (var size in AheadSizes)
            {
                var file = Images.KeptFile(al.ImageKey, size);
                if (File.Exists(file)) continue;
                // Behind anything asked for: a turn is left free for it, and a scan has the machine to itself.
                while (Drawing.CurrentCount < 2 || Scanning()) await Task.Delay(Scanning() ? 1000 : 200);
                if (await DrawAlbum(al, file, size) == Drawn.Yes) drawn++;
            }
        }
        if (drawn > 0) Server.Log($"[art] drew {drawn} cover size(s) ahead");
    }
}
