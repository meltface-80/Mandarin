// Devices.Slim.cs — SlimProto players among the devices (bug list item 312): the SlimProto server started with the
// rest (Slim/SlimServer.cs), and each player that says hello, is named or goes kept in the register (Slim/SlimDevices.cs)
// — on the network while it is connected. A Mandarin Bridge says where its own web service is in its hello (item 315):
// its DAC read from there (/dac.json) as a UPnP Bridge's was, so its rates are its DAC's, its ✓ is its word, and it
// is updated and its log read from Settings → Updates as before. Met first over SlimProto, a Bridge that was a UPnP
// renderer (before 0.3.0) keeps what it was given then: its name and its settings, from the device its UDN names.
using Mandarin.Server.Playback;
using Mandarin.Server.Renderers.Slim;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Renderers;

internal sealed partial class Devices
{
    /* The SlimProto server, where its port could be had (SLIMPROTO_PORT, 3483; 0 none). */
    public SlimServer? Slim { get; private set; }

    private void StartSlim()
    {
        var port = SlimServer.PortFromEnvironment;
        if (port == 0) return;
        Slim = SlimServer.Start(port, "Mandarin", hub.Config.Port, hub.Log, SlimSeen);
    }

    private void SlimSeen(SlimPlayer p) => _ = SlimSeenAsync(p);

    // What a player is, written one at a time: its hello and its name come close together, and each is a write.
    private readonly object slimWrites = new();

    private async Task SlimSeenAsync(SlimPlayer p)
    {
        try
        {
            // A Mandarin Bridge: its DAC, as its app says it (MandarinBridge.cs), where it answers. Asked first, unlocked.
            var bridge = p.Connected ? SlimDevices.BridgeBase(p) : null;
            var dac = bridge != null ? await MandarinBridge.Probe(bridge) : null;
            lock (slimWrites)
            {
                // What it is now (its name may have come while its DAC was asked), written once, after the write before.
                var info = SlimDevices.InfoOf(p);
                if (bridge != null && dac != null && info.Caps!["advertised"] is JsObj advertised)
                {
                    MandarinBridge.Advertise(advertised, dac);
                    info.Caps!["mandarin"] = MandarinBridge.Said(bridge, dac);
                }
                using var c = Db.Open();
                var fresh = Register.Get(c, p.Id) == null;
                Register.Seen(c, info);
                if (fresh && SlimDevices.UpnpIdOf(p) is { } was && Register.Get(c, was) is { } before) CarriedOver(c, p.Id, before);
            }
            hub.Bump();
        }
        catch (Exception e) when (e is SqliteException or IOException) { hub.Log($"[slimproto] {p.Name}: {e.Message}"); }
    }

    /* What a Bridge was given as a UPnP renderer, kept on it now: the name it was given and its settings. */
    private void CarriedOver(SqliteConnection c, string id, DeviceRecord before)
    {
        if (before.Name is { Length: > 0 } name) Register.Rename(c, id, name);
        if (before.Settings.Count > 0) Register.SetSettings(c, id, before.Settings);
        hub.Log($"[slimproto] {id}: the settings of {before.Id} carried over");
    }
}
