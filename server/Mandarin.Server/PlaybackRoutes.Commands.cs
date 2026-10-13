// PlaybackRoutes.Commands.cs — the transport, the volume, the modes, grouping,
// moving what's playing, and the queue's own actions (api-playback.js, the
// POST routes that act on a zone).
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;

namespace Mandarin.Server;

internal static partial class PlaybackRoutes
{
    private static readonly string[] Commands = ["play", "pause", "playpause", "stop", "previous", "next"];
    private static readonly JsonObject Ok = new() { ["ok"] = true };

    private static async Task<bool> Write(Req req, string p)
    {
        var hub = req.Hub;
        var b = req.Body;
        switch (p)
        {
            case "/api/control":
            {
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var command = Str(b["command"]);
                if (command == null || !Commands.Contains(command)) return await Fail(req.Ctx, 400, "invalid command, allowed: " + string.Join(", ", Commands));
                // Play on an idle room with an empty queue: Random Album Radio is what that means here.
                var z = hub.Zone(id);
                var st = z?.State;
                if (command is "play" or "playpause" && st != null && st.TrackUri.Length == 0 && !(st.QueueLength > 0))
                {
                    await History.RadioTopUp(hub, z!.ZoneId, true);
                    return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["started"] = "random-album" });
                }
                await hub.Control(id, command);
                return await Send(req.Ctx, Ok.DeepClone().AsObject());
            }
            case "/api/seek":
            {
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var seconds = Num(b, "seconds");
                if (!double.IsFinite(seconds)) return await Fail(req.Ctx, 400, "seconds required");
                await hub.Seek(id, Str(b["how"]) == "relative" ? "relative" : "absolute", seconds);
                return await Send(req.Ctx, Ok.DeepClone().AsObject());
            }
            case "/api/volume":
            {
                List<string> targets;
                if (Js.Truthy(b["output_id"])) targets = [Js.Str(b["output_id"])];
                else
                {
                    var z = hub.Zone(Need(b["zone_or_output_id"], "output_id or zone_or_output_id required"));
                    if (z == null) return await Fail(req.Ctx, 404, "That room isn't available");
                    targets = z.Outputs.Select(o => o.OutputId).ToList();
                }
                if (b.ContainsKey("mute"))
                {
                    foreach (var id in targets) await hub.SetMute(id, Js.Truthy(b["mute"]));
                    return await Send(req.Ctx, Ok.DeepClone().AsObject());
                }
                var value = Num(b, "value");
                if (!double.IsFinite(value)) return await Fail(req.Ctx, 400, "value is required");
                foreach (var id in targets) await hub.SetVolume(id, Js.Truthy(b["how"]) ? Js.Str(b["how"]) : "absolute", value);
                return await Send(req.Ctx, Ok.DeepClone().AsObject());
            }
            case "/api/zone-settings":
            {
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                bool? shuffle = b.ContainsKey("shuffle") ? Js.Truthy(b["shuffle"]) : null;
                string? loop = null;
                if (b.ContainsKey("loop"))
                {
                    loop = Str(b["loop"]);
                    if (loop is not ("disabled" or "loop" or "loop_one")) return await Fail(req.Ctx, 400, "loop must be disabled, loop or loop_one");
                }
                if (shuffle == null && loop == null && !b.ContainsKey("auto_radio")) return await Fail(req.Ctx, 400, "nothing to change");
                if (shuffle != null || loop != null) await hub.SetSettings(id, shuffle, loop);
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["random_album_radio_stands_down"] = false });
            }
            case "/api/pause-all":
                await hub.PauseAll();
                return await Send(req.Ctx, Ok.DeepClone().AsObject());
            case "/api/mute-all":
            {
                var how = Js.Truthy(b["how"]) ? Js.Str(b["how"]) : req.Q("how") is { Length: > 0 } qh ? qh : "mute";
                var n = 0;
                foreach (var o in hub.Outputs())
                {
                    try { await hub.SetMute(o.OutputId, how != "unmute"); n++; } catch (HubError) { /* unreachable room: skip it */ }
                }
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["outputs"] = n });
            }
            case "/api/group-outputs":
            {
                var ids = Ids(b["output_ids"]);
                if (ids.Count < 2) return await Fail(req.Ctx, 400, "grouping needs at least two outputs");
                await hub.Group(ids);
                return await Send(req.Ctx, Ok.DeepClone().AsObject());
            }
            case "/api/ungroup-outputs":
            {
                var ids = Ids(b["output_ids"]);
                if (ids.Count == 0) return await Fail(req.Ctx, 400, "no outputs given");
                await hub.Ungroup(ids);
                return await Send(req.Ctx, Ok.DeepClone().AsObject());
            }
            case "/api/transfer-zone":
            {
                // The page names them from_zone / to_zone; both spellings are taken.
                var from = Need(Js.Truthy(b["from"]) ? b["from"] : b["from_zone"], "from is required");
                var to = Need(Js.Truthy(b["to"]) ? b["to"] : b["to_zone"], "to is required");
                await hub.Transfer(from, to);
                return await Send(req.Ctx, Ok.DeepClone().AsObject());
            }
            case "/api/play-from-here":
            {
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var n = Num(b, "queue_item_id");
                if (!double.IsInteger(n) || n < 1) return await Fail(req.Ctx, 400, "queue_item_id is required");
                await hub.PlayFromHere(id, n);
                return await Send(req.Ctx, Ok.DeepClone().AsObject());
            }
            case "/api/queue/remove":
            {
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var ids = PositionsOf(b);
                if (ids.Count == 0) return await Fail(req.Ctx, 400, "queue_item_ids required");
                // From the bottom up, so each removal leaves the positions above it as they were.
                foreach (var n in ids.Distinct().OrderByDescending(x => x)) await hub.RemoveFromQueue(id, n);
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["removed"] = ids.Distinct().Count() });
            }
            case "/api/queue/clear":
            {
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                await hub.ClearQueue(id);
                return await Send(req.Ctx, Ok.DeepClone().AsObject());
            }
            case "/api/queue/move":
            {
                var id = Need(b["zone_or_output_id"], "zone_or_output_id required");
                var ids = PositionsOf(b);
                if (ids.Count == 0) return await Fail(req.Ctx, 400, "queue_item_ids required");
                var kind = Str(b["kind"]) == "play_now" ? "play_now" : "play_next";
                var plan = await hub.MoveAfterCurrent(id, ids);
                if (kind == "play_now") await hub.PlayFromHere(id, plan.First);
                return await Send(req.Ctx, new JsonObject { ["ok"] = true, ["kind"] = kind, ["moved"] = plan.Moved, ["first"] = plan.First });
            }
            // Sonos has no standby a controller may use, and no source switching.
            case "/api/output/standby": return await Fail(req.Ctx, 501, "Sonos rooms have no standby control");
            case "/api/output/convenience-switch": return await Fail(req.Ctx, 501, "Sonos rooms have no source switch");
            default: return await PlayWrite(req, p);
        }
    }

    private static List<string> Ids(JsonNode? v) => (v as JsonArray ?? []).Where(x => Js.Truthy(x)).Select(x => Js.Str(x)).ToList();

    /* The queue's positions (queue_item_ids, or one queue_item_id), whole numbers from 1. */
    private static List<double> PositionsOf(JsonObject b) =>
        (b["queue_item_ids"] is JsonArray a ? a.ToList() : [b["queue_item_id"]]).Select(Phones.JsNumber).Where(n => double.IsInteger(n) && n >= 1).ToList();
}
