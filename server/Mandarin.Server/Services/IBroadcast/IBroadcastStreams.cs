// IBroadcastStreams.cs — iBroadcast's tracks played (item 445): where a track's audio is, for the server to make it
// what each room, Bridge and phone takes, as it makes a Qobuz track (ServiceStreams.cs, Streams.cs). The address is
// iBroadcast's streaming server's (help.ibroadcast.com/developer/components/streaming):
//   <streaming_server>/orig/<the file's path>?Expires=<now>&Signature=<access token>&file_id=<id>&user_id=<id>&platform=mandarin&version=<v>
// "orig" being the file as it was uploaded, never transcoded (Premium's; an account without it is sent 128 kbps MP3).
// A track's rate and depth are its file's own, read from its first bytes (FLAC's STREAMINFO, WAV's fmt chunk) once,
// and kept on its row, so it is planned at what it is, never at the 16/44.1 a row without them is taken for. An MP3
// and the like are left at that: lossy, nothing above it to keep.
// A catalogue only to be played: iBroadcast has no catalogue to browse, no favourites, nothing to import.
using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services.IBroadcast;

internal sealed class IBroadcastStreams(IBroadcast account) : Catalogue("ibroadcast", "iBroadcast")
{
    /// <summary>Each track's file at iBroadcast (the library's "file", "/128/a/b/123"), by track id.</summary>
    public const string FilesNs = "ibroadcast-file";

    /// <summary>The address of track [trackId]'s original file, for ffmpeg; never logged.</summary>
    public async Task<string> Url(string trackId)
    {
        string? file;
        using (var c = Db.Open())
            file = Library.Rows(c, "SELECT value FROM cache WHERE ns = $1 AND key = $2", FilesNs, trackId).FirstOrDefault()?[0] as string;
        if (file is not { Length: > 1 }) throw new ServiceError("This track isn't in your iBroadcast library any more", 404);
        var server = IBroadcastApi.Str(IBroadcastLibrary.State()?["streaming_server"]) ?? "https://streaming.ibroadcast.com";
        var slash = file.IndexOf('/', 1);
        var path = "/orig" + (slash > 0 ? file[slash..] : file);
        var access = await account.Api.Access();
        var user = IBroadcastApi.Str(IBroadcast.Account()?["user"]?["id"]) ?? "";
        return $"{server.TrimEnd('/')}{path}?Expires={(long)IBroadcastApi.Now()}&Signature={Uri.EscapeDataString(access)}&file_id={Uri.EscapeDataString(trackId)}"
            + $"&user_id={Uri.EscapeDataString(user)}&platform=mandarin&version={Uri.EscapeDataString(Server.Version)}";
    }

    /// <summary>Where the track's audio is: its original's address, at its own rate and depth (read from it the first time).</summary>
    public override async Task<Resolved> Resolve(StreamTrack t, JsObj p)
    {
        var id = TrackIdOf(t.Path) ?? throw new ServiceError("Not an iBroadcast track", 404);
        var url = await Url(id);
        double rate = t.SampleRate, bits = t.Bits;
        if (rate <= 0 && await Probe(url) is { } f) { (rate, bits) = (f.Rate, f.Bits); Keep(t.Id, f.Rate, f.Bits); }
        string codec;
        using (var c = Db.Open()) codec = Library.Rows(c, "SELECT codec FROM tracks WHERE id = $1", t.Id).FirstOrDefault()?[0] as string ?? "";
        var mime = codec switch { "flac" => "audio/flac", "pcm" => "audio/wav", "mp3" => "audio/mpeg", "aac" => "audio/mp4", "opus" => "audio/ogg", _ => "" };
        return new Resolved(url, rate > 0 ? rate : 44100, bits > 0 ? bits : 16, mime);
    }

