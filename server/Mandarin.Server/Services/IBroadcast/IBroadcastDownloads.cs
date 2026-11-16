// IBroadcastDownloads.cs — an iBroadcast album kept on the phone (item 448), as an album of the library's own files is
// (Downloads.cs): they are the owner's own files, uploaded, unlike Qobuz's and Tidal's, which are never kept. At
// "original", the file as iBroadcast keeps it where Android plays its format (FLAC, MP3, AAC, Ogg, WAV up to 24
// bits), fetched as it is; any other (AIFF, deeper WAV) made FLAC from it, as a local file would be. At "opus",
// Opus 256, made from it as from a local file.
using System.Globalization;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastDownloads
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler { PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30), UseProxy = false })
        { Timeout = TimeSpan.FromMinutes(30) };

    /// <summary>Whether [path] is an iBroadcast track's.</summary>
    public static bool Is(string path) => path.StartsWith("ibroadcast://track/", StringComparison.Ordinal);

    /// <summary>The extension track [id]'s original is kept with where Android plays it as it is; null where it doesn't.</summary>
    public static string? OriginalExt(long id)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT codec, container, COALESCE(bits, 0), COALESCE(channels, 2) FROM tracks WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        if (!r.Read() || Convert.ToInt64(r.GetValue(3), CultureInfo.InvariantCulture) > 2) return null;
        var codec = r.IsDBNull(0) ? "" : r.GetString(0);
        var container = r.IsDBNull(1) ? "" : r.GetString(1);
        var bits = Convert.ToInt64(r.GetValue(2), CultureInfo.InvariantCulture);
        return (codec, container) switch
        {
            ("flac", _) => "flac",
            ("mp3", _) => "mp3",
            ("aac", _) => "m4a",
            ("opus", _) => "ogg",
            ("pcm", "wav") when bits <= 24 => "wav",
            _ => null,
        };
    }

    /// <summary>Track [path]'s original fetched from iBroadcast into [dest], as it is.</summary>
    public static async Task Fetch(string path, string dest)
    {
        if (global::Mandarin.Server.Jobs.IBroadcastStreams is not { } ib) throw new IOException("iBroadcast isn't set up");
        string url;
        try { url = await ib.Url(path["ibroadcast://track/".Length..]); }
        catch (ServiceError e) { throw new IOException(e.Message, e); }
        try
        {
            using var res = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
            if (!res.IsSuccessStatusCode) throw new IOException($"iBroadcast answered {(int)res.StatusCode} for the file");
            await using var from = await res.Content.ReadAsStreamAsync();
            await using var to = File.Create(dest);
            await from.CopyToAsync(to);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { throw new IOException("iBroadcast couldn't be reached for the file", e); }
    }
}
