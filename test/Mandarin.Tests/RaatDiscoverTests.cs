using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Which Roon Ready devices are on the network (bug list item 309, Renderers/Sood.cs and RaatDiscover.cs): SOOD read
/// as Roon Labs' open node-roon-api writes and reads it (sood.js) — "SOOD", 2, a type, then each property a name of a
/// byte's length and a value of two bytes' (0xFFFF none) — every property kept as it came, a packet cut short or not
/// SOOD refused. `raat-discover` sends one query and shows what answers; a Roon Core's own query heard, the service it
/// asks for is asked for too. Nothing else is sent: the stand-in device here sees only the queries.
/// </summary>
public sealed class RaatDiscoverTests
{
    private const string Core = "00720724-5143-4a9b-abac-0e50cba674bb";

    /* A SOOD packet made by hand, as sood.js lays it out: [type], then each (name, value), a null value as 0xFFFF. */
    private static byte[] Packet(char type, params (string Name, string? Value)[] props)
    {
        var o = new List<byte>(Encoding.ASCII.GetBytes("SOOD")) { 2, (byte)type };
        foreach (var (n, v) in props)
        {
            var nb = Encoding.UTF8.GetBytes(n);
            o.Add((byte)nb.Length);
            o.AddRange(nb);
            if (v == null) { o.Add(0xFF); o.Add(0xFF); continue; }
            var vb = Encoding.UTF8.GetBytes(v);
            o.Add((byte)(vb.Length >> 8));
            o.Add((byte)(vb.Length & 0xFF));
            o.AddRange(vb);
        }
        return [.. o];
    }

