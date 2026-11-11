namespace Mandarin.Tests;

/// <summary>
/// What the server's log kept for the app hides (bug list item 235, LogScrub.cs). From item 121 it kept the code's
/// own words alone, every value but a number made […], and so the cause of a failure too. The owner's rule since:
/// keys, tokens and passwords, emails, account names and logins, internet (WAN) and Tailscale addresses and the
/// home folder's user are hidden; home-network addresses, rooms, devices, titles and error messages are kept.
/// </summary>
public sealed class LogScrubTests
{
    private static readonly (string Line, string Kept)[] Lines =
    [
        // Hidden.
        ("[qobuz] GET https://www.qobuz.com/api.json/0.2/album/get?album_id=0060254&user_auth_token=AbC123xyz&request_sig=9f86d0 failed",
            "[qobuz] GET https://www.qobuz.com/api.json/0.2/album/get?album_id=0060254&user_auth_token=[…]&request_sig=[…] failed"),
        ("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9 and password=hunter2", "Authorization: […] […] and password=[…]"),
        ("key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "key […]"),
        ("[tidal] mail from someone@example.com", "[tidal] mail from [email]"),
        ("rtsp://admin:secret1@192.168.0.9/live", "rtsp://[…]@192.168.0.9/live"),
        ("[auth] wrong password from 81.2.69.160", "[auth] wrong password from [wan]"),
        ("[auth] wrong password from 2a02:c7f:1234:5600::1", "[auth] wrong password from [wan]"),
        ("away: using 100.92.159.80:3500 and fd7a:115c:a1e0::1", "away: using [tailscale]:3500 and [tailscale]"),
        ("on my-server.tail1234.ts.net", "on [tailscale]"),
        ("[tailscale-engine] To authenticate, visit: https://login.tailscale.com/a/1f2e3d4c5b6a7", "[tailscale-engine] To authenticate, visit: https://login.tailscale.com/a/[…]"),
        ("[scan] /home/jane/Music/Soen/Lykaia: unreadable", "[scan] /home/[user]/Music/Soen/Lykaia: unreadable"),
        // Kept.
        ("[auth] signed in: Chrome on Mac (browser) from 192.168.0.23", "[auth] signed in: Chrome on Mac (browser) from 192.168.0.23"),
        ("[sonos] Living Room (RINCON_347E5CD9646201400) at 192.168.0.40, 10.2.0.1/24, 172.20.1.2, 127.0.0.1",
            "[sonos] Living Room (RINCON_347E5CD9646201400) at 192.168.0.40, 10.2.0.1/24, 172.20.1.2, 127.0.0.1"),
        ("[renderers] SR11 at http://192.168.0.61:49152/description.xml, fe80::1c2b:3aff:fe4d:5e6f%eth0, ::ffff:192.168.0.61",
            "[renderers] SR11 at http://192.168.0.61:49152/description.xml, fe80::1c2b:3aff:fe4d:5e6f%eth0, ::ffff:192.168.0.61"),
        ("[ssdp] M-SEARCH to 239.255.255.250:1900", "[ssdp] M-SEARCH to 239.255.255.250:1900"),
        ("device 0f8fad5b-d9cb-469f-a165-70867728950e: 'Battle Born' by The Killers, track 2 of 12",
            "device 0f8fad5b-d9cb-469f-a165-70867728950e: 'Battle Born' by The Killers, track 2 of 12"),
        ("[qobuz] watch: ServiceError: Album not found (status 404)", "[qobuz] watch: ServiceError: Album not found (status 404)"),
        ("[scan] /music/The Killers/Battle Born/01 Flesh and Bone.flac: FileNotFoundException",
            "[scan] /music/The Killers/Battle Born/01 Flesh and Bone.flac: FileNotFoundException"),
    ];

    [Test]
    public async Task What_is_the_owners_alone_is_hidden_and_the_rest_kept()
    {
        var r = await Score.Run(new { fn = "logscrub", lines = Lines.Select(l => l.Line).ToArray(), personal = "jane@example.com" });
        var kept = r["lines"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray();
        for (var i = 0; i < Lines.Length; i++) Assert.Equal(Lines[i].Kept, kept[i]);
        // An account's name or a service's login, put into a line as Personal, is hidden whatever it is.
        Assert.Equal("[…]", r["personal"]!.GetValue<string>());
    }
}
