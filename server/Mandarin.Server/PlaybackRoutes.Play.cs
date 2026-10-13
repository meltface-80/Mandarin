// PlaybackRoutes.Play.cs — putting albums and tracks on a zone, Random Album,
// a played track back in the queue, the radio's switch and the album playing
// (api-playback.js, the playing half).
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class PlaybackRoutes
{
    private static readonly HashSet<string> filling = [];

    private static async Task<bool> PlayWrite(Req req, string p)
    {
        var hub = req.Hub;
        var b = req.Body;
        var s = await Library.CurrentCopy() ?? throw new HubError(503, "The library is still being scanned");
        switch (p)
        {
            case "/api/play":
            {
                var offset = Num(b, "offset");
                if (!double.IsFinite(offset)) return await Fail(req.Ctx, 400, "offset required");
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var kind = Need(b["kind"], "kind required");
                if (kind == "radio")
                {
                    await Items.PlayAlbum(hub, id, offset, "play_now");
                    History.SetRadio(req.C, hub.Zone(id)?.ZoneId ?? id, true);
                    return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["action"] = "radio", ["offset"] = offset });
                }
                await Items.PlayAlbum(hub, id, offset, kind);
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["action"] = kind, ["offset"] = offset });
            }
            case "/api/play-track":
            {
                var offset = Num(b, "offset");
                var index = b.ContainsKey("track") ? Phones.JsNumber(b["track"]) : Num(b, "track_index");
                if (!double.IsFinite(offset)) return await Fail(req.Ctx, 400, "offset required");
                if (!double.IsInteger(index) || index < 0) return await Fail(req.Ctx, 400, "track index required");
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var kind = Js.Truthy(b["kind"]) ? Js.Str(b["kind"]) : "play_now";
                var tracks = Tracks.OfAlbum(req.C, s, (long)offset);
                if (tracks.Count == 0) return await Fail(req.Ctx, 404, "That album is no longer in the library");
                if (index >= tracks.Count) return await Fail(req.Ctx, 409, "That track is no longer on the album");
                var t = tracks[(int)index];
                // Play from this track, with the rest of the album after it — what tapping a track on an album page means.
                // { only: true } (Shelf's chosen tracks): this track alone, the rest queued by the page.
                if (Items.NormaliseKind(kind) == "play_now" && !(b["only"] is JsonValue ov && ov.TryGetValue<bool>(out var only) && only))
                    await Items.PlayTracks(hub, id, tracks, "play_now", index);
                else await Items.PlayTracks(hub, id, [t], Items.NormaliseKind(kind));
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["action"] = kind, ["invoked"] = kind, ["track"] = t.Title });
            }
            case "/api/play-multi":
            {
                var list = b["items"] is JsonArray items && items.Count > 0 ? items.Select(i => Num(i as JsonObject, "offset")).ToList()
                    : b["offsets"] is JsonArray offs ? offs.Select(Phones.JsNumber).ToList() : [];
                var ids = list.Where(double.IsFinite).ToList();
                if (ids.Count == 0) return await Fail(req.Ctx, 400, "offsets required");
                var z = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var kind = Need(b["kind"], "kind required");
                if (ids.Count > 400) return await Fail(req.Ctx, 400, "at most 400 albums at a time");
                bool busy;
                lock (filling) busy = !filling.Add(z);
                if (busy) return await FailBusy(req.Ctx);
                try
                {
                    var tracks = new List<PlayTrack>();
                    var failed = 0;
                    foreach (var id in ids)
                    {
                        var t = Tracks.OfAlbum(req.C, s, (long)id);
                        if (t.Count > 0) tracks.AddRange(t); else failed++;
                    }
                    await Items.PlayTracks(hub, z, tracks.Take(1000).ToList(), Items.NormaliseKind(kind));
                    return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["queued"] = ids.Count - failed, ["failed"] = failed, ["total"] = ids.Count, ["first_error"] = failed > 0 ? "Some albums are no longer in the library" : null });
                }
                finally { lock (filling) filling.Remove(z); }
            }
            case "/api/play-unheard":
            {
                // "zone": what the page sent until v0.6.0-RC2 — still taken.
                var zone = Need(Js.Truthy(b["zone_or_output_id"]) ? b["zone_or_output_id"] : b["zone"], "zone_or_output_id required");
                var al = await PlayUnheard(req.C, s, hub, zone);
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["album"] = Library.AlbumJson(s, al) });
            }
            case "/api/queue/play-history-next":
            {
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var t = ResolveTrack(req.C, s, b);
                if (t == null) return await Send(req.Ctx, new JsonObject { ["error"] = "Not in your library", ["unresolved"] = true }, 404);
                await Items.PlayTracks(hub, id, [t], "add_next");
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["track"] = t.Title });
            }
            case "/api/queue/history-multi":
            {
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var found = new List<PlayTrack>();
                var unresolved = new JsonArray();
                foreach (var h in (b["tracks"] as JsonArray ?? []).Take(200))
                {
                    var t = ResolveTrack(req.C, s, h as JsonObject ?? []);
                    if (t != null) found.Add(t); else unresolved.Add(Js.Truthy((h as JsonObject)?["track"]) ? Js.Str((h as JsonObject)!["track"]) : "?");
                }
                if (found.Count > 0) await Items.PlayTracks(hub, id, found, Str(b["kind"]) == "queue" ? "queue" : "add_next");
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["queued"] = found.Count, ["unresolved"] = unresolved, ["failed"] = new JsonArray() });
            }
            case "/api/radio":
            {
                var zoneRaw = Need(b["zone"], "zone required");
                var zone = hub.Zone(zoneRaw)?.ZoneId ?? zoneRaw;
                var enabled = Js.Truthy(b["enabled"]);
                History.SetRadio(req.C, zone, enabled);
                await Send(req.Ctx, new JsonObject { ["ok"] = true, ["enabled"] = enabled, ["radios"] = new JsonObject { ["own"] = enabled, ["roon"] = false } });
                // Switching it on in a silent room starts it.
                var st = hub.Zone(zone)?.State;
                if (enabled && st != null && st.State != "playing") _ = History.RadioTopUp(hub, zone, true).ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);
                return true;
            }
            default: return false;
        }
    }

    private static Task<bool> FailBusy(HttpContext ctx) => Fail(ctx, 409, "Still filling this zone's queue — let that finish before starting another");

    /* Random Album: one not heard in 12 months; until Mandarin has 12 months of history, any album. */
    private static Album PickUnheard(SqliteConnection c, Snapshot s)
    {
        var (albums, _, _) = History.Unplayed(c, s, 1, 12);
        var al = albums.FirstOrDefault() ?? Tracks.Random(s);
        return al ?? throw new HubError(503, "The library is empty");
    }
    private static async Task<Album> PlayUnheard(SqliteConnection c, Snapshot s, Hub hub, string zoneId)
    {
        var al = PickUnheard(c, s);
        await Items.PlayAlbum(hub, zoneId, al.Id, "play_now");
        return al;
    }

    /* The zone a shortcut plays to: the one asked for, else the one last looked at, else one playing, else the first. */
    private static string? PickZone(Req req, string? id)
    {
        var list = req.Hub.Zones().Where(z => Mine(req, z)).ToList();
        var asked = id is { Length: > 0 } ? req.Hub.Zone(id) : null;
        if (asked != null && list.Any(z => z.ZoneId == asked.ZoneId)) return asked.ZoneId;
        var last = Str(Db.Setting(req.C, "lastZone"));
        if (last != null && list.Any(z => z.ZoneId == last)) return last;
        return (list.FirstOrDefault(z => z.Status == "playing") ?? list.FirstOrDefault())?.ZoneId;
    }

    /* A played track, back in the queue: found in the library by its names. */
    private static PlayTrack? ResolveTrack(SqliteConnection c, Snapshot s, JsonObject h)
    {
        var album = Str(h["album"]); var artist = Str(h["artist"]); var track = Str(h["track"]);
        var al = Tracks.Relocate(s, album, artist) ?? Tracks.Relocate(s, album, null);
        var want = Names.Fold(track);
        if (al != null)
        {
            var t = Tracks.OfAlbum(c, s, al.Id).FirstOrDefault(x => Names.Fold(x.Title) == want);
            if (t != null) return t;
        }
        var rows = Library.Rows(c, "SELECT id FROM tracks WHERE lower(title) = lower($1) LIMIT 5", track ?? "").Select(r => Tracks.Of(c, s, (long)r[0]!)).Where(t => t != null).Select(t => t!).ToList();
        return rows.FirstOrDefault(r => string.IsNullOrEmpty(artist) || Names.Fold(r.Artist) == Names.Fold(artist)) ?? rows.FirstOrDefault();
    }

    /* The GET routes that play or say what plays. */
    private static async Task<bool> Plays(Req req, string p)
    {
        var hub = req.Hub;
        var s = await Library.CurrentCopy() ?? throw new HubError(503, "The library is still being scanned");
        switch (p)
        {
            case "/api/pick-unheard":
                return await Send(req.Ctx, new JsonObject { ["album"] = Library.AlbumJson(s, PickUnheard(req.C, s)) });
            case "/api/shortcut/play-random":
            {
                var zone = PickZone(req, req.Q("zone"));
                if (zone == null) return await Fail(req.Ctx, 503, req.Away ? "Away from home, only this phone plays" : "No Sonos rooms found");
                var al = Tracks.Random(s);
                if (al == null) return await Fail(req.Ctx, 503, "The library is empty");
                await Items.PlayAlbum(hub, zone, al.Id, "play_now");
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["album"] = Library.AlbumJson(s, al) });
            }
            case "/api/shortcut/play-unheard":
            {
                var zone = PickZone(req, req.Q("zone"));
                if (zone == null) return await Fail(req.Ctx, 503, req.Away ? "Away from home, only this phone plays" : "No Sonos rooms found");
                var al = await PlayUnheard(req.C, s, hub, zone);
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["album"] = Library.AlbumJson(s, al) });
            }
            case "/api/radio":
            {
                var q = req.Q("zone");
                var zone = q is { Length: > 0 } ? hub.Zone(q)?.ZoneId ?? q : null;
                var on = History.RadioZones(req.C).Where(id => !req.Away || id == req.OwnPhone).ToArray();
                return await Send(req.Ctx, new JsonObject { ["enabled"] = zone != null && History.RadioEnabled(req.C, zone), ["zones"] = new JsonArray(on.Select(x => (JsonNode)x).ToArray()) });
            }
            case "/api/album/now-playing":
            {
                var z = hub.Zone(Need(req.Q("zone") is { } q ? JsonValue.Create(q) : null, "zone required"));
                var st = z?.State;
                if (st == null) return await Send(req.Ctx, new JsonObject { ["album"] = null });
                var t = st.TrackId != null ? Tracks.Of(req.C, s, st.TrackId.Value) : null;
                var al = t != null ? s.Find(t.AlbumId) : Tracks.Relocate(s, st.Album, st.Artist);
                return await Send(req.Ctx, new JsonObject { ["album"] = al != null ? Library.AlbumJson(s, al) : null });
            }
            default: return false;
        }
    }
}
