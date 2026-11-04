// Http.cs — the smallest HTTP/1.1 server a UPnP device needs (the Android app's HttpServer.kt): one request per
// connection (closed after), the method, path and headers read, a body of the length the request states, and a
// handler that answers with a status, headers and bytes. UPnP's own methods (SUBSCRIBE, UNSUBSCRIBE) come through like
// any other, which is why no web framework is used.
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Mandarin.Bridge;

internal sealed class Http(int port, Func<Http.Request, Http.Response> handle, Action<string> log)
{
    private const int BodyMax = 1024 * 1024;

    public sealed record Request(string Method, string Path, string Query, Dictionary<string, string> Headers, byte[] Body, string From)
    {
        public string? Header(string name) => Headers.GetValueOrDefault(name.ToLowerInvariant());
        public string Text => Encoding.UTF8.GetString(Body);
    }

    public sealed record Response(int Status, byte[] Body, string Type = "text/xml; charset=\"utf-8\"", Dictionary<string, string>? Headers = null)
    {
        public static Response Text(int status, string text, string type = "text/xml; charset=\"utf-8\"", Dictionary<string, string>? headers = null) =>
            new(status, Encoding.UTF8.GetBytes(text), type, headers);
    }

    private TcpListener? listener;
    private volatile bool running;

    public int Port => (listener?.LocalEndpoint as IPEndPoint)?.Port ?? port;

    public void Start()
    {
        listener = new TcpListener(IPAddress.Any, port);
        listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
        listener.Start();
        running = true;
        new Thread(Accept) { IsBackground = true, Name = "http-accept" }.Start();
        log($"[http] listening on {Port}");
    }

    public void Stop() { running = false; try { listener?.Stop(); } catch (SocketException) { /* gone */ } }

    private void Accept()
    {
        while (running)
        {
            TcpClient c;
            try { c = listener!.AcceptTcpClient(); }
            catch (Exception e) when (e is SocketException or ObjectDisposedException or InvalidOperationException) { if (running) log("[http] accept: " + e.Message); break; }
            ThreadPool.QueueUserWorkItem(_ => Serve(c));
        }
    }

    private void Serve(TcpClient c)
    {
        using (c)
        {
            try
            {
                c.ReceiveTimeout = c.SendTimeout = 10_000;
                var s = c.GetStream();
                var from = (c.Client.RemoteEndPoint as IPEndPoint)?.Address.ToString() ?? "";
                if (Read(s, from) is not { } req) return;
                Response res;
                try { res = handle(req); }
                catch (Exception e) { log($"[http] {req.Method} {req.Path}: {e.Message}"); res = Response.Text(500, "<error>" + Xml.Escape(e.Message) + "</error>"); }
                var head = new StringBuilder()
                    .Append("HTTP/1.1 ").Append(res.Status).Append(' ').Append(Reason(res.Status)).Append("\r\n")
                    .Append("Server: Linux UPnP/1.0 MandarinBridge/").Append(Program.Version).Append("\r\n")
                    .Append("Content-Type: ").Append(res.Type).Append("\r\n")
                    .Append("Content-Length: ").Append(res.Body.Length).Append("\r\n")
                    .Append("Connection: close\r\nEXT:\r\n");
                foreach (var (k, v) in res.Headers ?? []) head.Append(k).Append(": ").Append(v).Append("\r\n");
                head.Append("\r\n");
                s.Write(Encoding.Latin1.GetBytes(head.ToString()));
                if (req.Method != "HEAD") s.Write(res.Body);
                s.Flush();
            }
            catch (Exception e) when (e is IOException or SocketException or ObjectDisposedException) { /* the other end went */ }
        }
    }

    private static Request? Read(NetworkStream s, string from)
    {
        var head = new MemoryStream();
        var last4 = 0;
        while (true)
        {
            var b = s.ReadByte();
            if (b < 0) { if (head.Length == 0) return null; break; }
            head.WriteByte((byte)b);
            last4 = (last4 << 8) | b;
            if (last4 == 0x0d0a0d0a) break;
            if (head.Length > 64 * 1024) throw new IOException("header too long");
        }
        var lines = Encoding.Latin1.GetString(head.ToArray()).Split("\r\n").Where(l => l.Length > 0).ToArray();
        if (lines.Length == 0) return null;
        var parts = lines[0].Split(' ');
        if (parts.Length < 2) throw new IOException("bad request line");
        var q = parts[1].IndexOf('?');
        var path = q < 0 ? parts[1] : parts[1][..q];
        var query = q < 0 ? "" : parts[1][(q + 1)..];
        var headers = new Dictionary<string, string>();
        foreach (var l in lines.Skip(1))
        {
            var i = l.IndexOf(':');
            if (i > 0) headers[l[..i].Trim().ToLowerInvariant()] = l[(i + 1)..].Trim();
        }
        var length = int.TryParse(headers.GetValueOrDefault("content-length"), out var n) ? n : 0;
        if (length is < 0 or > BodyMax) throw new IOException("body too long");
        var body = new byte[length];
        s.ReadExactly(body);
        return new Request(parts[0].ToUpperInvariant(), path, query, headers, body, from);
    }

    private static string Reason(int status) => status switch
    {
        200 => "OK", 202 => "Accepted", 303 => "See Other", 400 => "Bad Request", 404 => "Not Found", 405 => "Method Not Allowed",
        409 => "Conflict", 412 => "Precondition Failed", 500 => "Internal Server Error", _ => "OK",
    };
}
