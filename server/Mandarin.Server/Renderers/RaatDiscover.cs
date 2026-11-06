// RaatDiscover.cs — `mandarin-server raat-discover`: which Roon Ready devices (and Roon Cores) are on the network, and
// what each says of itself (bug list item 309). Read only: one SOOD query sent (Sood.cs), the answers heard for a few
// seconds, each answerer's properties shown as they came. It opens no other connection to a device and sends it
// nothing else; what a device would take beyond this is not looked into here.
//
//   raat-discover [--seconds N] [--service-id ID]… [--to HOST[:PORT]] [--json]
//
// The query goes to SOOD's group and broadcast on each of this computer's networks (or, with --to, to that address
// alone), asking for each service id given, the Roon Core's (Sood.CoreServiceId) where none is. While it listens it
// also hears others' SOOD on port 9003 — a Roon Core's own queries among them, the service id each asks for shown, so
// that id can be asked for in turn with --service-id. `sood-parse`: base64 packets a line on standard input, each read
// (Sood.Parse) to a line of JSON, null where it isn't SOOD (the tests').
using System.Net;
using System.Net.Sockets;
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal static class RaatDiscover
{
    /* What was heard: from where, on which socket ("answer" to our query, or "heard" on port 9003), and the packet read. */
    private sealed record Heard(IPEndPoint From, string How, Sood.Message Message);

    /* `mandarin-server raat-discover …`: 0 when it ran (whatever it found), 2 for arguments it doesn't take. */
    public static async Task<int> Command(string[] args)
    {
        var seconds = 4.0;
        var ids = new List<string>();
        string? to = null;
        var json = false;
        for (var i = 1; i < args.Length; i++)
        {
            var a = args[i];
            var next = i + 1 < args.Length ? args[i + 1] : null;
            if (a == "--json") json = true;
            else if (a == "--seconds" && double.TryParse(next, System.Globalization.CultureInfo.InvariantCulture, out var s) && s > 0 && s <= 60) { seconds = s; i++; }
            else if (a == "--service-id" && next is { Length: > 0 }) { ids.Add(next); i++; }
            else if (a == "--to" && next is { Length: > 0 }) { to = next; i++; }
            else
            {
                Console.Error.WriteLine("usage: raat-discover [--seconds N (up to 60)] [--service-id ID]… [--to HOST[:PORT]] [--json]");
                return 2;
            }
        }
        if (ids.Count == 0) ids.Add(Sood.CoreServiceId);
        IPEndPoint[] targets;
        try { targets = to != null ? [Target(to)] : []; }
        catch (Exception e) when (e is FormatException or SocketException or ArgumentException)
        {
            Console.Error.WriteLine("raat-discover: no such address: " + to);
            return 2;
        }
        var result = await Run(ids, targets, TimeSpan.FromSeconds(seconds), listen: to == null);
        Console.WriteLine(json ? result.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }) : Plain(result));
        return 0;
    }

    /* `mandarin-server sood-parse`: each base64 line of standard input read, a line of JSON out for each. */
    public static int ParseCommand()
    {
        string? line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            byte[] bytes;
            try { bytes = Convert.FromBase64String(line.Trim()); }
            catch (FormatException) { Console.WriteLine("null"); continue; }
            Console.WriteLine(Sood.Parse(bytes) is { } m ? Read(m).ToJsonString() : "null");
        }
        return 0;
    }

    /* HOST or HOST:PORT (SOOD's port where none is given). */
    private static IPEndPoint Target(string s)
    {
        var colon = s.LastIndexOf(':');
        var host = colon > 0 ? s[..colon] : s;
        var port = colon > 0 ? int.Parse(s[(colon + 1)..], System.Globalization.CultureInfo.InvariantCulture) : Sood.Port;
        var ip = IPAddress.TryParse(host, out var parsed) ? parsed : Dns.GetHostAddresses(host).First(a => a.AddressFamily == AddressFamily.InterNetwork);
        return new IPEndPoint(ip, port);
    }

    /* The query asked for each of [ids] (to [targets], or the group and broadcast on each network), and [window] listened. */
    private static async Task<JsonObject> Run(List<string> ids, IPEndPoint[] targets, TimeSpan window, bool listen)
    {
        var heard = new List<Heard>();
        // Our queries' ids, in any case: Roon Server, where it runs here, sends a query it hears on again with its id in capitals.
        var tids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var asked = new List<string>();
        using var cts = new CancellationTokenSource(window);
        using var send = new UdpClient(new IPEndPoint(IPAddress.Any, 0));
        var ourPort = ((IPEndPoint)send.Client.LocalEndPoint!).Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        send.EnableBroadcast = true;
        send.Client.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 1);
        var listener = listen ? Listen() : null;
        var networks = Topology.SearchAddresses(null, Undef.V).OfType<string>().ToList();

        void Ask(string id)
        {
            var tid = Guid.NewGuid().ToString();
            lock (asked)
            {
                if (asked.Contains(id)) return;
                asked.Add(id);
                tids.Add(tid);
            }
            var packet = Sood.Query([new("query_service_id", id), new("_tid", tid)]);
            foreach (var t in targets) Send(send, packet, t, null);
            if (targets.Length > 0) return;
            foreach (var net in networks.DefaultIfEmpty(null))
            {
                Send(send, packet, new IPEndPoint(IPAddress.Parse(Sood.Group), Sood.Port), net);
                Send(send, packet, new IPEndPoint(IPAddress.Broadcast, Sood.Port), net);
            }
        }

        async Task Receive(UdpClient sock, string how)
        {
            while (!cts.IsCancellationRequested)
            {
                UdpReceiveResult r;
                try { r = await sock.ReceiveAsync(cts.Token); }
                catch (Exception e) when (e is OperationCanceledException or SocketException or ObjectDisposedException) { return; }
                if (Sood.Parse(r.Buffer) is not { } m) continue;
                bool ours;
                lock (asked) ours = m["_tid"] is { } t && tids.Contains(t);
                // Our own query heard back: on the group, or sent on by Roon Server with where to answer added (ours).
                if (m.Type == 'Q' && (ours || m["_replyport"] == ourPort && m["_replyaddr"] is var at && (at == null || at.StartsWith("127.", StringComparison.Ordinal) || networks.Contains(at)))) continue;
                lock (heard) heard.Add(new Heard(r.RemoteEndPoint, how, m));
                // A query of another's asks for a service: asked for too (a Roon Core asking for its devices, say).
                if (m.Type == 'Q' && m["query_service_id"] is { Length: > 0 } wanted) Ask(wanted);
            }
        }

        foreach (var id in ids) Ask(id);
        var tasks = new List<Task> { Receive(send, "answer") };
        if (listener != null) tasks.Add(Receive(listener, "heard"));
        await Task.WhenAll(tasks);
        listener?.Dispose();
        return Result(heard, asked, tids, targets.Length > 0 ? targets.Select(t => t.ToString()).ToList() : networks, listener != null);
    }

    /* Port 9003 listened on, the group joined on each network; null where it can't be had (another program holding it alone). */
    private static UdpClient? Listen()
    {
        UdpClient? sock = null;
        try
        {
            sock = new UdpClient(AddressFamily.InterNetwork);
            sock.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            sock.Client.Bind(new IPEndPoint(IPAddress.Any, Sood.Port));
            var group = IPAddress.Parse(Sood.Group);
            foreach (var a in Topology.SearchAddresses(null, Undef.V))
            {
                try { if (a is string s) sock.JoinMulticastGroup(group, IPAddress.Parse(s)); else sock.JoinMulticastGroup(group); }
                catch (SocketException) { /* that network takes no group: the others still heard */ }
            }
            return sock;
        }
        catch (SocketException) { sock?.Dispose(); return null; }
    }

    /* [packet] to [to], out of the network at [from] where one is named; a network that won't send it is passed over. */
    private static void Send(UdpClient sock, byte[] packet, IPEndPoint to, string? from)
    {
        try
        {
            if (from != null) sock.Client.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, IPAddress.Parse(from).GetAddressBytes());
            sock.Send(packet, packet.Length, to);
        }
        catch (SocketException) { /* not this way: the other ways still asked */ }
    }

    /* A packet as JSON: its type and its properties as they came (a property of no value, null). */
    private static JsonObject Read(Sood.Message m)
    {
        var props = new JsonObject();
        foreach (var (k, v) in m.Props) if (!props.ContainsKey(k)) props[k] = v;
        return new JsonObject { ["type"] = m.Type.ToString(), ["props"] = props };
    }

    /* What was heard, each packet once from each sender (the same again not repeated), answers first. */
    private static JsonObject Result(List<Heard> heard, List<string> asked, HashSet<string> tids, List<string> via, bool listened)
    {
        var answers = new JsonArray();
        var others = new JsonArray();
        var seen = new HashSet<string>();
        foreach (var h in Enumerable.Reverse(heard))
        {
            // The same packet again from the same sender (an announcement repeated, each with its own id) shown once.
            if (!seen.Add(h.From + " " + h.Message.Type + " " + string.Join("\n", h.Message.Props.Where(p => p.Key != "_tid").Select(p => p.Key + "=" + p.Value)))) continue;
            var o = Read(h.Message);
            o["from"] = h.From.ToString();
            o["how"] = h.How;
            o["answers_our_query"] = h.Message["_tid"] is { } t && tids.Contains(t);
            (h.Message.Type == 'R' ? answers : others).Insert(0, o);
        }
        return new JsonObject
        {
            ["asked_for"] = new JsonArray([.. asked.Select(a => (JsonNode)a)]),
            ["sent_via"] = new JsonArray([.. via.Select(a => (JsonNode)a)]),
            ["listened_on_9003"] = listened,
            ["answers"] = answers,
            ["others_heard"] = others,
        };
    }

    /* The result as lines to read. */
    private static string Plain(JsonObject r)
    {
        var lines = new List<string> { "Asked for: " + string.Join(", ", r["asked_for"]!.AsArray().Select(x => (string?)x)) };
        if (!r["listened_on_9003"]!.GetValue<bool>()) lines.Add("(others' SOOD on port 9003 not listened to)");
        var answers = r["answers"]!.AsArray();
        lines.Add(answers.Count == 0 ? "No answers." : answers.Count + " answered:");
        foreach (var a in answers) Entry(lines, a!);
        var others = r["others_heard"]!.AsArray();
        if (others.Count > 0) lines.Add("Also heard on the network:");
        foreach (var a in others) Entry(lines, a!);
        return string.Join('\n', lines);
    }

    private static void Entry(List<string> lines, JsonNode a)
    {
        var props = a["props"]!.AsObject();
        lines.Add("  " + ((string?)props["name"] ?? "(no name)") + " — " + (string?)a["from"] + " (" + ((string?)a["type"] == "Q" ? "a query" : "an answer") + ")");
        foreach (var (k, v) in props) lines.Add("      " + k + ": " + (v == null ? "(no value)" : (string?)v));
    }
}
