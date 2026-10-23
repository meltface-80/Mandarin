// Soloist.Socket.cs — Soloist's WebSocket (bug list item 142): signed in or not, whether the Spotify app has chosen
// it, what plays, playing / paused / idle, its volume; and the commands Now Playing sends back. A part of Soloist
// (Soloist.cs), sharing its state and its lock; as Mandarin DAC Bridge's SoloistSocket.cs.
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Mandarin.Server.Spotify;

internal sealed partial class Soloist
{
    private void Listen()
    {
        var portFile = Path.Combine(dataDir, "ws.port");
        var until = Environment.TickCount64 + 20_000;
        while (!File.Exists(portFile))
        {
            if (soloist is not { HasExited: false } || stop.IsCancellationRequested) return;
            if (Environment.TickCount64 > until) throw new InvalidOperationException("Soloist didn't open its WebSocket" + (soloistError != "" ? ": " + soloistError : ""));
            Wait(100);
        }
        Wait(100);
        var port = File.ReadAllText(portFile).Trim();
        var addrFile = Path.Combine(dataDir, "ws.addr");
        var addr = File.Exists(addrFile) ? File.ReadAllText(addrFile).Trim() : "127.0.0.1";
        if (addr is "" or "0.0.0.0") addr = "127.0.0.1";
        if (addr.Contains(':') && !addr.StartsWith('[')) addr = $"[{addr}]";
        var w = new ClientWebSocket();
        lock (gate) ws = w;
        w.ConnectAsync(new Uri($"ws://{addr}:{port}"), stop.Token).Wait(TimeSpan.FromSeconds(10));
        if (w.State != WebSocketState.Open) throw new InvalidOperationException("couldn't reach Soloist's WebSocket");
        SetStatus(Unpaired);
        lastError = "";

        var buf = new byte[1 << 16];
        using var msg = new MemoryStream();
        while (!stop.IsCancellationRequested && w.State == WebSocketState.Open)
        {
            WebSocketReceiveResult got;
            try { got = w.ReceiveAsync(buf, stop.Token).GetAwaiter().GetResult(); }
            catch (Exception e) when (e is WebSocketException or OperationCanceledException or ObjectDisposedException) { return; }
            if (got.MessageType == WebSocketMessageType.Close) return;
            msg.Write(buf, 0, got.Count);
            if (!got.EndOfMessage) continue;
            try
            {
                using var doc = JsonDocument.Parse(msg.ToArray());
                OnMessage(doc.RootElement);
            }
            catch (JsonException) { /* not JSON: skip it */ }
            msg.SetLength(0);
        }
    }