    /// <summary>The rate and depth a file says of itself in its first bytes ([url]: read 64 KB of it); null for one that doesn't.</summary>
    public static async Task<(long Rate, int Bits)?> Probe(string url)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 65535);
            using var cts = new CancellationTokenSource(20000);
            using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            if (!res.IsSuccessStatusCode) return null;
            await using var s = await res.Content.ReadAsStreamAsync(cts.Token);
            var buf = new byte[65536];
            int n = 0, got;
            while (n < buf.Length && (got = await s.ReadAsync(buf.AsMemory(n), cts.Token)) > 0) n += got;
            return Header(buf.AsSpan(0, n));
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or IOException) { return null; }
    }

    /// <summary>A file's rate and depth from its first bytes: FLAC's STREAMINFO (after any ID3 tag), WAV's fmt chunk.</summary>
    public static (long Rate, int Bits)? Header(ReadOnlySpan<byte> b)
    {
        var flac = b.IndexOf("fLaC"u8);
        if (flac >= 0 && b.Length >= flac + 22)
        {
            var si = b[(flac + 8)..];   // after "fLaC" and STREAMINFO's block header
            long rate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
            var bits = (((si[12] & 1) << 4) | (si[13] >> 4)) + 1;
            return rate > 0 ? (rate, bits) : null;
        }
        if (b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b[8..12].SequenceEqual("WAVE"u8))
        {
            for (var at = 12; at + 8 <= b.Length;)
            {
                var size = (int)BinaryPrimitives.ReadUInt32LittleEndian(b[(at + 4)..]);
                if (b[at..(at + 4)].SequenceEqual("fmt "u8) && at + 24 <= b.Length)
                    return (BinaryPrimitives.ReadUInt32LittleEndian(b[(at + 12)..]), BinaryPrimitives.ReadUInt16LittleEndian(b[(at + 22)..]));
                at += 8 + size + (size & 1);
            }
        }
        return null;
    }

    /// <summary>A track's rate and depth kept on its row, and its album's highest.</summary>
    public static void Keep(long trackId, long rate, int bits)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = @"UPDATE tracks SET sample_rate = $r, bits = $b WHERE id = $id;
            UPDATE albums SET max_rate = (SELECT MAX(COALESCE(sample_rate, 44100)) FROM tracks WHERE album_id = albums.id),
                              max_bits = (SELECT MAX(COALESCE(bits, 16)) FROM tracks WHERE album_id = albums.id)
            WHERE id = (SELECT album_id FROM tracks WHERE id = $id)";
        cmd.Parameters.AddWithValue("$r", rate);
        cmd.Parameters.AddWithValue("$b", bits);
        cmd.Parameters.AddWithValue("$id", trackId);
        cmd.ExecuteNonQuery();
    }

    /// <summary>The lossless tracks whose rate isn't known yet, read one after another (after a library reading).</summary>
    public async Task Rates()
    {
        List<object?[]> want;
        using (var c = Db.Open())
            want = Library.Rows(c, "SELECT id, path FROM tracks WHERE path LIKE 'ibroadcast://track/%' AND lossless = 1 AND (sample_rate IS NULL OR sample_rate = 0)");
        var found = 0;
        foreach (var r in want)
        {
            if (!IBroadcast.Connected()) return;
            try
            {
                if (await Probe(await Url(((string)r[1]!)["ibroadcast://track/".Length..])) is { } f) { Keep((long)r[0]!, f.Rate, f.Bits); found++; }
            }
            catch (ServiceError) { /* gone, or signed out: the next */ }
        }
        if (found > 0) await Library.Tell(new JsonObject { ["services"] = "changed" });
    }

    private static readonly HttpClient Http = new(new SocketsHttpHandler { UseProxy = false, PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30) }) { Timeout = Timeout.InfiniteTimeSpan };

    // iBroadcast has no catalogue to browse, no favourites to keep, nothing to import: a catalogue only to be played.
    protected override void ForgetAnswers() { }
    public override Task<HashSet<string>> FavouriteIdSet(Ask ask, bool fresh = false) => Task.FromResult(new HashSet<string>());
    public override Task<List<object?>> NewReleases(double days, Ask ask) => Task.FromResult(new List<object?>());
    public override Task<List<object?>> Featured(string type, Ask ask) => Task.FromResult(new List<object?>());
    public override Task<JsObj> Search(string query, double offset, Ask ask, double limit = 50) => throw new ServiceError("iBroadcast has no catalogue to search", 404);
    public override Task<JsObj> ArtistAlbums(string artistId, double offset, Ask ask, double limit = 50) => throw new ServiceError("iBroadcast has no catalogue to browse", 404);
    public override Task<JsObj> AlbumDetail(string id, Ask ask) => throw new ServiceError("iBroadcast has no catalogue to browse", 404);
    protected override string[] Qualities => ["original"];
    protected override string DefaultQuality => "original";
    protected override Task<List<(string Id, JsObj Hint)>> Wanted() => Task.FromResult(new List<(string, JsObj)>());
    protected override void Describe(JsObj o) { }
    protected override Task<(JsObj Album, List<JsObj> Tracks)> FullAlbum(string id, object? hint) => throw new ServiceError("iBroadcast's albums come from its library", 404);
    protected override Task ApiFavourite(string id, bool on) => Task.CompletedTask;
}
