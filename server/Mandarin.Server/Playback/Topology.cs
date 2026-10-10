// Topology.cs — who is grouped with whom in a Sonos household: the pure parts
// of lib/sonos/topology.js (v0.8.37), rule for rule, held to it by
// test/sonos-csharp.test.js. Finding the players (SSDP) and asking one of them
// are left for stage 6 of docs/specs/csharp-migration.md, when playback moves;
// nothing here runs yet.
//
// One reachable player describes the whole household (GetZoneGroupState), so
// the rest is reading it:
//
//   - each ZoneGroup is a group, named by its coordinator; each member with a
//     UUID is a member, its address the host of its Location ("" when it has
//     none or the Location doesn't read as a URL, exactly as `new URL()` reads
//     it: UrlHost.cs);
//   - satellites, subs and the second of a pair are Invisible; BOOST and BRIDGE
//     units IsZoneBridge; a stereo pair is a ChannelMapSet with a left-only and
//     a right-only player (a home theatre's surrounds are HTSatChanMapSet,
//     kept but not a pair);
//   - the rooms a person plays to leave those out, and the INCLUDE/EXCLUDE
//     names; a group is keyed by its coordinator, which keeps its group even
//     when it is hidden itself (Household).
//
// Values are JavaScript's (Tags/Js.cs): a member's fields are whatever the
// XML reading gives (Xml.cs), so even an element standing where an attribute
// should be is carried through as the Node server carries it.
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal static class Topology
{
    /*
     * parseChannelMap(): "RINCON_A:LF,LF;RINCON_B:RF,RF" as { uid: [channels] }
     * (each list a Set: upper-cased, trimmed, empty ones and repeats dropped).
     * JavaScript's own trap kept: a uid "__proto__" sets the object's prototype
     * (to a Set) instead of adding a key, and a "size" after it is the TypeError
     * of a getter-only property.
     */
    public static JsObj ParseChannelMap(object? v)
    {
        var o = new JsObj();
        var protoIsSet = false;
        foreach (var entry in Js.Str(Js.Truthy(v) ? v : "").Split(';'))
        {
            var parts = entry.Split(':');
            var uid = parts[0];
            var chans = parts.Length > 1 ? parts[1] : "";
            if (uid.Length == 0 || chans.Length == 0) continue;
            var set = new List<object?>();
            foreach (var c in chans.Split(','))
            {
                var x = Js.Upper(Js.Trim(c));
                if (x.Length > 0 && !set.Contains(x)) set.Add(x);
            }
            var key = Js.Trim(uid);
            if (key == "__proto__") { protoIsSet = true; continue; }
            if (key == "size" && protoIsSet) throw new JsError("Cannot set property size of #<Set> which has only a getter");
            o[key] = set;
        }
        return o;
    }

    private static bool Only(object? set, string channel) => set is List<object?> { Count: 1 } l && l[0] is string s && s == channel;

    /* parseZoneGroupState(): every member of every group, in the order given ([] for anything unreadable). */
    public static List<JsObj> ParseZoneGroupState(object? xmlText)
    {
        var doc = Xml.Parse(Js.Trim(Js.Str(Js.Truthy(xmlText) ? xmlText : "")));
        if (doc == null) return [];
        var state = Xml.Prop(doc, "ZoneGroupState");
        var groupsParent = Js.Truthy(state) ? Xml.Prop(state, "ZoneGroups") : Xml.Prop(doc, "ZoneGroups");
        if (!Js.Truthy(groupsParent)) return [];
        var zones = new List<JsObj>();
        foreach (var group in Xml.ListOf(Xml.Prop(groupsParent, "ZoneGroup")))
        {
            var coordinator = Xml.Or(Xml.Prop(group, "@Coordinator"), "");
            var groupId = Xml.Or(Xml.Prop(group, "@ID"), "");
            foreach (var m in Xml.ListOf(Xml.Prop(group, "ZoneGroupMember")))
            {
                var uid = Xml.Prop(m, "@UUID");
                if (!Js.Truthy(uid)) continue;
                // No location, or one that isn't a URL: not addressable.
                var ip = UrlHost.Hostname(Js.Str(Xml.Or(Xml.Prop(m, "@Location"), ""))) ?? "";
                var map =ParseChannelMap(Xml.Or(Xml.Prop(m, "@ChannelMapSet"), ""));
                var sets = map.Keys.Select(k => map[k]).ToList();
                var z = new JsObj();
                z["uid"] = uid;
                z["name"] = Xml.Or(Xml.Prop(m, "@ZoneName"), uid);
                z["ip"] = ip;
                z["coordinatorUid"] = coordinator;
                z["groupId"] = groupId;
                z["invisible"] = Xml.Prop(m, "@Invisible") is "1";
                z["isBridge"] = Xml.Prop(m, "@IsZoneBridge") is "1";
                z["softwareVersion"] = Xml.Or(Xml.Prop(m, "@SoftwareVersion"), "");
                z["channelMap"] = Xml.Or(Xml.Or(Xml.Prop(m, "@ChannelMapSet"), Xml.Prop(m, "@HTSatChanMapSet")), "");
                z["stereoPair"] = sets.Any(c => Only(c, "LF")) && sets.Any(c => Only(c, "RF"));
                zones.Add(z);
            }
        }
        return zones;
    }

    /* parseHeaders(): an SSDP answer's first line under "", then each "Name: value" with the name lower-cased. */
    public static JsObj ParseHeaders(byte[] buf)
    {
        var lines = Regex.Split(new UTF8Encoding(false, false).GetString(buf), "\r?\n");
        var h = new JsObj();
        h[""] = Js.Trim(lines[0]);
        foreach (var line in lines.Skip(1))
        {
            var i = line.IndexOf(':');
            if (i <= 0) continue;
            var key = Js.Lower(Js.Trim(line[..i]));
            if (key == "__proto__") continue;   // a string given to __proto__ is ignored
            h[key] = Js.Trim(line[(i + 1)..]);
        }
        return h;
    }

    // -- this machine's LAN addresses, best first (v0.7.9), from the interfaces given (os.networkInterfaces()'s shape) --

    // Never where the speakers are (br0 isn't here: on a Linux host with VMs the LAN is often br0).
    private static readonly string[] VirtualPrefixes = ["docker", "br-", "veth", "virbr", "vmnet", "vboxnet", "lxcbr", "lxdbr", "cni", "flannel", "cali", "kube", "tailscale", "wg", "zt", "tun", "tap", "utun", "ppp", "ipsec"];
    private static bool IsVirtual(string name)
    {
        foreach (var p in VirtualPrefixes) if (name.StartsWith(p, StringComparison.OrdinalIgnoreCase) && Ascii(name, p.Length)) return true;
        // bridge\d+$
        if (name.Length > 6 && name.StartsWith("bridge", StringComparison.OrdinalIgnoreCase) && Ascii(name, 6) && name[6..].All(char.IsAsciiDigit)) return true;
        return false;
    }
    // /i without /u folds ASCII letters only (no Kelvin sign for k).
    private static bool Ascii(string name, int n) => name.Take(n).All(char.IsAscii);

    private static int ToInt32(double d)
    {
        if (double.IsNaN(d) || double.IsInfinity(d)) return 0;
        var t = Math.Truncate(d) % 4294967296.0;
        if (t < 0) t += 4294967296.0;
        return unchecked((int)(uint)t);
    }

    private static double? Ipv4Int(object? ip)
    {
        var p = Js.Str(ip).Split('.').Select(Js.StringToNumber).ToList();
        if (p.Count != 4 || !p.All(n => n >= 0 && n <= 255)) return null;
        return (double)(uint)(ToInt32(p[0]) << 24) + (ToInt32(p[1]) << 16) + (ToInt32(p[2]) << 8) + p[3];
    }

    private static bool InRange(object? ip, string net, int bits)
    {
        if (Ipv4Int(ip) is not { } a || Ipv4Int(net) is not { } b) return false;
        var m = bits != 0 ? (uint)(-1 << (32 - bits)) : 0u;
        return ((uint)ToInt32(a) & m) == ((uint)ToInt32(b) & m);
    }
    private static bool IsPrivate(object? ip) => InRange(ip, "10.0.0.0", 8) || InRange(ip, "172.16.0.0", 12) || InRange(ip, "192.168.0.0", 16);
    private static bool IsLinkLocal(object? ip) => InRange(ip, "169.254.0.0", 16);
    private static bool IsCgnat(object? ip) => InRange(ip, "100.64.0.0", 10);   // Tailscale's addresses, carrier NAT

    /* Object.entries() of what JSON can carry. */
    private static IEnumerable<(string, object?)> Entries(object? o) => o switch
    {
        JsObj j => j.Keys.Select(k => (k, j[k])),
        List<object?> l => l.Select((v, i) => (i.ToString(System.Globalization.CultureInfo.InvariantCulture), v)),
        string s => s.Select((c, i) => (i.ToString(System.Globalization.CultureInfo.InvariantCulture), (object?)c.ToString())),
        _ => []
    };

    /* lanAddresses(): every non-internal IPv4, best first ([{ name, address, lan }]): private LAN, then other, then link-local or CGNAT, then virtual. */
    public static List<JsObj> LanAddresses(object? ifs)
    {
        var found = new List<(string Name, object? Address, int Rank)>();
        foreach (var (name, addrs0) in Entries(Js.Truthy(ifs) ? ifs : new JsObj()))
        {
            var addrs = Js.Truthy(addrs0) ? addrs0 : new List<object?>();
            IEnumerable<object?> each = addrs switch
            {
                List<object?> l => l,
                string s => s.Select(c => (object?)c.ToString()),
                _ => throw new JsError("addrs is not iterable")
            };
            foreach (var a in each)
            {
                if (!Js.Truthy(a)) continue;
                var family = Xml.Prop(a, "family");
                if (family is not ("IPv4" or 4.0) || Js.Truthy(Xml.Prop(a, "internal"))) continue;
                var address = Xml.Prop(a, "address");
                var rank = IsVirtual(name) ? 3 : IsPrivate(address) ? 0 : IsLinkLocal(address) || IsCgnat(address) ? 2 : 1;
                found.Add((name, address, rank));
            }
        }
        // Stable within a rank: the order the system lists its interfaces in.
        return found.Select((x, i) => (x, i)).OrderBy(t => t.x.Rank).ThenBy(t => t.i).Select(t =>
        {
            var o = new JsObj();
            o["name"] = t.x.Name;
            o["address"] = t.x.Address;
            o["lan"] = t.x.Rank < 2;
            return o;
        }).ToList();
    }

    /* localIp(): SERVER_IP when pinned, else the best LAN address, else loopback. */
    public static object? LocalIp(object? preferred, object? ifs)
    {
        if (Js.Truthy(preferred)) return preferred;
        return LanAddresses(ifs) is { Count: > 0 } l ? l[0]["address"] : "127.0.0.1";
    }

    /* searchAddresses(): where to search from: the pinned address; else up to four LAN addresses; else the default route (undefined). */
    public static List<object?> SearchAddresses(object? bindIp, object? ifs)
    {
        if (bindIp is "127.0.0.1") return [Undef.V];
        if (Js.Truthy(bindIp)) return [bindIp];
        var lan = new List<object?>();
        foreach (var a in LanAddresses(ifs).Where(a => a["lan"] is true).Select(a => a["address"]))
            if (!lan.Any(x => SameValueZero(x, a))) lan.Add(a);
        return lan.Count > 0 ? lan.Take(4).ToList() : [Undef.V];
    }

    /* SameValueZero: === but NaN equals NaN (Set and Map keys). */
    public static bool SameValueZero(object? a, object? b) =>
        a is double x && b is double y ? x == y || (double.IsNaN(x) && double.IsNaN(y)) : Js.StrictEq(a, b);
}

