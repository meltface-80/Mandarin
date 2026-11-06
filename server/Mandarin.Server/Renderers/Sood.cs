// Sood.cs — SOOD, the small UDP protocol Roon finds things on its network with (bug list item 309). Read and written
// here only so Mandarin can say which Roon Ready devices are on the network and what they say of themselves
// (RaatDiscover.cs); nothing here talks to a device beyond that.
//
// As Roon Labs' own open node-roon-api has it (sood.js, Apache 2.0), the reference this follows: a packet is "SOOD",
// the version 2, a type ('Q' a query, 'R' an answer), then properties to the end, each a name (a byte of length, then
// its UTF-8) and a value (two bytes of length, big-endian, then its UTF-8; 0xFFFF for no value at all). A name of no
// length, or a length past the packet's end, and the packet is not SOOD. Every property is kept as it came, none
// added or taken out, so what a device says is what is shown.
using System.Text;

namespace Mandarin.Server.Renderers;

internal static class Sood
{
    /* Where SOOD is sent and heard: UDP 9003, and the group 239.255.90.90 (sood.js). */
    public const int Port = 9003;
    public const string Group = "239.255.90.90";

    /* The service a Roon Core answers as, the one node-roon-api asks for (its lib.js). */
    public const string CoreServiceId = "00720724-5143-4a9b-abac-0e50cba674bb";

    /* A packet read: its type ('Q' or 'R', or whatever byte it had), and its properties in the order they came. */
    public sealed record Message(char Type, IReadOnlyList<KeyValuePair<string, string?>> Props)
    {
        /* The value of the first property of that name (null where it isn't there, or has no value). */
        public string? this[string name] => Props.FirstOrDefault(p => p.Key == name).Value;
    }

    /* [packet] read, or null where it isn't a SOOD packet of version 2 whole. */
    public static Message? Parse(ReadOnlySpan<byte> packet)
    {
        if (packet.Length < 6 || packet[0] != 'S' || packet[1] != 'O' || packet[2] != 'O' || packet[3] != 'D' || packet[4] != 2) return null;
        var type = (char)packet[5];
        var props = new List<KeyValuePair<string, string?>>();
        var pos = 6;
        while (pos < packet.Length)
        {
            int nameLen = packet[pos++];
            if (nameLen == 0 || pos + nameLen + 2 > packet.Length) return null;
            var name = Encoding.UTF8.GetString(packet.Slice(pos, nameLen));
            pos += nameLen;
            var valueLen = packet[pos] << 8 | packet[pos + 1];
            pos += 2;
            string? value;
            if (valueLen == 0xFFFF) value = null;
            else
            {
                if (pos + valueLen > packet.Length) return null;
                value = Encoding.UTF8.GetString(packet.Slice(pos, valueLen));
                pos += valueLen;
            }
            props.Add(new(name, value));
        }
        return new Message(type, props);
    }

    /* A query: "SOOD", 2, 'Q', then [props] in their order, a null value written as no value (0xFFFF). */
    public static byte[] Query(IEnumerable<KeyValuePair<string, string?>> props)
    {
        var o = new List<byte>(256) { (byte)'S', (byte)'O', (byte)'O', (byte)'D', 2, (byte)'Q' };
        foreach (var (name, value) in props)
        {
            var n = Encoding.UTF8.GetBytes(name);
            if (n.Length is 0 or > 255) throw new ArgumentException("a SOOD name is 1 to 255 bytes: " + name);
            o.Add((byte)n.Length);
            o.AddRange(n);
            if (value == null) { o.Add(0xFF); o.Add(0xFF); continue; }
            var v = Encoding.UTF8.GetBytes(value);
            if (v.Length >= 0xFFFF) throw new ArgumentException("a SOOD value is under 65535 bytes: " + name);
            o.Add((byte)(v.Length >> 8));
            o.Add((byte)(v.Length & 0xFF));
            o.AddRange(v);
        }
        return [.. o];
    }
}