    /* A command to Soloist: {"type":"command","command":…} with [extra] fields ("" for none). Dropped when it isn't up. */
    public async Task Command(string command, string extra = "")
    {
        ClientWebSocket? w;
        lock (gate) w = ws;
        if (w is not { State: WebSocketState.Open }) return;
        var json = "{\"type\":\"command\",\"command\":" + JsonSerializer.Serialize(command, SoloistJson.Default.String) + (extra != "" ? "," + extra : "") + "}";
        await sendGate.WaitAsync();
        try { await w.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, stop.Token); }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException or ObjectDisposedException) { /* closing */ }
        finally { sendGate.Release(); }
    }

    internal void OnMessage(JsonElement m)
    {
        switch (Str(m, "type"))
        {
            case "auth_state":
                Keep("[mandarin] " + m.GetRawText());
                bool signedIn = Bool(m, "logged_in"), active = m.TryGetProperty("is_active", out _) ? Bool(m, "is_active") : Active;
                if (signedIn != SignedIn || active != Active)
                {
                    lock (gate) { SignedIn = signedIn; Active = active; }
                    Log(signedIn ? $"Soloist is signed in{(active ? ", and the Spotify app has chosen it" : "")}" : "Soloist is waiting for the Spotify app to choose it");
                }
                if (!signedIn) SetStatus(Unpaired);
                else if (!active && Playback == "idle") SetStatus(Waiting);
                if (signedIn) SignedInNow();
                Changed?.Invoke();
                break;
            case "device_changed":
                // Whether this Soloist is the account's active Connect device: "playing" is the account's, not ours.
                if (m.TryGetProperty("is_active", out _) && Bool(m, "is_active") != Active)
                {
                    lock (gate) Active = Bool(m, "is_active");
                    Changed?.Invoke();
                }
                break;
            case "playback_state":
                Keep("[mandarin] " + Clip(m.GetRawText()));
                if (m.TryGetProperty("is_active", out _)) lock (gate) Active = Bool(m, "is_active");
                if (m.TryGetProperty("item", out var item)) SetItem(item);
                if (m.TryGetProperty("position", out var pos)) SetPosition(pos);
                HoldVolume(m);
                Apply(Str(m, "status"));
                break;
            case "track_changed":
                Keep("[mandarin] " + Clip(m.GetRawText()));
                if (m.TryGetProperty("item", out var it)) SetItem(it);
                break;
            case "playback_changed":
                Keep("[mandarin] playback " + Str(m, "status"));
                Apply(Str(m, "status"));
                break;
            case "position_sync":
                if (m.TryGetProperty("position", out var p)) SetPosition(p);
                break;
            case "volume_changed":
                HoldVolume(m);
                break;
            case "error":
                Keep("[mandarin] " + m.GetRawText());
                Log("Soloist: " + Str(m, "message"));
                break;
        }
    }

    private void Apply(string status)
    {
        if (status == "buffering") return;   // as it was, until it plays
        if (status is not ("playing" or "paused" or "idle") || status == Playback) return;
        lock (gate) Playback = status;
        SetStatus(status switch { "playing" => "playing", "paused" => "paused", _ => SignedIn ? Waiting : Unpaired });
        Changed?.Invoke();
    }

    // Soloist's volume stays at 100% (bit-perfect): the room has its own, and a change in the Spotify app is put back.
    private void HoldVolume(JsonElement m)
    {
        if (!m.TryGetProperty("volume", out var v) || v.ValueKind != JsonValueKind.Number) return;
        Volume = v.GetInt32();
        if (Volume != 100 && Active) _ = Command("set_volume", "\"volume\":100");
    }

    private void SetItem(JsonElement item)
    {
        var e = Entity(item);
        if (e == null) return;
        bool changed;
        lock (gate) { changed = e.Title != Track.Title || e.Artists != Track.Artists; Track = e with { Position = Track.Position, At = Track.At }; }
        if (changed && e.Title != "") Log("now playing a Spotify track");
        Changed?.Invoke();
    }

    private void SetPosition(JsonElement p)
    {
        double ms = p.TryGetProperty("position_ms", out var x) && x.ValueKind == JsonValueKind.Number ? x.GetDouble() : 0;
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        long at = p.TryGetProperty("timestamp_ms", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt64() : now;
        // speed 0: not advancing (paused, buffering): the position as it stands, from now.
        if (p.TryGetProperty("speed", out var sp) && sp.ValueKind == JsonValueKind.Number && sp.GetDouble() == 0) at = now;
        lock (gate) Track = Track with { Position = ms / 1000, At = at };
        Changed?.Invoke();
    }

    /* A Soloist entity → title, artists, album, cover, duration, its Spotify URI. */
    public static SoloistTrack? Entity(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.Object) return null;
        var uri = Str(e, "uri");
        if (e.TryGetProperty("entity", out var inner) && inner.ValueKind == JsonValueKind.Object) e = inner;
        if (uri == "") uri = Str(e, "uri");
        if (!e.TryGetProperty("decorations", out var d) || d.ValueKind != JsonValueKind.Object) return null;
        static string Name(JsonElement x)
        {
            if (x.TryGetProperty("entity", out var i) && i.ValueKind == JsonValueKind.Object) x = i;
            return x.TryGetProperty("decorations", out var dd) && dd.TryGetProperty("identity", out var id) ? Str(id, "name") : "";
        }
        var title = d.TryGetProperty("identity", out var ident) ? Str(ident, "name") : "";
        var artists = d.TryGetProperty("creators", out var cr) && cr.ValueKind == JsonValueKind.Array
            ? string.Join(", ", cr.EnumerateArray().Select(Name).Where(n => n != ""))
            : "";
        var album = d.TryGetProperty("parent", out var parent) && parent.ValueKind == JsonValueKind.Object ? Name(parent) : "";
        var art = "";
        if (d.TryGetProperty("visual_identity", out var vi) && vi.TryGetProperty("cover", out var covers) && covers.ValueKind == JsonValueKind.Array)
        {
            var list = covers.EnumerateArray().Select(c => (Size: Str(c, "size"), Url: Str(c, "url"))).Where(c => c.Url != "").ToList();
            foreach (var want in new[] { "large", "xlarge", "default", "small" })
                if (list.FirstOrDefault(c => c.Size == want) is { Url: { Length: > 0 } u }) { art = u; break; }
            if (art == "" && list.Count > 0) art = list[0].Url;
        }
        double duration = d.TryGetProperty("playback", out var pb) && pb.TryGetProperty("duration_ms", out var dm) && dm.ValueKind == JsonValueKind.Number
            ? dm.GetDouble() / 1000 : 0;
        return new SoloistTrack(title, artists, album, art, duration, Uri: uri);
    }

    private static string Clip(string s) => s.Length > 4000 ? s[..4000] + "…" : s;

    private static string Str(JsonElement e, string k) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static bool Bool(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
}

[System.Text.Json.Serialization.JsonSerializable(typeof(string))]
internal sealed partial class SoloistJson : System.Text.Json.Serialization.JsonSerializerContext;
