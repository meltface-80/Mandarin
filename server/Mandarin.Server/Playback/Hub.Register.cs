// Hub.Register.cs — Sonos rooms and phones into the device register
// (lib/renderers/devices.js syncKnown, v0.8.49, stage 6 part 2), so a name is
// a name everywhere and a phone's page in Audio Devices takes its settings:
// every ten seconds, a row written when something changed, or once a minute
// to keep it online. The renderers' rows come with their discovery (part 3).
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

internal sealed partial class Hub
{
    private const int SyncMs = 10000;

    private void StartRegister() => Loop("sync", SyncMs, () => { SyncKnown(); return Task.CompletedTask; }, 3000);

    /* Sonos rooms and phones into the register. */
    public void SyncKnown()
    {
        try
        {
            using var c = Db.Open();
            foreach (var m in Sonos.Rooms())
            {
                string model;
                lock (Gate) model = Sonos.Models.GetValueOrDefault(m.Uid, "");
                SeenIfChanged(c, new SeenInfo { Id = m.Uid, Kind = "sonos", NetworkName = m.Name, Model = model, Ip = m.Ip, Manufacturer = "Sonos" });
            }
            foreach (var p in Phones.Zones()) SeenIfChanged(c, new SeenInfo { Id = p.ZoneId, Kind = "phone", NetworkName = p.DisplayName, Model = "Phone" });
        }
        catch (Exception e) when (e is SqliteException or IOException) { Log($"[devices] the register wasn't kept: {e.Message}"); }
    }

    /*
     * devices.js changed(id, keys): what a device write did there, done here
     * once this server holds playback (DeviceRoutes.cs): a phone told its DSP
     * or levelling, a Sonos room's queue planned again for its levelling, the
     * zones bumped. A renderer's (its queue planned again, one switched off let
     * go) comes with part 3.
     */
    public async Task DeviceChanged(string id, List<string> keys)
    {
        DeviceRecord? r;
        using (var c = Db.Open()) r = Register.Get(c, id);
        if (r == null) return;
        var bump = false;
        foreach (var k in keys)
        {
            if (k == "dsp" && r.Kind == "phone")
            {
                JsObj next;
                using (var c = Db.Open()) next = PlaybackRoutes.DspFor(c, id);
                Phones.DspChanged(id, next);
            }
            if (k == "levelling")
            {
                if (r.Kind == "phone") { JsObj next; using (var c = Db.Open()) next = Items.LevellingFor(c, id); Phones.LevellingChanged(id, next); }
                if (r.Kind == "sonos") _ = ReplanSonos(id).ContinueWith(t => Log("[levelling] " + t.Exception?.InnerException?.Message), TaskContinuationOptions.OnlyOnFaulted);
            }
            if (k is "name" or "enabled" or "shared" or "output" or "dsp" or "levelling") bump = true;
        }
        if (bump) Bump();
        await Task.CompletedTask;
    }

    /* Into the register when something changed, or once a minute to keep it online. */
    private static DeviceRecord? SeenIfChanged(SqliteConnection c, SeenInfo info)
    {
        var cur = Register.Get(c, info.Id);
        var same = cur != null && cur.NetworkName == (info.NetworkName is { Length: > 0 } nn ? nn : cur.NetworkName) &&
            (info.Ip is not { Length: > 0 } || cur.Ip == info.Ip) && (info.Model is not { Length: > 0 } || cur.Model == info.Model);
        if (same && Now() - cur!.LastSeen < 60000) return cur;
        return Register.Seen(c, info);
    }
}
