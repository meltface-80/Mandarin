using System.Net;
using System.Net.Sockets;

namespace Mandarin.Tests;

/// <summary>
/// A command the server doesn't have (bug list item 310). On 6 November `docker exec musicd-server mandarin-server
/// raat-discover`, run on a server from before that command, started a second server inside the container beside the
/// one running: its database opened, its jobs and the built-in Tailscale started, until it fell over on the port the
/// first held. A word after the program's name that isn't one of its commands is now said so, and nothing is started.
/// </summary>
public sealed class UnknownCommandTests
{
    [Test]
    public async Task A_command_it_doesnt_have_said_so_and_no_second_server_started()
    {
        var data = TempRun.Open(Path.GetTempPath());
        // The port held, as the running server held it.
        using var held = new TcpListener(IPAddress.Any, Ports.Port());
        held.Start();
        var port = ((IPEndPoint)held.LocalEndpoint).Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        try
        {
            var r = await ServerCommand.Run(["raat-discover-not-a-command", "--json"],
                new Dictionary<string, string> { ["PORT"] = port, ["DATA_DIR"] = data, ["MUSIC_DIR"] = data, ["UPDATE_CHECK"] = "false", ["LOCAL_AUDIO"] = "0" });
            Assert.Equal(2, r.Code);
            Assert.Contains("no command \"raat-discover-not-a-command --json\"", r.Err, StringComparison.Ordinal);
            Assert.DoesNotContain("[server]", r.Out + r.Err, StringComparison.Ordinal);
            Assert.False(File.Exists(Path.Combine(data, "musicd.db")), "no database opened");
        }
        finally { TempRun.Close(data); }
    }
}
