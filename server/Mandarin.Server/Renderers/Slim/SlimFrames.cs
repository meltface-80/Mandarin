// SlimFrames.cs — SlimProto's frames, read and made (bug list item 312). SlimProto is how a Squeezebox, a Squeezelite
// player or a Mandarin Bridge is played: the player connects to the server at TCP 3483 and says who it is (HELO) and
// how it is doing (STAT); the server tells it what to fetch and play (strm), at what volume (audg). Laid out as the
// open Squeezelite has them (slimproto.h, slimproto.c, pcm.c): a player's frame is four letters, a 4-byte big-endian
// length and that many bytes; the server's, a 2-byte big-endian length, then four letters and the rest.
using System.Buffers.Binary;
using System.Text;

namespace Mandarin.Server.Renderers.Slim;

internal static class SlimFrames
{
    /* SlimProto's port, TCP and UDP. */
    public const int Port = 3483;

    /* The rates a strm can name, each by its place in this list as a character from '0' (pcm.c's sample_rates). */
    private static readonly int[] Rates = [11025, 22050, 32000, 44100, 48000, 8000, 12000, 16000, 24000, 96000, 88200, 176400, 192000, 352800, 384000, 0, 705600, 768000, 1411200, 1536000];

    /* [hz] as strm names it, or null where it can't. */
    public static char? RateCode(int hz) => hz > 0 && Array.IndexOf(Rates, hz) is var i and >= 0 ? (char)('0' + i) : null;

    /* The rate a strm's character names (0 for none). */
    public static int RateOf(char code) => code - '0' is var i && i >= 0 && i < Rates.Length ? Rates[i] : 0;

    /* A player's hello: what kind it is, its MAC (its identity), and what it can play, its capabilities as it wrote them. */
    public sealed record Helo(byte DeviceId, byte Revision, string Mac, bool Reconnect, ulong BytesReceived, string Capabilities)
    {
        /* Its capabilities read: "Key=value" pairs, and the bare words (the codecs it plays: flc, pcm, dsf, …). */
        public (IReadOnlyDictionary<string, string> Pairs, IReadOnlyList<string> Words) Caps()
        {
            var pairs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var words = new List<string>();
            foreach (var part in Capabilities.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var eq = part.IndexOf('=');
                if (eq > 0) pairs.TryAdd(part[..eq], part[(eq + 1)..]);
                else words.Add(part.ToLowerInvariant());
            }
            return (pairs, words);
        }
    }

    /* [payload] of a HELO read, or null where it is too short to be one. */
    public static Helo? ReadHelo(ReadOnlySpan<byte> payload)
    {
        if (payload.Length < 36) return null;
        var mac = string.Join(':', payload.Slice(2, 6).ToArray().Select(b => b.ToString("x2", System.Globalization.CultureInfo.InvariantCulture)));
        var wlan = BinaryPrimitives.ReadUInt16BigEndian(payload[24..]);
        var bytes = (ulong)BinaryPrimitives.ReadUInt32BigEndian(payload[26..]) << 32 | BinaryPrimitives.ReadUInt32BigEndian(payload[30..]);
        return new Helo(payload[0], payload[1], mac, (wlan & 0x4000) != 0, bytes, Encoding.UTF8.GetString(payload[36..]));
    }

    /* A player's status: the event it reports (STMs a track started, STMd the last of its stream read, STMu run out, STMt
       the answer to the server's every few seconds, …), how far into the track it is playing, and what it has buffered. */
    public sealed record Stat(string Event, ulong BytesReceived, uint StreamBufferFullness, uint OutputBufferFullness, uint ElapsedMs, uint Jiffies, uint ServerTimestamp, ushort Error);

    /* [payload] of a STAT read, or null where it is too short to be one. */
    public static Stat? ReadStat(ReadOnlySpan<byte> payload)
    {
        if (payload.Length < 47) return null;
        var bytes = (ulong)BinaryPrimitives.ReadUInt32BigEndian(payload[15..]) << 32 | BinaryPrimitives.ReadUInt32BigEndian(payload[19..]);
        return new Stat(Encoding.ASCII.GetString(payload[..4]), bytes,
            BinaryPrimitives.ReadUInt32BigEndian(payload[11..]),
            BinaryPrimitives.ReadUInt32BigEndian(payload[33..]),
            BinaryPrimitives.ReadUInt32BigEndian(payload[43..]),
            BinaryPrimitives.ReadUInt32BigEndian(payload[25..]),
            payload.Length >= 51 ? BinaryPrimitives.ReadUInt32BigEndian(payload[47..]) : 0,
            payload.Length >= 53 ? BinaryPrimitives.ReadUInt16BigEndian(payload[51..]) : (ushort)0);
    }