/*
 * The household as the Topology class keeps it after a refresh (`all`, a Map
 * of the members by uid: a uid seen twice keeps its first place and its last
 * member), and what is read from it: the rooms, the groups, a member's
 * coordinator, the signature that says whether anything changed.
 */
internal sealed class Household
{
    private readonly List<object?> uids = [];
    private readonly List<JsObj> members = [];
    private readonly List<string> include, exclude;

    public Household(IEnumerable<JsObj> all, IEnumerable<string> include, IEnumerable<string> exclude)
    {
        this.include = include.Select(Js.Lower).ToList();
        this.exclude = exclude.Select(Js.Lower).ToList();
        foreach (var m in all)
        {
            var i = uids.FindIndex(u => Topology.SameValueZero(u, m["uid"]));
            if (i >= 0) members[i] = m;
            else { uids.Add(m["uid"]); members.Add(m); }
        }
    }

    public JsObj? Member(object? uid)
    {
        var i = uids.FindIndex(u => Topology.SameValueZero(u, uid));
        return i >= 0 ? members[i] : null;
    }

    public bool Allowed(object? name)
    {
        var n = Js.Lower(Js.Str(Js.Truthy(name) ? name : ""));
        if (include.Count > 0 && !include.Contains(n)) return false;
        return !exclude.Contains(n);
    }

