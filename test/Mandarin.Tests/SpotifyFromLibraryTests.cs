namespace Mandarin.Tests;

/// <summary>
/// A Spotify album of the library played from Mandarin (bug list item 517, Connect/SpotifyFromLibrary.cs). Spotify gives
/// an app no sound, so each Spotify track Mandarin was asked to play failed at once and the room skipped through the album
/// in silence. Now the album goes to Mandarin's own Spotify player, Soloist: made the active device, told to play the
/// album, and followed into the room it was played in (over Settings' Spotify Connect room). Queued after other music,
/// it is said it can't be. Soloist is the stand-in (test/StandIns/Soloist.cs), which writes down each command.
/// </summary>
public sealed class SpotifyFromLibraryTests
{
    [Test]
    public async Task A_Spotify_album_played_from_the_library_goes_to_Soloist_and_the_room_it_was_played_in_follows()
    {
        if (!OperatingSystem.IsLinux()) Assert.Skip("Spotify Soloist runs on Linux only");
        var bin = Directory.CreateTempSubdirectory("mandarin-spotify-bin-").FullName;
        StandIn.Script("pulseaudio", Path.Combine(bin, "pulseaudio"));
        var archive = SpotifyConnectTests.Archive();
        await using var cdn = await FakeServer.Start(async ctx => { ctx.Response.ContentType = "application/gzip"; await ctx.Response.Body.WriteAsync(archive); });
        await using var s = await Session.Started(env: new Dictionary<string, string>
        {
            ["PATH"] = bin + ":" + Environment.GetEnvironmentVariable("PATH"), ["SOLOIST_URL"] = cdn.Base + "/soloist_release_x86_64.tar.gz"
        });
        Assert.Equal(200, (await s.Api("settings/spotify-connect", new { api_key = SpotifyConnectTests.Key, room = "lounge-1" })).Status);
        await Session.Until(async () => (string?)(await s.Api("settings/spotify-connect")).J["playback"] == "playing", 90000, "Soloist signed in and playing");

        // A Spotify album of the library, as the import writes it.
        s.Server.Exec("INSERT INTO albums(key, title, artist, sort_title, sort_artist, dir, track_count, duration, max_rate, max_bits, lossless, container, compilation, added_at, updated_at) " +
            "VALUES('spotify:alb123', 'Spotify Album', 'An Artist', 'spotify album', 'an artist', 'spotify://album/alb123', 2, 400, 44100, 24, 1, 'flac', 0, 1, 1)");
        var album = (long)s.Server.Scalar("SELECT id FROM albums WHERE key = 'spotify:alb123'")!;
        foreach (var (id, no) in new[] { ("trk1", 1), ("trk2", 2) })
            s.Server.Exec("INSERT INTO tracks(album_id, path, mtime, size, title, artist, album_artist, album, track_no, disc_no, duration, codec, container, sample_rate, bits, channels, lossless) " +
                $"VALUES({album}, 'spotify://track/{id}', 0, 0, 'Song {no}', 'An Artist', 'An Artist', 'Spotify Album', {no}, 1, 200, 'flac', 'flac', 44100, 24, 2, 1)");
        await s.Server.Reload();

        var commands = Path.Combine(s.Lib.Data, "spotify", "soloist", "commands.log");
        if (File.Exists(commands)) File.Delete(commands);
        var played = await s.Api("play", new { offset = album, zone_or_output_id = "kitchen-1", kind = "play_now" });
        Assert.True(played.Status == 200, played.Status + " " + played.Text);
        // Soloist made the active device, and told to play the album.
        await Session.Until(() => Task.FromResult(File.Exists(commands) && File.ReadAllText(commands) is var c
            && c.Contains("\"activate\"", StringComparison.Ordinal) && c.Contains("\"uri\":\"spotify:album:alb123\"", StringComparison.Ordinal)), 15000, "Soloist told to play the album");
        // The stream followed into the room it was played in, not Settings' Spotify Connect room.
        await Session.Until(() => Task.FromResult(s.Server.Logs.Any(l => l.Contains("[spotify]", StringComparison.Ordinal) && l.Contains("(kitchen-1)", StringComparison.Ordinal)
            && (l.Contains("playing in the room chosen for it", StringComparison.Ordinal) || l.Contains("the room didn't follow", StringComparison.Ordinal)))), 15000, "the room asked for followed");

        // Queued after other music: said it can't be, nothing told to Soloist.
        var queued = await s.Api("play", new { offset = album, zone_or_output_id = "kitchen-1", kind = "queue" });
        Assert.Equal(409, queued.Status);
        Assert.Contains("plays now in a room", queued.Text);
    }
}
