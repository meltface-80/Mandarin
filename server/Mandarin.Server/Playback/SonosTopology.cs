// SonosTopology.cs — finding Sonos players and reading who is grouped with
// whom (lib/sonos/topology.js, v0.8.49, stage 6 part 2). One reachable player
// can describe the whole household through ZoneGroupTopology, so SSDP only
// has to find one; the topology supplies the rest, including rooms whose
// announcements were missed. SONOS_HOSTS seeds it for networks where
// multicast is unreliable, and the players found last time are asked first
// (sonosKnownHosts, written here as the Node server wrote it). The pure parts
// — parseZoneGroupState, parseHeaders, lanAddresses, searchAddresses — are
// Topology.cs's (v0.8.37, held to topology.js by test/sonos-csharp.test.js).
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

/* One member of the household, as parseZoneGroupState gives it. */
internal sealed class SonosMember
{
    public string Uid = "", Name = "", Ip = "", CoordinatorUid = "", GroupId = "";
    public bool Invisible, IsBridge, StereoPair;

    public static SonosMember Of(JsObj m) => new()
    {
        Uid = Jv.Str(m["uid"]), Name = Jv.Str(m["name"]), Ip = Jv.Str(m["ip"]), CoordinatorUid = Jv.Str(m["coordinatorUid"]),
        GroupId = Jv.Str(m["groupId"]), Invisible = Jv.T(m["invisible"]), IsBridge = Jv.T(m["isBridge"]), StereoPair = Jv.T(m["stereoPair"])
    };
}

internal sealed class SonosTopology
{
    private const string SsdpAddr = "239.255.255.250";
    private const int SsdpPort = 1900;
    private const string ZonePlayerSt = "urn:schemas-upnp-org:device:ZonePlayer:1";
    // A player on the LAN answers in well under a second; one that hasn't in four is not there.
    private const int ProbeMs = 4000;

    private readonly object gate = new();
    private readonly List<string> seedHosts;
    private readonly string? bindIp;
    private readonly List<string> include, exclude;
    private readonly Action<string> log;
    private List<SonosMember> all = [];                    // the household, in the order given
    private readonly Dictionary<string, string> models = []; // uid -> model name ("" while asked), under the gate
    private List<string> recent = [];
    public double LastRefresh;
    public string LastError = "";
    /* The addresses of the rooms read (index.js onHosts): kept for next time. */
    public Action<List<string>>? OnHosts;

    public SonosTopology(IEnumerable<string> seedHosts, string? bindIp, IEnumerable<string> include, IEnumerable<string> exclude, Action<string> log)
    {
        this.seedHosts = seedHosts.ToList();
        this.bindIp = bindIp;
        this.include = include.Select(s => s.ToLowerInvariant()).ToList();
        this.exclude = exclude.Select(s => s.ToLowerInvariant()).ToList();
        this.log = log;
    }

    /* Every address worth asking: the rooms known, the players that answered discovery, the seeds. */
    public List<string> Hosts
    {
        get
        {
            lock (gate)
            {
                var s = new List<string>();
                foreach (var z in all) if (z.Ip.Length > 0 && !s.Contains(z.Ip)) s.Add(z.Ip);
                foreach (var h in recent) if (!s.Contains(h)) s.Add(h);
                foreach (var h in seedHosts) if (!s.Contains(h)) s.Add(h);
                return s;
            }
        }
    }

    public bool Allowed(string name)
    {
        var n = name.ToLowerInvariant();
        if (include.Count > 0 && !include.Contains(n)) return false;
        return !exclude.Contains(n);
    }

    // ------------------------------------------------------------ discovery

    /* M-SEARCH from every LAN address (or the pinned one); the hosts that answered as Sonos. */
    public static async Task<List<string>> Msearch(string? bindIp, int mx = 2, int attempts = 3)
    {
        var froms = Topology.SearchAddresses(bindIp is { Length: > 0 } ? bindIp : null, Undef.V).Select(a => a is string s ? s : null).ToList();
        var lists = await Task.WhenAll(froms.Select(a => MsearchFrom(a, mx, attempts)));
        var out_ = new List<string>();
        foreach (var l in lists) foreach (var h in l) if (!out_.Contains(h)) out_.Add(h);
        return out_;
    }

