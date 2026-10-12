// PlaybackRoutes.cs — rooms, transport, volume, the queue, and putting albums
// and tracks on a player (lib/server/api-playback.js, v0.8.49, stage 6 of
// docs/specs/csharp-migration.md): every playback route, answered here once
// this server holds the job "playback" (Playback/Hub.cs). Shapes follow
// MusicD Remote's /api, written against Roon's zone model. This file: the
// gate before the routes (another device's phone, away from home), the names
// as the page shows them, a zone's JSON, and the reads; the commands and the
// plays are in the two files beside it.
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class PlaybackRoutes
{
    private static readonly string[] PhoneFields = ["zone", "zone_or_output_id", "output_id", "zone_id", "from", "to", "from_zone", "to_zone"];
    private static readonly string[] HomeOnly = ["/pause-all", "/mute-all", "/group-outputs", "/ungroup-outputs", "/transfer-zone"];
    private static readonly HashSet<string> Gets = ["/api/zones", "/api/outputs", "/api/shortcut/zones", "/api/zone-state", "/api/queue", "/api/radio",
        "/api/album/now-playing", "/api/pick-unheard", "/api/shortcut/play-random", "/api/shortcut/play-unheard"];
    private static readonly HashSet<string> Posts = ["/api/control", "/api/seek", "/api/volume", "/api/zone-settings", "/api/pause-all", "/api/mute-all",
        "/api/group-outputs", "/api/ungroup-outputs", "/api/transfer-zone", "/api/play", "/api/play-track", "/api/play-multi", "/api/play-from-here",
        "/api/play-unheard", "/api/queue/remove", "/api/queue/clear", "/api/queue/move", "/api/queue/play-history-next", "/api/queue/history-multi",
        "/api/radio", "/api/output/standby", "/api/output/convenience-switch"];

    /* The request as the routes read it: the signed-in device, where it is, its body. */
    private sealed class Req(HttpContext ctx, SqliteConnection c, Hub hub, JsonObject body)
    {
        public HttpContext Ctx => ctx;
        public SqliteConnection C => c;
        public Hub Hub => hub;
        public JsonObject Body => body;
        public Device? Device => Auth.DeviceOf(ctx, c);
        public bool Away => Auth.IsAway(ctx);
        public string? OwnPhone => Device is { } d ? Phones.UidFor(d.Id) : null;
        public string? Q(string name) => ctx.Request.Query.TryGetValue(name, out var v) ? v.ToString() : null;
    }

    /* The playback routes: true when answered here. */
    public static async Task<bool> Route(HttpContext ctx)
    {
        var hub = Hub.Current;
        if (hub == null) return false;
        var m = ctx.Request.Method;
        var p = ctx.Request.Path.Value ?? "";
        bool get = HttpMethods.IsGet(m) || HttpMethods.IsHead(m), post = HttpMethods.IsPost(m);
        var phone = p.StartsWith("/api/phone/", StringComparison.Ordinal) && (get ? p == "/api/phone/commands" : post && p is "/api/phone/hello" or "/api/phone/state");
        if (!phone && !(get && Gets.Contains(p)) && !(post && Posts.Contains(p))) return false;
        var body = post ? await Auth.Body(ctx) : [];
        if (body == null) return true;
        try
        {
            using var c = Db.Open();
            var req = new Req(ctx, c, hub, body);
            if (phone) return await PhoneRoute(req, p);
            if (!await Gate(req, p)) return true;
            return get ? await Read(req, p) : await Write(req, p);
        }
        catch (HubError e) { return await Fail(ctx, e.Status, e.Message); }
        catch (Exception e) when (!ctx.Response.HasStarted && e is not OperationCanceledException)
        {
            // As the Node server's wrap() answers what throws.
            Front.Log($"[playback] {p}: {e.GetType().Name}: {e.Message}");
            return await Fail(ctx, 500, e.Message);
        }
    }

    private static Task<bool> Fail(HttpContext ctx, int status, string message) => Send(ctx, new JsonObject { ["error"] = message }, status);
    private static async Task<bool> Send(HttpContext ctx, JsonObject o, int status = 200)
    {
        await Auth.Json(ctx, status, o);
        return true;
    }
    private static string Need(JsonNode? v, string msg)
    {
        if (v == null || v is JsonValue jv && jv.TryGetValue<string>(out var s) && s.Length == 0) throw new HubError(400, msg);
        return Js.Str(v);
    }
    private static string? Str(JsonNode? v) => v == null ? null : Js.Str(v);
    /* Number(b.k): NaN for a key the body doesn't carry (undefined), 0 for one set to null. */
    private static double Num(JsonObject? b, string k) => b != null && b.ContainsKey(k) ? Phones.JsNumber(b[k]) : double.NaN;

    /*
     * The gate (api-playback.js's app.use("/api")): another device's phone
     * only at home, while shared; away from home, only this phone, and none
     * of the home-only routes.
     */
    private static async Task<bool> Gate(Req req, string path)
    {
        var own = req.OwnPhone;
        var ids = new List<string>();
        foreach (var k in PhoneFields)
        {
            if (req.Q(k) is { Length: > 0 } q) ids.Add(q);
            if (req.Body[k] is { } b && Js.Str(b).Length > 0) ids.Add(Js.Str(b));
        }
        if (req.Body["output_ids"] is JsonArray arr) ids.AddRange(arr.Select(x => Js.Str(x)).Where(x => x.Length > 0));
        if (ids.Any(id => req.Hub.Phones.IsPhoneId(id) && id != own && !Reachable(req, id)))
            return await Fail(req.Ctx, 403, "That phone isn't playing for other devices right now") && false;
        if (req.Away && (HomeOnly.Contains(path["/api".Length..]) || ids.Any(id => id != own)))
        {
            await Auth.Json(req.Ctx, 403, new JsonObject { ["error"] = "Away from home, only this phone plays", ["away"] = true });
            return false;
        }
        return true;
    }

    // ------------------------------------------------------------ who sees what

    /* The switch on each device (devices.js enabled): a renderer is off until turned on, a room on unless turned off. */
    private static bool IsEnabled(SqliteConnection c, string id)
    {
        var r = Register.Get(c, id);
        if (r == null || r.Kind == "phone") return true;
        var v = r.Settings["enabled"];
        return r.Kind is "upnp" or "local" ? Tags.Js.StrictEq(v, true) : !Tags.Js.StrictEq(v, false);
    }
    /* A phone others at home may see and play to: on unless switched off on its page. */
    private static bool Shared(SqliteConnection c, string id)
    {
        var r = Register.Get(c, id);
        return r == null || r.Kind != "phone" || !Tags.Js.StrictEq(r.Settings["shared"], false);
    }
    /* A zone is offered while any of its outputs is switched on. */
    private static bool Shown(SqliteConnection c, ZoneInfo z) => z.IsPhone || z.Outputs.Any(o => IsEnabled(c, o.OutputId));
    private static bool Reachable(Req req, string id) => !req.Away && !req.Hub.Phones.IsAway(id) && Shared(req.C, id);
    private static bool Own(Req req, ZoneInfo z) => req.Device?.Id == z.DeviceId;
    private static bool Mine(Req req, ZoneInfo z) => z.IsPhone ? (Own(req, z) || Reachable(req, z.ZoneId)) : !req.Away && Shown(req.C, z);

    // ------------------------------------------------------------ names

    private static string? CustomName(SqliteConnection c, string id) => Register.NameOf(c, id);
    private static bool Renamed(SqliteConnection c, ZoneInfo z) => !z.IsPhone && z.Outputs.Any(o => CustomName(c, o.OutputId) != null);

    /* A group is named from its rooms the way the Sonos code names it: the coordinator first, "A + B", or "A + 2". */
    private static string ZoneName(SqliteConnection c, ZoneInfo z)
    {
        if (!Renamed(c, z)) return z.DisplayName;
        var coord = z.Group?.CoordinatorUid ?? z.ZoneId;
        var names = z.Outputs.Select(o => (Id: o.OutputId, Name: CustomName(c, o.OutputId) ?? o.DisplayName)).ToList();
        names.Sort((a, b) => a.Id == coord ? -1 : b.Id == coord ? 1 : Library.Lc(a.Name, b.Name));
        return names.Count <= 2 ? string.Join(" + ", names.Select(x => x.Name)) : $"{names[0].Name} + {names.Count - 1}";
    }
    private static string NameFor(Req req, ZoneInfo z) => z.IsPhone ? (Own(req, z) ? "This phone" : z.DisplayName) : ZoneName(req.C, z);

    /* named(z, req): the zone with the names the asker sees. */
    private static (string Name, List<(OutputInfo O, string Name)> Outputs) Named(Req req, ZoneInfo z)
    {
        if (z.IsPhone && !Own(req, z)) return (z.DisplayName, z.Outputs.Select(o => (o, o.DisplayName)).ToList());
        if (!z.IsPhone && !Renamed(req.C, z)) return (z.DisplayName, z.Outputs.Select(o => (o, o.DisplayName)).ToList());
        var name = NameFor(req, z);
        return (name, z.Outputs.Select(o => (o, z.IsPhone ? name : CustomName(req.C, o.OutputId) ?? o.DisplayName)).ToList());
    }

    // ------------------------------------------------------------ a zone's JSON

    private static JsonObject ZoneJson(Req req, ZoneInfo z, string name, List<(OutputInfo O, string Name)> outputs)
    {
        var st = z.State;
        var onQueue = st.OnQueue;
        var o = new JsonObject
        {
            ["zone_id"] = z.ZoneId,
            ["display_name"] = name,
            ["state"] = st.State,
            ["is_play_allowed"] = st.State != "playing",
            ["is_pause_allowed"] = st.State is "playing" or "loading",
            ["is_next_allowed"] = onQueue && (st.TrackNumber < st.QueueLength || st.Loop != "disabled" || st.Shuffle),
            ["is_previous_allowed"] = onQueue || st.TrackUri.Length > 0,
            ["is_seek_allowed"] = st.Duration != 0
        };
        // How many tracks are still to come (v0.8.27): Shelf's queue reads itself again when it moves.
        if (onQueue) o["queue_items_remaining"] = Math.Max(0, st.QueueLength - st.TrackNumber);
        o["settings"] = z.Settings;
        o["outputs"] = new JsonArray(outputs.Select(x => { var j = x.O.Short(); j["display_name"] = x.Name; return (JsonNode)j; }).ToArray());
        o["now_playing"] = NowPlaying.Of(req.C, z);
        return o;
    }

    // ------------------------------------------------------------ the reads

    private static async Task<bool> Read(Req req, string p)
    {
        var hub = req.Hub;
        switch (p)
        {
            case "/api/zones":
            {
                var zones = hub.Zones().Where(z => Mine(req, z)).Select(z =>
                {
                    var (name, outs) = Named(req, z);
                    return (JsonNode)new JsonObject
                    {
                        ["zone_id"] = z.ZoneId, ["display_name"] = name, ["state"] = z.Status, ["settings"] = z.Settings,
                        ["outputs"] = new JsonArray(outs.Select(x => { var j = x.O.Json(); j["display_name"] = x.Name; return (JsonNode)j; }).ToArray()),
                        ["is_phone"] = z.IsPhone
                    };
                }).ToArray();
                return await Send(req.Ctx, new JsonObject { ["away"] = req.Away, ["zones"] = new JsonArray(zones) });
            }
            case "/api/outputs":
            {
                var outputs = req.Away ? [] : hub.Outputs().Where(o => IsEnabled(req.C, o.OutputId)).Select(o =>
                {
                    var j = o.Json(true);
                    j["display_name"] = CustomName(req.C, o.OutputId) ?? o.DisplayName;
                    var z = hub.Zone(o.OutputId);
                    j["zone_name"] = z != null ? ZoneName(req.C, z) : o.ZoneName;
                    return (JsonNode)j;
                }).ToArray();
                return await Send(req.Ctx, new JsonObject { ["outputs"] = new JsonArray(outputs) });
            }
            case "/api/shortcut/zones":
            {
                var last = Str(Db.Setting(req.C, "lastZone"));
                var list = hub.Zones().Where(z => Mine(req, z)).ToList();
                var lastZone = last != null && list.Any(z => z.ZoneId == last) ? last : (list.FirstOrDefault(z => z.Status == "playing") ?? list.FirstOrDefault())?.ZoneId;
                return await Send(req.Ctx, new JsonObject
                {
                    ["zones"] = new JsonArray(list.Select(z => (JsonNode)new JsonObject { ["zone_id"] = z.ZoneId, ["display_name"] = NameFor(req, z), ["state"] = z.Status, ["is_phone"] = z.IsPhone }).ToArray()),
                    ["last_zone"] = lastZone
                });
            }
            case "/api/zone-state": return await ZoneStateRoute(req);
            case "/api/queue": return await QueueRoute(req);
            default: return await Plays(req, p);
        }
    }

    /* Zone state, optionally waited for: with ?wait_for=<revision> it answers the moment something changes (or after ~20 s). */
    private static async Task<bool> ZoneStateRoute(Req req)
    {
        var hub = req.Hub;
        var zoneId = req.Q("zone") ?? "";
        hub.Watch(hub.GroupOf(zoneId)?.CoordinatorUid ?? zoneId);
        if (req.Q("wait_for") is { } wf)
        {
            var timeout = (int)Math.Max(0, Math.Min(25000, Phones.JsNumber(req.Q("timeout") is { } t ? JsonValue.Create(t) : null) is var n && !double.IsNaN(n) && n != 0 ? n : 20000));
            await hub.WaitForChange(Phones.JsNumber(JsonValue.Create(wf)), timeout);
        }
        var revision = hub.Revision;
        var z = zoneId.Length > 0 ? hub.Zone(zoneId) : null;
        if (z == null) return await Send(req.Ctx, new JsonObject { ["zone"] = null, ["revision"] = revision });
        // Remember the room people are looking at: the Android app's lock screen, widget and tile mean this one.
        if (Str(Db.Setting(req.C, "lastZone")) != z.ZoneId) QueueStore.SetSetting(req.C, "lastZone", z.ZoneId);
        var (name, outs) = Named(req, z);
        return await Send(req.Ctx, new JsonObject { ["revision"] = revision, ["zone"] = ZoneJson(req, z, name, outs) });
    }

    private static async Task<bool> QueueRoute(Req req)
    {
        var zoneId = Need(req.Q("zone") is { } z ? JsonValue.Create(z) : null, "zone required");
        var q = req.Hub.Queue(zoneId);
        var s = await Library.CurrentCopy();
        JsonObject Row(QueueEntry it)
        {
            var t = it.TrackId != null && s != null ? Tracks.Of(req.C, s, it.TrackId.Value) : null;
            var al = t != null && s != null ? s.Find(t.AlbumId) : null;
            if (it.ImageKey != null) it.ArtUri = "";
            var len = Math.Round(t?.Duration is > 0 ? t.Duration : it.Duration, MidpointRounding.AwayFromZero);
            return new JsonObject
            {
                ["queue_item_id"] = it.Position,
                ["title"] = t?.Title is { Length: > 0 } tt ? tt : it.Title,
                ["subtitle"] = t?.Artist is { Length: > 0 } ta ? ta : it.Artist,
                ["album"] = al?.Title is { Length: > 0 } at ? at : it.Album,
                ["image_key"] = it.ImageKey ?? (al != null ? al.ImageKey : it.ArtUri.Length > 0 ? NowPlaying.ForeignKey(it.ArtUri) : null),
                ["length"] = len != 0 ? len : null
            };
        }
        // Sonos keeps played tracks in its queue; they ARE the history. Upcoming starts at the current track.
        var cur = q.Current > 0 ? (int)q.Current : 1;
        var items = q.Current > 0 ? q.Items.Skip(cur - 1).Select(Row) : q.Items.Select(Row);
        var history = q.Current > 0 ? q.Items.Take(cur - 1).Reverse().Select(it =>
        {
            var r = Row(it);
            return (JsonNode)new JsonObject
            {
                ["track"] = r["title"]?.DeepClone(), ["artist"] = r["subtitle"]?.DeepClone(), ["album"] = r["album"]?.DeepClone(), ["image_key"] = r["image_key"]?.DeepClone(),
                ["duration"] = r["length"]?.DeepClone() ?? 0, ["elapsed"] = r["length"]?.DeepClone() ?? 0, ["played"] = true, ["queue_item_id"] = it.Position
            };
        }).ToArray() : [];
        return await Send(req.Ctx, new JsonObject { ["items"] = new JsonArray(items.Select(x => (JsonNode)x).ToArray()), ["history"] = new JsonArray(history) });
    }
}
