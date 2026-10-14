using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The Android app's page reaches the server through the app's relay, which the WebView treats as a
/// web proxy: the request line carries the whole address. The server must answer those exactly as it
/// answers the usual kind (test/relay.test.js, in C#).
/// </summary>
public sealed partial class RelayTests
{
    [GeneratedRegex(@"HTTP/1\.1 \d{3}")] private static partial Regex StatusLine();

    // Raw HTTP/1.1 on one connection: everything said back, once every request has its answer.
    private static async Task<string> RawRequests(int port, string[] requests)
    {
        using var c = new TcpClient();
        await c.ConnectAsync("127.0.0.1", port);
        var stream = c.GetStream();
        await stream.WriteAsync(Encoding.ASCII.GetBytes(string.Concat(requests)));
        var buf = new StringBuilder();
        var chunk = new byte[16384];
        using var cut = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        while (true)
        {
            int n;
            try { n = await stream.ReadAsync(chunk, cut.Token); } catch (OperationCanceledException) { break; }
            if (n == 0) break;
            buf.Append(Encoding.UTF8.GetString(chunk, 0, n));
            var s = buf.ToString();
            if (StatusLine().Matches(s).Count >= requests.Length && s.Contains("\r\n\r\n", StringComparison.Ordinal))
            {
                await Task.Delay(150);
                if (stream.DataAvailable) continue;
                break;
            }
        }
        return buf.ToString();
    }

    [Test]
    public async Task Requests_relayed_with_the_whole_address_are_answered_as_usual()
    {
        Needs.Server();
        var dir = Directory.CreateTempSubdirectory("musicd-relay-").FullName;
        Directory.CreateDirectory(Path.Combine(dir, "music"));
        await using var srv = await new TestServer(Ports.Port(), Path.Combine(dir, "music"), Path.Combine(dir, "data"),
            new Dictionary<string, object?> { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>() }).Start();
        var token = await Session.SignIn(srv.Base);
        int port = srv.Port;
        var home = "http://192.168.1.10:" + port;
        var said = await RawRequests(port, [
            $"GET {home}/api/health HTTP/1.1\r\nHost: 192.168.1.10:{port}\r\nProxy-Connection: keep-alive\r\n\r\n",
            $"GET {home}/api/auth/status HTTP/1.1\r\nHost: 192.168.1.10:{port}\r\nCookie: musicd_session={token}\r\n\r\n",
            // Not signed in, asking for a page: sent to sign in, with a path to come back to — not the whole address.
            $"GET {home}/library?x=1 HTTP/1.1\r\nHost: 192.168.1.10:{port}\r\nAccept: text/html\r\nConnection: close\r\n\r\n"
        ]);
        var statuses = StatusLine().Matches(said).Select(m => m.Value).ToList();
        Assert.Equal("HTTP/1.1 200", statuses[0]);
        Assert.Equal("HTTP/1.1 200", statuses[1]);
        Assert.Contains("\"signed_in\":true", said, StringComparison.Ordinal);
        var loc = Regex.Match(said, @"Location: ([^\r\n]+)", RegexOptions.IgnoreCase);
        if (loc.Success) Assert.True(loc.Groups[1].Value.StartsWith('/'), "a path, not an address: " + loc.Groups[1].Value);
    }
}
