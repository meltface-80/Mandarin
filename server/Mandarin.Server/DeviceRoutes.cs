// DeviceRoutes.cs — Settings → Audio Devices, the writes (v0.8.48, stage 5
// part 1 of docs/specs/csharp-migration.md): PATCH /api/audio-devices/:id,
// from lib/server/api-devices.js, lib/renderers/devices.js and registry.js,
// rule for rule. The name, hidden, sharing, output, DSP, levelling and the
// rates, depths and DSD you set are checked and written to audio_devices as
// the Node server wrote them, in the same order and with the same refusals (a
// write made before a refusal stays, as there). Then the Node server is told
// (POST /internal/devices/changed { id, changed }): it reads the device's name
// again and does what each write did there (the zones bumped, a renderer's
// queue planned again, a phone told its DSP or levelling, a Sonos room's queue
// planned again, a device switched off by hiding stopped and let go), and
// answers the device as its page shows it (online, its state, its events: live
// there), which is sent on.
//
// Playback's own stay with the Node server: a PATCH with enabled or radio is
// passed on whole, as are the list, a device's page, Look again and Forget
// (stage 6). Away from home only the phone the app is on may be changed, by
// the Node server as before: passed on.
using System.Text;
using Mandarin.Server.Playback;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private const string DevicePrefix = "/api/audio-devices/";
    // profiles.js: every rate, depth and DSD multiple there is; the "you set it" layer keeps those among them you ticked, in this order.
    private static readonly double[] DeviceRates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];
    private static readonly double[] DeviceBits = [16, 24, 32];
    private static readonly double[] DeviceDsd = [64, 128, 256];
    private const int DeviceNameMax = 60;   // registry.js NAME_MAX

    /* A refusal as the route makes it: its status and its words. */
    private sealed class DeviceRefusal(int status, string message) : Exception(message) { public int Status => status; }

    /* The device's row as registry.js reads it (row()): its kind, name, caps and settings, the two as objects. */
    private sealed class DeviceRow(string id, string kind, JsObj caps, JsObj settings)
    {
        public string Id => id;
        public string Kind => kind;
        public JsObj Caps = caps;
        public JsObj Settings = settings;
    }

    /* The device route: true when answered here. */
    private static async Task<bool> DeviceRoute(HttpContext ctx)
    {
        if (!HttpMethods.IsPatch(ctx.Request.Method)) return false;
        var p = ctx.Request.Path.Value ?? "";
        if (!p.StartsWith(DevicePrefix, StringComparison.Ordinal)) return false;
        var id = p[DevicePrefix.Length..];
        // One plain segment, as Express's :id takes it; anything else (empty, a further segment, an escape) is the Node server's to read.
        if (id.Length == 0 || id.Contains('/') || id.Contains('%')) return false;
        // Away, only the phone the app is on, by the device it signed in as: the Node server's, as before.
        if (Auth.IsAway(ctx) || !BodyFits(ctx)) return false;
        // Kept, so the request can still go on as it came.
        ctx.Request.EnableBuffering();
        object? b = new JsObj();
        if (IsJsonBody(ctx))
        {
            using var ms = new MemoryStream();
            await ctx.Request.Body.CopyToAsync(ms);
            ctx.Request.Body.Position = 0;
            var text = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
            if (text.StartsWith('﻿')) text = text[1..];
            if (text.Length > 0)
            {
                // Strict, as the parser is: an object or an array, nothing else; what it turns down is its own answer.
                var first = text.TrimStart(' ', '\t', '\n', '\r');
                if (first.Length == 0 || first[0] is not ('{' or '[')) return false;
                try { b = JsJson.Parse(text); }
                catch (JsError) { return false; }
            }
        }
        // Switching a player on or off, and the radio: playback's (stage 6).
        if (Prop(b, "enabled") is not Undef || Prop(b, "radio") is not Undef) return false;
        try { return await DevicePatch(ctx, id, b); }
        catch (Exception e) when (e is not DeviceRefusal && !ctx.Response.HasStarted)
        {
            // wrap(): e.status || 500, with its words.
            Front.Log($"[devices] {p}: {e.GetType().Name}: {e.Message}");
            return await JsError(ctx, 500, e.Message);
        }
    }

    /* The PATCH, write by write in the route's order; the Node server told, and its answer sent on. */
    private static async Task<bool> DevicePatch(HttpContext ctx, string id, object? b)
    {
        var changed = new List<string>();
        try
        {
            using var c = Db.Open();
            var d = DeviceRead(c, id) ?? throw new DeviceRefusal(404, "No such device");
            var name = Prop(b, "name");
            if (name is not Undef)
            {
                if (name is not string s) throw new DeviceRefusal(400, "name must be text");
                if (d.Kind == "phone") throw new DeviceRefusal(400, "A phone is named in the app on the phone");
                DeviceRename(c, d, s);
                changed.Add("name");
            }
            var hidden = Prop(b, "hidden");
            if (hidden is not Undef)
            {
                var on = TJs.Truthy(hidden);
                // Hiding also switches off one that can be (setEnabled): a renderer or sound device playing is stopped and let go, by the Node server when told.
                if (on && d.Kind != "phone" && DeviceEnabled(d)) { DeviceSettings(c, d, Jv.Obj(("enabled", false))); changed.Add("enabled"); }
                DeviceSettings(c, d, Jv.Obj(("hidden", on)));
                changed.Add("hidden");
            }
            var shared = Prop(b, "shared");
            if (shared is not Undef)
            {
                if (d.Kind != "phone") throw new DeviceRefusal(400, "Only a phone has this switch");
                DeviceSettings(c, d, Jv.Obj(("shared", TJs.Truthy(shared))));
                changed.Add("shared");
            }
            var output = Prop(b, "output");
            if (TJs.Truthy(output) && TJs.IsObject(output))
            {
                if (d.Kind is not ("upnp" or "local")) throw new DeviceRefusal(400, "Only a renderer or a sound device on this computer has output settings");
                var patch = new JsObj();
                var mode = Prop(output, "mode");
                if (mode is not Undef)
                {
                    if (!Jv.OneOf(mode, "original", "x2", "x4", "max")) throw new DeviceRefusal(400, "mode must be original, x2, x4 or max");
                    patch["mode"] = mode;
                }
                var bits = Prop(output, "bits");
                if (bits is not Undef)
                {
                    var auto = TJs.StrictEq(bits, "auto");
                    if (!(auto || TJs.StrictEq(bits, 24.0) || TJs.StrictEq(bits, 32.0))) throw new DeviceRefusal(400, "bits must be auto, 24 or 32");
                    patch["bits"] = auto ? null : bits;
                }
                var volume = Prop(output, "volume");
                if (volume is not Undef)
                {
                    if (!Jv.OneOf(volume, "fixed", "upnp")) throw new DeviceRefusal(400, "volume must be fixed or upnp");
                    patch["volume"] = volume;
                }
                DeviceSettings(c, d, patch);
                changed.Add("output");
            }
            var dsp = Prop(b, "dsp");
            if (dsp is not Undef)
            {
                if (d.Kind == "sonos") throw new DeviceRefusal(400, "Sonos rooms are tuned with Trueplay in the Sonos app");
                if (!TJs.Truthy(dsp) || dsp is not JsObj) throw new DeviceRefusal(400, "dsp must be an object");
                var merged = DeviceCopy(DeviceDsp(d) ?? Biquad.Normalise(null));
                foreach (var k in new[] { "enabled", "headphone", "peq", "headroom" }) if (Prop(dsp, k) is not Undef) merged[k] = Prop(dsp, k);
                if (TJs.StrictEq(merged["headroom"], "auto") || merged["headroom"] is null) merged["headroom"] = "auto";
                JsObj next;
                try { next = Biquad.Normalise(merged); }
                catch (JsError e) { throw new DeviceRefusal(400, e.Message); }
                DeviceSettings(c, d, Jv.Obj(("dsp", next)));
                changed.Add("dsp");
            }
            var levelling = Prop(b, "levelling");
            if (levelling is not Undef)
            {
                JsObj next;
                try { next = Gain.LevellingPatch(d.Settings["levelling"], levelling); }
                catch (LevellingError e) { throw new DeviceRefusal(400, e.Message); }
                DeviceSettings(c, d, Jv.Obj(("levelling", next)));
                changed.Add("levelling");
            }
            var caps = Prop(b, "caps");
            if (TJs.Truthy(caps) && Prop(caps, "user") is var u && u is not Undef)
            {
                if (u is not null && u is not JsObj) throw new DeviceRefusal(400, "caps.user must be an object or null");
                JsObj? clean = null;
                if (u is JsObj uo)
                {
                    clean = new JsObj();
                    foreach (var (k, all) in new[] { ("rates", DeviceRates), ("bits", DeviceBits), ("dsd", DeviceDsd) })
                    {
                        var v = uo[k];
                        if (v is Undef) continue;
                        if (v is null) { clean[k] = null; continue; }
                        if (v is not List<object?> list || list.Exists(x => Array.IndexOf(all, Jv.Num(x)) < 0)) throw new DeviceRefusal(400, $"caps.user.{k} lists something unknown");
                        clean[k] = list.Select(x => (object?)Jv.Num(x)).ToList();
                    }
                }
                if (d.Kind is not ("upnp" or "local")) throw new DeviceRefusal(400, "What a Sonos room or a phone plays is fixed");
                DeviceUserCaps(c, d, clean);
                changed.Add("caps");
            }
        }
        catch (DeviceRefusal r)
        {
            // A write made before the refusal stays, as there: the Node server told of it all the same.
            if (changed.Count > 0) await DevicesChanged(id, changed);
            return await JsError(ctx, r.Status, r.Message);
        }
        var said = await DevicesChanged(id, changed);
        if (said == null) return await JsError(ctx, 502, "The Node server didn't answer");
        object? answer;
        try { answer = JsJson.Parse(said.Value.Text); }
        catch (JsError) { return await JsError(ctx, 502, "The Node server didn't answer"); }
        return await SendJs(ctx, answer, said.Value.Status);
    }

    /*
     * What each write did: by the hub here once this server holds playback
     * (v0.8.49, stage 6), and the Node server told (index.js /internal/devices/changed)
     * — for the device as its page shows it, until the device list moves (part 5).
     */
    private static async Task<(int Status, string Text)?> DevicesChanged(string id, List<string> changed)
    {
        if (Playback.Hub.Current is { } hub) await hub.DeviceChanged(id, changed);
        return await AskNode("/internal/devices/changed", TJs.Json(Jv.Obj(("id", id), ("changed", changed.Select(x => (object?)x).ToList()))) ?? "{}");
    }

    // ------------------------------------------------------------------ registry.js

    /* registry.js get(id): the row, its caps and settings read as parseJson reads them (an object, else {}). */
    private static DeviceRow? DeviceRead(SqliteConnection c, string id)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT kind, caps, settings FROM audio_devices WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        static JsObj Parsed(SqliteDataReader r, int i)
        {
            if (r.IsDBNull(i)) return new JsObj();
            object? v = null;
            try { v = JsJson.Parse(r.GetString(i)); } catch (JsError) { /* not JSON: {} */ }
            return DeviceObj(v);
        }
        return new DeviceRow(id, r.IsDBNull(0) ? "" : r.GetString(0), Parsed(r, 1), Parsed(r, 2));
    }

    /* Object.assign({}, v) for what parseJson lets through: an object as it is, an array by its indexes, anything else {}. */
    private static JsObj DeviceObj(object? v)
    {
        if (v is JsObj o) return DeviceCopy(o);
        var out_ = new JsObj();
        if (v is List<object?> l) for (var i = 0; i < l.Count; i++) out_[i.ToString(System.Globalization.CultureInfo.InvariantCulture)] = l[i];
        return out_;
    }

    private static JsObj DeviceCopy(JsObj o)
    {
        var c = new JsObj();
        foreach (var k in o.Keys) c[k] = o[k];
        return c;
    }

    private static void DeviceExec(SqliteConnection c, string sql, params (string Name, object Value)[] ps)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in ps) cmd.Parameters.AddWithValue(n, v);
        cmd.ExecuteNonQuery();
    }

    /* registry.js cleanName: control characters out, trimmed, sixty characters at most. */
    private static string DeviceCleanName(string v)
    {
        var sb = new StringBuilder(v.Length);
        foreach (var ch in v) if (ch > '\u001f') sb.Append(ch);
        var s = TJs.Trim(sb.ToString());
        return s.Length > DeviceNameMax ? s[..DeviceNameMax] : s;
    }

    /* rename(id, name): the name you gave it, or none again for "". */
    private static void DeviceRename(SqliteConnection c, DeviceRow d, string name)
    {
        var n = DeviceCleanName(name);
        DeviceExec(c, "UPDATE audio_devices SET name = $v WHERE id = $id", ("$v", n.Length > 0 ? n : DBNull.Value), ("$id", d.Id));
    }

    /* setSettings(id, patch): the patch laid over the settings, anything null or undefined dropped. */
    private static void DeviceSettings(SqliteConnection c, DeviceRow d, JsObj patch)
    {
        var next = DeviceCopy(d.Settings);
        foreach (var k in patch.Keys) next[k] = patch[k];
        var kept = new JsObj();
        foreach (var k in next.Keys) if (!TJs.IsNullish(next[k])) kept[k] = next[k];
        DeviceExec(c, "UPDATE audio_devices SET settings = $v WHERE id = $id", ("$v", TJs.Json(kept) ?? "{}"), ("$id", d.Id));
        d.Settings = kept;
    }

    /* setUserCaps(id, user): the "you set it" layer — the rates, depths and DSD among profiles.js's you listed, or null to clear. */
    private static void DeviceUserCaps(SqliteConnection c, DeviceRow d, JsObj? user)
    {
        var caps = DeviceCopy(d.Caps);
        if (user == null) caps = Jv.CopyWithout(caps, "user");
        else
        {
            var u = caps["user"] is JsObj cu ? DeviceCopy(cu) : new JsObj();
            foreach (var (k, all) in new[] { ("rates", DeviceRates), ("bits", DeviceBits), ("dsd", DeviceDsd) })
            {
                var v = user[k];
                if (v is Undef) continue;
                if (v is null) { u = Jv.CopyWithout(u, k); continue; }
                var want = (v as List<object?> ?? []).Select(Jv.Num).ToList();
                u[k] = all.Where(r => want.Contains(r)).Select(r => (object?)r).ToList();
            }
            if (u.Count > 0) caps["user"] = u; else caps = Jv.CopyWithout(caps, "user");
        }
        DeviceExec(c, "UPDATE audio_devices SET caps = $v WHERE id = $id", ("$v", TJs.Json(caps) ?? "{}"), ("$id", d.Id));
        d.Caps = caps;
    }

    // ------------------------------------------------------------------- devices.js

    /* enabled(r): a phone always; a renderer or sound device only when switched on; a Sonos room unless switched off. */
    private static bool DeviceEnabled(DeviceRow d)
    {
        if (d.Kind == "phone") return true;
        var v = d.Settings["enabled"];
        return d.Kind is "upnp" or "local" ? TJs.StrictEq(v, true) : !TJs.StrictEq(v, false);
    }

    /* dspFor(id): the DSP as Biquad.normalise keeps it; null for a Sonos room or a setting that doesn't read. */
    private static JsObj? DeviceDsp(DeviceRow d)
    {
        if (d.Kind == "sonos") return null;
        try { return Biquad.Normalise(d.Settings["dsp"]); } catch (JsError) { return null; }
    }
}
