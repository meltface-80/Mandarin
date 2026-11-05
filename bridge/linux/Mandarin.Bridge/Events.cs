// Events.cs — UPnP eventing (GENA), the device's side (the Android app's Events.kt): a control point SUBSCRIBEs to a
// service with a callback address and is given an id and a lifetime; from then on every change of the service's
// evented variables is sent to it as a NOTIFY (AVTransport and RenderingControl wrap theirs in a LastChange
// document), the first at once with everything. Renewed by its id, UNSUBSCRIBEd on the way out, or forgotten when it
// runs out or its callback stops answering three times.
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Bridge;

internal sealed partial class Events(string service, Action<string> log)
{
    private const int TimeoutS = 1800;

    private sealed class Sub(string sid, List<string> callbacks, DateTime expires)
    {
        public string Sid = sid;
        public List<string> Callbacks = callbacks;
        public DateTime Expires = expires;
        public long Seq;
        public int Failures;
    }

    private readonly List<Sub> subs = [];
    private readonly object gate = new();
    // One sender, in order: a subscriber hears its events as they happened.
    private readonly System.Threading.Channels.Channel<(Sub, string)> queue = System.Threading.Channels.Channel.CreateUnbounded<(Sub, string)>();
    private bool started;

    [GeneratedRegex(@"Second-(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex Lifetime();

    [GeneratedRegex("<([^>]+)>")]
    private static partial Regex Callback();

    private void Send(Sub s, string body)
    {
        lock (gate) { if (!started) { started = true; _ = Task.Run(Drain); } }
        queue.Writer.TryWrite((s, body));
    }

    private async Task Drain()
    {
        await foreach (var (s, body) in queue.Reader.ReadAllAsync()) await Notify(s, body);
    }

    /* SUBSCRIBE (new, or a renewal by [sid]): the id and lifetime to answer with, or null to refuse. */
    public (string Sid, int Seconds)? Subscribe(string? sid, string? callback, string? timeout, Func<string> current)
    {
        var m = Lifetime().Match(timeout ?? "");
        var life = m.Success && int.TryParse(m.Groups[1].Value, out var n) ? Math.Clamp(n, 60, 86400) : TimeoutS;
        lock (gate)
        {
            Prune();
            if (sid != null)
            {
                var s = subs.FirstOrDefault(x => x.Sid == sid);
                if (s == null) return null;
                s.Expires = DateTime.UtcNow.AddSeconds(life);
                return (s.Sid, life);
            }
            var urls = Callback().Matches(callback ?? "").Select(x => x.Groups[1].Value).Where(u => u.StartsWith("http://", StringComparison.Ordinal)).ToList();
            if (urls.Count == 0) return null;
            var sub = new Sub("uuid:" + Guid.NewGuid(), urls, DateTime.UtcNow.AddSeconds(life));
            subs.Add(sub);
            log($"[events] {service}: subscribed {urls[0]}");
            Send(sub, current());
            return (sub.Sid, life);
        }
    }

    public bool Unsubscribe(string sid) { lock (gate) return subs.RemoveAll(s => s.Sid == sid) > 0; }

    public int Count { get { lock (gate) { Prune(); return subs.Count; } } }

    /* Something changed: [body] (a propertyset) to every subscriber. */
    public void Changed(string body)
    {
        lock (gate) { Prune(); foreach (var s in subs) Send(s, body); }
    }

    private void Prune() { var now = DateTime.UtcNow; subs.RemoveAll(s => s.Expires < now); }

    // One NOTIFY to each of the subscriber's callbacks in turn, written by hand: NOTIFY is no method HttpClient knows to send plainly.
    private async Task Notify(Sub s, string body)
    {
        long seq;
        lock (gate) { if (!subs.Contains(s)) return; seq = s.Seq++; }
        var bytes = Encoding.UTF8.GetBytes(body);
        foreach (var url in s.Callbacks)
        {
            try
            {
                var u = new Uri(url);
                using var c = new TcpClient();
                using var cts = new CancellationTokenSource(5000);
                await c.ConnectAsync(u.Host, u.Port, cts.Token);
                var st = c.GetStream();
                var head = $"NOTIFY {u.PathAndQuery} HTTP/1.1\r\nHOST: {u.Host}:{u.Port}\r\nCONTENT-TYPE: text/xml; charset=\"utf-8\"\r\nCONTENT-LENGTH: {bytes.Length}\r\n" +
                           $"NT: upnp:event\r\nNTS: upnp:propchange\r\nSID: {s.Sid}\r\nSEQ: {seq}\r\nConnection: close\r\n\r\n";
                await st.WriteAsync(Encoding.Latin1.GetBytes(head), cts.Token);
                await st.WriteAsync(bytes, cts.Token);
                var line = await new StreamReader(st, Encoding.Latin1).ReadLineAsync(cts.Token) ?? "";
                var parts = line.Split(' ');
                if (parts.Length > 1 && int.TryParse(parts[1], out var code) && code is >= 200 and < 300) { lock (gate) s.Failures = 0; return; }
                log($"[events] {service}: NOTIFY {url} answered {line}");
            }
            catch (Exception e) when (e is SocketException or IOException or OperationCanceledException or UriFormatException) { log($"[events] {service}: NOTIFY {url}: {e.Message}"); }
        }
        lock (gate) { if (++s.Failures >= 3) { subs.Remove(s); log($"[events] {service}: {s.Callbacks[0]} dropped after {s.Failures} failures"); } }
    }

    /* The LastChange propertyset (AVTransport, RenderingControl): [vars] as val attributes under InstanceID 0. */
    public static string LastChange(string ns, IEnumerable<(string Name, string Value)> vars, ISet<string>? channel = null)
    {
        var ev = new StringBuilder("<Event xmlns=\"").Append(ns).Append("\"><InstanceID val=\"0\">");
        foreach (var (k, v) in vars) ev.Append('<').Append(k).Append(channel != null && channel.Contains(k) ? " channel=\"Master\"" : "").Append(" val=\"").Append(Xml.Escape(v)).Append("\"/>");
        ev.Append("</InstanceID></Event>");
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\"><e:property><LastChange>" + Xml.Escape(ev.ToString()) + "</LastChange></e:property></e:propertyset>";
    }

    /* A plain propertyset (ConnectionManager). */
    public static string PropertySet(IEnumerable<(string Name, string Value)> vars)
    {
        var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"utf-8\"?><e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\">");
        foreach (var (k, v) in vars) sb.Append("<e:property><").Append(k).Append('>').Append(Xml.Escape(v)).Append("</").Append(k).Append("></e:property>");
        return sb.Append("</e:propertyset>").ToString();
    }
}
