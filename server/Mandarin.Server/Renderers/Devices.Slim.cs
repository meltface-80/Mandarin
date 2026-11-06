// Devices.Slim.cs — SlimProto players among the devices (bug list item 312): the SlimProto server started with the
// rest (Slim/SlimServer.cs), and each player that says hello, is named or goes kept in the register (Slim/SlimDevices.cs)
// — on the network while it is connected.
using Mandarin.Server.Playback;
using Mandarin.Server.Renderers.Slim;
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

    private void SlimSeen(SlimPlayer p)
    {
        try
        {
            using (var c = Db.Open()) Register.Seen(c, SlimDevices.InfoOf(p));
            hub.Bump();
        }
        catch (Exception e) when (e is SqliteException or IOException) { hub.Log($"[slimproto] {p.Name}: {e.Message}"); }
    }
}