    private static async Task<List<string>> MsearchFrom(string? bindAddr, int mx, int attempts)
    {
        var found = new List<string>();
        var msg = Encoding.ASCII.GetBytes("M-SEARCH * HTTP/1.1\r\n" + $"HOST: {SsdpAddr}:{SsdpPort}\r\n" + "MAN: \"ssdp:discover\"\r\n" + $"MX: {mx}\r\n" + $"ST: {ZonePlayerSt}\r\n\r\n");
        UdpClient sock;
        try
        {
            sock = new UdpClient(AddressFamily.InterNetwork);
            sock.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            sock.Client.Bind(new IPEndPoint(bindAddr != null ? IPAddress.Parse(bindAddr) : IPAddress.Any, 0));
            try
            {
                sock.Client.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 4);
                if (bindAddr != null) sock.Client.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, IPAddress.Parse(bindAddr).GetAddressBytes());
            }
            catch (SocketException) { /* interface selection is best-effort; the default route still works */ }
        }
        catch (Exception e) when (e is SocketException or FormatException) { return found; }
        using (sock)
        {
            var until = DateTime.UtcNow.AddMilliseconds((mx + 1) * 1000);
            var dest = new IPEndPoint(IPAddress.Parse(SsdpAddr), SsdpPort);
            var sending = Task.Run(async () =>
            {
                for (var n = 0; n < attempts; n++)
                {
                    try { await sock.SendAsync(msg, msg.Length, dest); } catch (SocketException) { /* the next one, or none */ }
                    if (n + 1 < attempts) await Task.Delay(250);
                }
            });
            while (DateTime.UtcNow < until)
            {
                using var cts = new CancellationTokenSource(until - DateTime.UtcNow);
                UdpReceiveResult r;
                try { r = await sock.ReceiveAsync(cts.Token); }
                catch (OperationCanceledException) { break; }
                catch (SocketException) { break; }
                var h = Topology.ParseHeaders(r.Buffer);
                if (!System.Text.RegularExpressions.Regex.IsMatch(Jv.Str(h[""]), "^HTTP/1\\.1 200", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) continue;
                var host = r.RemoteEndPoint.Address.ToString();
                if (Jv.T(h["location"]) && WebUrl.Hostname(Jv.Str(h["location"])) is { Length: > 0 } hn) host = hn;
                var server = Jv.T(h["server"]) ? Jv.Str(h["server"]) : "";
                var st = Jv.T(h["st"]) ? Jv.Str(h["st"]) : "";
                if ((server.Contains("sonos", StringComparison.OrdinalIgnoreCase) || st.Contains("ZonePlayer", StringComparison.OrdinalIgnoreCase)) && !found.Contains(host)) found.Add(host);
            }
            try { await sending; } catch (Exception e) when (e is SocketException or ObjectDisposedException) { /* closed */ }
        }
        return found;
    }

    /* The player's model, from its description; "" when it doesn't say or can't be reached. */
    public static async Task<string> FetchModel(string ip)
    {
        try
        {
            var xml = await SonosDevice.HttpGet($"http://{ip}:{SonosDevice.Port}/xml/device_description.xml", 5000);
            var d = Xml.Prop(Xml.Prop(Xml.Parse(xml), "root"), "device");
            if (!Jv.T(d)) return "";
            var model = Xml.Text(Xml.Prop(d, "modelName"));
            return model.Length > 0 ? model : Xml.Text(Xml.Prop(d, "displayName"));
        }
        catch (Exception e) when (e is UPnPError or XmlRefused or JsError) { return ""; }
    }

    public async Task<List<string>> Discover()
    {
        var hosts = await Msearch(bindIp);
        lock (gate)
        {
            // Answered just now: asked first at the next refresh, ahead of addresses kept from before.
            recent = hosts;
            foreach (var h in hosts) if (!seedHosts.Contains(h)) seedHosts.Add(h);
            if (hosts.Count == 0 && seedHosts.Count == 0)
                LastError = "No Sonos players answered discovery. Use host networking, or set SONOS_HOSTS to a player's IP.";
        }
        return hosts;
    }

    /*
     * The household from any one player. The first known one is asked alone,
     * briefly; if it doesn't answer, the rest at once and the first answer
     * taken. True when anything changed.
     */
    public async Task<bool> Refresh()
    {
        string? xml = null;
        var errors = new List<string>();
        async Task<string> Ask(string host, int ms)
        {
            try
            {
                var x = await new SonosDevice(host).GetZoneGroupState(ms);
                if (x.Length > 0) return x;
                throw UPnPError.Of(501, "no household in the answer");
            }
            catch (UPnPError e) { lock (errors) errors.Add($"{host}: {e.Message}"); throw; }
        }
        var hosts = Hosts;
        if (hosts.Count > 0) { try { xml = await Ask(hosts[0], ProbeMs); } catch (UPnPError) { xml = null; } }
        if (xml == null && hosts.Count > 1)
        {
            var asks = hosts.Skip(1).Take(16).Select(h => Ask(h, ProbeMs)).ToList();
            while (asks.Count > 0 && xml == null)
            {
                var done = await Task.WhenAny(asks);
                asks.Remove(done);
                try { xml = await done; } catch (UPnPError) { xml = null; }
            }
            _ = Task.WhenAll(asks).ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);
        }
        if (xml == null)
        {
            lock (gate) if (errors.Count > 0) LastError = string.Join("; ", errors.Take(3));
            return false;
        }
        var members = Topology.ParseZoneGroupState(xml).Select(SonosMember.Of).ToList();
        if (members.Count == 0) return false;
        string before;
        List<string> ask = [];
        lock (gate)
        {
            before = Signature();
            // A uid seen twice keeps its first place and its last member, as a Map does.
            var next = new List<SonosMember>();
            foreach (var m in members) { var i = next.FindIndex(x => x.Uid == m.Uid); if (i >= 0) next[i] = m; else next.Add(m); }
            all = next;
            foreach (var m in all)
                if (!models.ContainsKey(m.Uid) && m.Ip.Length > 0 && !m.Invisible) { models[m.Uid] = ""; ask.Add(m.Uid); }
            LastRefresh = Hub.Now();
            LastError = "";
        }
        // A player that was busy or rebooting answers next time: not left nameless for good.
        foreach (var uid in ask)
        {
            var ip = members.First(m => m.Uid == uid).Ip;
            _ = FetchModel(ip).ContinueWith(t =>
            {
                lock (gate) { if (t.Result.Length > 0) models[uid] = t.Result; else models.Remove(uid); }
            }, TaskContinuationOptions.OnlyOnRanToCompletion);
        }
        try { OnHosts?.Invoke(members.Where(m => m.Ip.Length > 0 && !m.Invisible).Select(m => m.Ip).ToList()); }
        catch (Exception e) when (e is Microsoft.Data.Sqlite.SqliteException or IOException) { log($"[sonos] the hosts weren't kept: {e.Message}"); }
        lock (gate) return before != Signature();
    }

    /* index.js's onHosts: the addresses, sorted, kept as sonosKnownHosts when they changed. */
    public static void KeepHosts(List<string> ips)
    {
        var next = new JsonArray(ips.Distinct().OrderBy(s => s, StringComparer.Ordinal).Select(s => (JsonNode)s).ToArray());
        using var c = Db.Open();
        var cur = Db.Setting(c, "sonosKnownHosts") as JsonArray ?? [];
        if (cur.ToJsonString() != next.ToJsonString()) QueueStore.SetSetting(c, "sonosKnownHosts", next);
    }

    private string Signature() => string.Join(";", all.Select(m => $"{m.Uid}|{m.Name}|{m.CoordinatorUid}|{m.Ip}|{(m.Invisible ? "true" : "false")}").OrderBy(s => s, StringComparer.Ordinal));

    // ------------------------------------------------------------ reading

    /* Rooms a person plays to: not satellites, subs, or BOOST/BRIDGE units. */
    public List<SonosMember> Rooms() { lock (gate) return all.Where(m => !m.Invisible && !m.IsBridge && m.Ip.Length > 0 && Allowed(m.Name)).ToList(); }

    public SonosMember? Member(string? uid) { lock (gate) return all.FirstOrDefault(m => m.Uid == uid); }

    /* A player's model, "" while it is asked or when it doesn't say: read under this gate, where it is written (item 188). */
    public string Model(string uid) { lock (gate) return models.GetValueOrDefault(uid, ""); }

    public SonosMember? CoordinatorOf(string? uid)
    {
        lock (gate)
        {
            var m = all.FirstOrDefault(x => x.Uid == uid);
            if (m == null) return null;
            if (m.CoordinatorUid.Length == 0 || m.CoordinatorUid == uid) return m;
            return all.FirstOrDefault(x => x.Uid == m.CoordinatorUid) ?? m;
        }
    }

    /* Groups keyed by coordinator — Roon's "zone"; a coordinator hidden by INCLUDE/EXCLUDE still owns its group's queue. */
    public List<(SonosMember Coordinator, List<SonosMember> Members)> Groups()
    {
        var out_ = new List<(SonosMember Coordinator, List<SonosMember> Members)>();
        foreach (var room in Rooms())
        {
            var coord = CoordinatorOf(room.Uid) ?? room;
            var i = out_.FindIndex(g => g.Coordinator.Uid == coord.Uid);
            if (i < 0) { out_.Add((coord, [])); i = out_.Count - 1; }
            out_[i].Members.Add(room);
        }
        return out_;
    }

    public SonosDevice? Device(string? uid)
    {
        var m = Member(uid);
        return m != null && m.Ip.Length > 0 ? new SonosDevice(m.Ip, m.Uid, m.Name) : null;
    }
}
