// PhoneRoutes.cs — the Android app as a player (lib/server/api-phone.js,
// v0.8.49, stage 6; see Playback/Phones.cs):
//   POST /api/phone/hello     the app's player has started (empty) → its zone id,
//                             and where to find this server away from home
//   GET  /api/phone/commands  ?after=<seq>: what to do next, held open ~25 s
//   POST /api/phone/state     what the player is actually doing
// Only a signed-in Android app can be a phone zone, and only as itself: the
// zone id comes from the device's sign-in, never from the request.
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class PlaybackRoutes
{
    private static Device PhoneDevice(Req req)
    {
        var dev = req.Device;
        if (dev == null || dev.Kind != "android") throw new HubError(403, "Only the Mandarin Android app can play as a phone");
        return dev;
    }

    /* The phone's DSP setting, the register's copy or the default until the phone is in it (devices.js dspFor). */
    internal static JsObj DspFor(SqliteConnection c, string id)
    {
        var r = Register.Get(c, id);
        if (r == null || r.Kind == "sonos") return Biquad.Normalise(null);
        try { return Biquad.Normalise(r.Settings["dsp"]); } catch (JsError) { return Biquad.Normalise(null); }
    }

    /*
     * A phone's DSP set on the phone itself (offline): into the register, even
     * before the phone is in it (devices.js phoneDsp, setDsp). A setting the
     * server doesn't take is left: its own copy stands.
     */
    private static void PhoneDsp(Req req, string uid, string name, JsonObject sent)
    {
        var c = req.C;
        if (Register.Get(c, uid) == null) Register.Seen(c, new SeenInfo { Id = uid, Kind = "phone", NetworkName = name, Model = "Phone" });
        var patch = Scan.JsJson.Parse(sent.ToJsonString()) as JsObj ?? new JsObj();
        var cur = DspFor(c, uid);
        var merged = new JsObj();
        foreach (var k in cur.Keys) merged[k] = cur[k];
        foreach (var k in new[] { "enabled", "headphone", "peq", "headroom" }) if (patch.Has(k)) merged[k] = patch[k];
        if (Jv.Same(merged["headroom"], "auto") || merged["headroom"] == null) merged["headroom"] = "auto";
        JsObj next;
        try { next = Biquad.Normalise(merged); } catch (JsError) { return; }
        var settings = new JsObj(); settings["dsp"] = next;
        Register.SetSettings(c, uid, settings);
        // What the zone plays next is planned again with the new setting: the app is told.
        req.Hub.Phones.DspChanged(uid, next);
        req.Hub.Bump();
    }

    /*
     * Where this server is reached away from home (lib/server/tailscale.js awayAddress): [setByHand]
     * (TAILSCALE_ADDRESS), else built-in Tailscale's [own], else a Tailscale address among [ifs] (this machine's: Undef).
     */
    internal static string? AwayAddress(int port, string? setByHand, string? own, object? ifs)
    {
        var set = (setByHand ?? "").Trim().TrimEnd('/');
        if (set.Length > 0) return set.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || set.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? set : $"http://{(set.Contains(':') ? set : set + ":" + port)}";
        if (own is { Length: > 0 }) return own;
        var ip = Topology.LanAddresses(ifs).Select(a => Jv.Str(a["address"])).FirstOrDefault(a => Topology.IsCgnat(a));
        return ip != null ? $"http://{ip}:{port}" : null;
    }

    private static async Task<bool> PhoneRoute(Req req, string p)
    {
        var dev = PhoneDevice(req);
        var phones = req.Hub.Phones;
        switch (p)
        {
            case "/api/phone/hello":
            {
                var name = Js.Truthy(req.Body["name"]) ? Js.Str(req.Body["name"]) : dev.Name;
                var hello = phones.Hello(dev.Id, name);
                var uid = Js.Str(hello["zone_id"]);
                phones.SetAway(uid, req.Away);
                // The register learns of the phone now, not at the sync's next tick: its page in Audio Devices is there at once.
                req.Hub.SyncKnown();
                // A DSP setting changed on the phone while it couldn't reach the server: the phone's is the newer, so it is kept here.
                if (req.Body["dsp"] is JsonObject sent) PhoneDsp(req, uid, name, sent);
                var dsp = DspFor(req.C, uid);
                hello["away"] = req.Away;
                hello["away_address"] = AwayAddress(req.Hub.Config.Port, Environment.GetEnvironmentVariable("TAILSCALE_ADDRESS"), Jobs.Tailscale?.Address(), Undef.V);
                hello["dsp"] = Phones.ToNode(dsp);
                // Volume Levelling (this phone's own): what the app applies to what it plays itself.
                hello["replaygain"] = Phones.ToNode(Items.LevellingFor(req.C, uid));
                return await Send(req.Ctx, hello);
            }
            case "/api/phone/commands":
            {
                var after = Math.Max(0, Tags.Js.ParseInt(req.Q("after")) is var a && !double.IsNaN(a) ? a : 0);
                var wait = (int)Math.Max(0, Math.Min(25000, Tags.Js.ParseInt(req.Q("wait")) is var w && !double.IsNaN(w) ? w : 0));
                var uid = Phones.UidFor(dev.Id);
                phones.SetAway(uid, req.Away);
                return await Send(req.Ctx, await phones.Commands(uid, after, wait));
            }
            case "/api/phone/state":
            {
                var uid = Phones.UidFor(dev.Id);
                phones.SetAway(uid, req.Away);
                await phones.Report(uid, req.Body);
                return await Send(req.Ctx, new JsonObject { ["ok"] = true });
            }
            default: return false;
        }
    }
}
