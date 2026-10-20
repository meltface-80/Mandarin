// HealthRoutes.cs — GET /api/health (v0.8.48, stage 5 part 7 of
// old/csharp-migration.md), from index.js, in the same shape. Open, as
// it was: Docker's health check asks it every minute.
//
//   { ok, version, albums, rooms, ffmpeg, soxr,
//     transcode_cache: { files, bytes, running, queued }, audio_engine, csharp }
//
// The rooms are the hub's (Playback/Hub.cs); the rest: the library's count,
// ffmpeg, the conversions (made here since v0.8.40), and the audio engine,
// found where lib/local/engine.js looked for it (Local/AudioEngine.cs). Since
// v0.8.50 (stage 7) there is no csharp field: no other server's version to match.
// `mandarin-server --health` (Program.cs) is the image's health check: one GET
// of this, 0 when it answers 200.
using Mandarin.Server.Local;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    private static Task<bool> Health(HttpContext ctx, Snapshot s, LibState st)
    {
        var (files, bytes, running, queued) = Transcoder.CacheStats();
        var o = new JsonObject
        {
            ["ok"] = true,
            ["version"] = Server.Version,
            ["albums"] = s.Count,
            // The rooms found, the hub's (v0.8.49).
            ["rooms"] = Playback.Hub.Current is { } hub ? hub.RoomCount : 0,
            ["ffmpeg"] = Transcoder.FfOk,
            ["soxr"] = Transcoder.Soxr,
            ["transcode_cache"] = new JsonObject { ["files"] = files, ["bytes"] = bytes, ["running"] = running, ["queued"] = queued },
            ["audio_engine"] = AudioEngine.Version()
        };
        return Send(ctx, o);
    }

    /*
     * `mandarin-server --health`: the image's health check (the Dockerfile's
     * HEALTHCHECK), in place of `node -e` — one GET of /api/health on this
     * machine's port, its answer printed; 0 when it is 200, 1 when it isn't or
     * nothing answers within the check's time.
     */
    public static async Task<int> HealthCommand(int port)
    {
        try
        {
            using var http = new HttpClient(new SocketsHttpHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(4) };
            using var r = await http.GetAsync($"http://127.0.0.1:{port}/api/health");
            Console.WriteLine(await r.Content.ReadAsStringAsync());
            return r.StatusCode == System.Net.HttpStatusCode.OK ? 0 : 1;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            Console.Error.WriteLine($"no answer from port {port}: {e.Message}");
            return 1;
        }
    }
}