    /* A server frame: its length (2 bytes, the command's four letters and the rest), the command, [body]. */
    private static byte[] Frame(string command, ReadOnlySpan<byte> body)
    {
        var o = new byte[2 + 4 + body.Length];
        BinaryPrimitives.WriteUInt16BigEndian(o, (ushort)(4 + body.Length));
        Encoding.ASCII.GetBytes(command, o.AsSpan(2, 4));
        body.CopyTo(o.AsSpan(6));
        return o;
    }

    /* What a stream is, as strm says it: its codec ('f' FLAC, 'p' PCM, 'd' DSD in a DSF or DFF), and for PCM its depth,
       rate, channels and byte order (a WAV's header says them itself: '?' each). */
    public sealed record Format(char Codec, char Size = '?', char Rate = '?', char Channels = '?', char Endian = '?');

    /* strm: [command] ('s' start, 'q' stop and forget, 'p' pause, 'u' go on, 't' how are you), for 's' the stream at
       [request] (an HTTP request) from the server at [ip]:[port] (0 for the one it is connected to), autostart once
       [thresholdKb] is buffered; [interval] is a pause's or skip's length (ms) or a 't''s timestamp, as the player answers it. */
    public static byte[] Strm(char command, Format? format = null, string request = "", ushort port = 0, uint ip = 0, uint interval = 0, char autostart = '1', byte thresholdKb = 255, byte flags = 0)
    {
        var f = format ?? new Format('p', '0', '0', '0', '0');
        var req = Encoding.ASCII.GetBytes(request);
        var b = new byte[24 + req.Length];
        b[0] = (byte)command;
        b[1] = (byte)autostart;
        b[2] = (byte)f.Codec;
        b[3] = (byte)f.Size;
        b[4] = (byte)f.Rate;
        b[5] = (byte)f.Channels;
        b[6] = (byte)f.Endian;
        b[7] = thresholdKb;
        b[8] = (byte)'0';       // no S/PDIF override
        b[9] = 0;               // no crossfade: transition period
        b[10] = (byte)'0';      // and type
        b[11] = flags;
        b[12] = 0;              // output threshold
        b[13] = 0;              // slaves
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(14), interval);
        BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(18), port);
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(20), ip);
        req.CopyTo(b, 24);
        return Frame("strm", b);
    }

    /* audg: the volume, [level] from 0 to 1, as the player's gain (16.16 fixed point, 1 unity). */
    public static byte[] Audg(double level)
    {
        var g = (uint)Math.Round(Math.Clamp(level, 0, 1) * 65536);
        var b = new byte[18];
        BinaryPrimitives.WriteUInt32BigEndian(b, g);          // the old gains, for old players
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(4), g);
        b[8] = 1;                                               // adjust: the new gains are meant
        b[9] = 255;                                             // preamp
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(10), g);
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(14), g);
        return Frame("audg", b);
    }

    /* mtrk: a Mandarin Bridge playing Mandarin's continuous PCM told the track it has come to in it (item 322), as a
       track's request says it ([headers]: X-Mandarin-Title and the rest), for its screen. */
    public static byte[] Mtrk(string headers) => Frame("mtrk", Encoding.ASCII.GetBytes(headers));

    /* aude: its outputs on or off. */
    public static byte[] Aude(bool spdif, bool dac) => Frame("aude", [(byte)(spdif ? 1 : 0), (byte)(dac ? 1 : 0)]);

    /* setd: a setting asked for (no [data]) or set; 0 is the player's name. */
    public static byte[] Setd(byte id, string? data = null)
    {
        var d = data == null ? [] : Encoding.UTF8.GetBytes(data + "\0");
        var b = new byte[1 + d.Length];
        b[0] = id;
        d.CopyTo(b, 1);
        return Frame("setd", b);
    }

    /* The answer to a player's discovery ('e'): 'E', then each of [tags] (four letters, a byte of length, the value),
       as Lyrion Music Server answers — a Squeezelite reads only who answered; a Mandarin Bridge reads the rest. */
    public static byte[] Discovered(params (string Tag, string Value)[] tags)
    {
        var o = new List<byte> { (byte)'E' };
        foreach (var (tag, value) in tags)
        {
            var v = Encoding.UTF8.GetBytes(value);
            if (tag.Length != 4 || v.Length > 255) continue;
            o.AddRange(Encoding.ASCII.GetBytes(tag));
            o.Add((byte)v.Length);
            o.AddRange(v);
        }
        return [.. o];
    }
}
