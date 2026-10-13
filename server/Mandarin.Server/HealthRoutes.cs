// HealthRoutes.cs — GET /api/health (v0.8.48, stage 5 part 7 of
// docs/specs/csharp-migration.md), from index.js, in the same shape. Open, as
// it was: Docker's health check asks it every minute.
//
//   { ok, version, albums, rooms, ffmpeg, soxr,
//     transcode_cache: { files, bytes, running, queued }, audio_engine, csharp }
//
// The rooms the Node server has found (playback is its until stage 6) and how
// bringing this server to its version went (lib/server/csharp-update.js) come
// with its state (/internal/library); the rest is this server's own: the
// library's count, ffmpeg, the conversions (made here since v0.8.40), and the
// audio engine, found where lib/local/engine.js looks for it (Local/AudioEngine.cs).
using System.Diagnostics;
using Mandarin.Server.Local;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    private static Task<bool> Health(HttpContext ctx, Snapshot s, LibState st)
    {
        var (files, bytes, running, queued) = Transcoder.CacheStats();
        return Send(ctx, new JsonObject
        {
            ["ok"] = true,
            ["version"] = Front.Version,
            ["albums"] = s.Count,
            // The rooms found: the hub's own once this server holds playback (v0.8.49), else as the Node server says them.
            ["rooms"] = Playback.Hub.Current is { } hub ? hub.RoomCount : st.Said["rooms"] is JsonValue r && r.TryGetValue<double>(out var rooms) ? rooms : 0,
            ["ffmpeg"] = Transcoder.FfOk,
            ["soxr"] = Transcoder.Soxr,
            ["transcode_cache"] = new JsonObject { ["files"] = files, ["bytes"] = bytes, ["running"] = running, ["queued"] = queued },
            ["audio_engine"] = AudioEngine.Version(),
            ["csharp"] = st.Said["csharp_update"]?.DeepClone()
        });
    }
}