    /* Each packet read by `sood-parse`, its line of JSON (null where it isn't SOOD). */
    private static async Task<List<JsonNode?>> Parse(params byte[][] packets)
    {
        var r = await ServerCommand.Run(["sood-parse"], stdin: string.Join('\n', packets.Select(Convert.ToBase64String)) + "\n");
        Assert.Equal(0, r.Code);
        return [.. r.Out.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => JsonNode.Parse(l))];
    }

    [Test]
    public async Task A_SOOD_packet_read_every_property_as_it_came_one_cut_short_or_not_SOOD_refused()
    {
        var poly = Packet('R', ("name", "Poly"), ("unique_id", "a1b2"), ("service_id", "svc"), ("display_version", "ünï"), ("empty", ""), ("none", null));
        var whole = (await Parse(poly))[0]!;
        Assert.Equal("R", (string?)whole["type"]);
        var props = whole["props"]!.AsObject();
        Assert.Equal(["name", "unique_id", "service_id", "display_version", "empty", "none"], props.Select(p => p.Key));
        Assert.Equal(("Poly", "a1b2", "svc", "ünï", ""), ((string?)props["name"], (string?)props["unique_id"], (string?)props["service_id"], (string?)props["display_version"], (string?)props["empty"]));
        Assert.True(props.ContainsKey("none"));
        Assert.Null(props["none"]);
        Assert.Equal("Q", (string?)(await Parse(Packet('Q')))[0]!["type"]);

        var cutInValue = poly[..^2];                                   // the last value's bytes short
        var cutInLength = Packet('R', ("name", "Poly"))[..^5];         // the value's length itself cut
        var nameless = Packet('R', ("name", "Poly")).Concat(new byte[] { 0, 0, 0 }).ToArray();
        var notSood = Encoding.ASCII.GetBytes("SOOP").Concat(poly[4..]).ToArray();
        var version3 = poly.ToArray(); version3[4] = 3;
        var refused = await Parse(cutInValue, cutInLength, nameless, notSood, version3, Encoding.ASCII.GetBytes("SOOD"));
        Assert.Equal(6, refused.Count);
        Assert.All(refused, Assert.Null);
    }

    [Test]
    public async Task One_query_sent_what_answers_shown_and_a_Core_s_own_query_asked_for_in_turn()
    {
        Needs.Server();
        using var device = new UdpClient(new IPEndPoint(IPAddress.Loopback, Ports.Port()));
        var port = ((IPEndPoint)device.Client.LocalEndPoint!).Port;
        var queries = new List<JsonObject>();
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        // The stand-in: to the Core's service it answers as a Roon Core would, asking for a device's service in turn;
        // to that service, as a device. It is sent nothing but queries.
        var standIn = Task.Run(async () =>
        {
            while (!stop.IsCancellationRequested)
            {
                UdpReceiveResult r;
                try { r = await device.ReceiveAsync(stop.Token); } catch (OperationCanceledException) { return; }
                var q = (await Parse(r.Buffer))[0]!.AsObject();
                lock (queries) queries.Add(q);
                var props = q["props"]!.AsObject();
                var tid = (string?)props["_tid"];
                if ((string?)props["query_service_id"] == Core)
                {
                    await device.SendAsync(Packet('R', ("name", "Core"), ("unique_id", "core-1"), ("service_id", Core), ("_tid", tid)), r.RemoteEndPoint);
                    await device.SendAsync(Packet('Q', ("query_service_id", "device-svc"), ("_tid", "the-core's")), r.RemoteEndPoint);
                    // Our query sent on as Roon Server sends one on (item 311): its id in capitals, or none, and where
                    // to answer, us; and one of another computer's that happens to name the same port.
                    var back = r.RemoteEndPoint.Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    await device.SendAsync(Packet('Q', ("_replyaddr", "127.0.0.1"), ("_tid", tid!.ToUpperInvariant()), ("query_service_id", Core), ("_replyport", back)), r.RemoteEndPoint);
                    await device.SendAsync(Packet('Q', ("query_service_id", Core), ("_replyaddr", "127.0.0.1"), ("_replyport", back)), r.RemoteEndPoint);
                    await device.SendAsync(Packet('Q', ("query_service_id", Core), ("_replyaddr", "198.51.100.7"), ("_replyport", back)), r.RemoteEndPoint);
                }
                else await device.SendAsync(Packet('R', ("name", "Poly"), ("unique_id", "poly-1"), ("service_id", "device-svc"), ("_tid", tid), ("tcp_port", null)), r.RemoteEndPoint);
            }
        });
        var run = await ServerCommand.Run(["raat-discover", "--to", "127.0.0.1:" + port, "--seconds", "4", "--json"]);
        await stop.CancelAsync();
        await standIn;
        Assert.Equal(0, run.Code);
        var o = JsonNode.Parse(run.Out)!;

        Assert.Equal([Core, "device-svc"], o["asked_for"]!.AsArray().Select(x => (string?)x));
        Assert.Equal(2, queries.Count);
        Assert.All(queries, q => Assert.Equal("Q", (string?)q["type"]));
        Assert.Equal([Core, "device-svc"], queries.Select(q => (string?)q["props"]!["query_service_id"]));
        Assert.All(queries, q => Assert.Matches("^[0-9a-f-]{36}$", (string?)q["props"]!["_tid"]));

        var answers = o["answers"]!.AsArray();
        Assert.Equal(["Core", "Poly"], answers.Select(a => (string?)a!["props"]!["name"]));
        Assert.All(answers, a => Assert.True((bool)a!["answers_our_query"]!));
        Assert.Equal("127.0.0.1:" + port, (string?)answers[1]!["from"]);
        var poly = answers[1]!["props"]!.AsObject();
        Assert.Equal(("poly-1", "device-svc"), ((string?)poly["unique_id"], (string?)poly["service_id"]));
        Assert.True(poly.ContainsKey("tcp_port"));
        Assert.Null(poly["tcp_port"]);
        // Others' queries shown; our own, sent back to us, not.
        var heard = o["others_heard"]!.AsArray();
        Assert.Equal([("device-svc", null), (Core, "198.51.100.7")], heard.Select(h => ((string?)h!["props"]!["query_service_id"], (string?)h!["props"]!["_replyaddr"])));
        Assert.All(heard, h => Assert.False((bool)h!["answers_our_query"]!));
    }

    [Test]
    public async Task Its_arguments_checked()
    {
        Assert.Equal(2, (await ServerCommand.Run(["raat-discover", "--seconds", "600"])).Code);
        Assert.Equal(2, (await ServerCommand.Run(["raat-discover", "--play"])).Code);
    }
}