    /* Rooms a person plays to: not satellites, subs, or BOOST/BRIDGE units. */
    public List<JsObj> Rooms() => members.Where(m => !Js.Truthy(m["invisible"]) && !Js.Truthy(m["isBridge"]) && Js.Truthy(m["ip"]) && Allowed(m["name"])).ToList();

    public JsObj? CoordinatorOf(object? uid)
    {
        var m = Member(uid);
        if (m == null) return null;
        if (!Js.Truthy(m["coordinatorUid"]) || Js.StrictEq(m["coordinatorUid"], uid)) return m;
        return Member(m["coordinatorUid"]) ?? m;
    }

    /* Groups keyed by coordinator; a coordinator hidden by INCLUDE/EXCLUDE still owns its group's queue, so the group stays. */
    public List<(JsObj Coordinator, List<JsObj> Members)> Groups()
    {
        var keys = new List<object?>();
        var groups = new List<(JsObj Coordinator, List<JsObj> Members)>();
        foreach (var room in Rooms())
        {
            var coord = CoordinatorOf(room["uid"]) ?? room;
            var i = keys.FindIndex(k => Topology.SameValueZero(k, coord["uid"]));
            if (i < 0) { keys.Add(coord["uid"]); groups.Add((coord, [])); i = groups.Count - 1; }
            groups[i].Members.Add(room);
        }
        return groups;
    }

    public string Signature() => string.Join(";", members
        .Select(m => $"{Js.Str(m["uid"])}|{Js.Str(m["name"])}|{Js.Str(m["coordinatorUid"])}|{Js.Str(m["ip"])}|{Js.Str(m["invisible"])}")
        .OrderBy(s => s, StringComparer.Ordinal));
}
