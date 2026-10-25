using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Signing in held against a stranger who reaches the port (item 174; server/Mandarin.Server/Auth.Lockout.cs):
///  - five wrong passwords from one address lock it out, however many guesses are sent at once: a guess
///    holds its place among the five from the moment it is taken, not only once it has been found wrong;
///  - an IPv6 address is one of the 2^64 its network hands out at will: the lockout is the /64's;
///  - an address that has never got a password wrong leaves nothing behind, so a flood of new addresses
///    can't push a locked one out of the list;
///  - an address holds ten sign-ins begun at most, its oldest given up for an eleventh, and with five hundred
///    held in all the oldest goes first: a flood of sign-ins begun can't take the owner's half-way through.
/// The tests' requests come from this machine, where the server believes X-Forwarded-For (Caller.ClientIp),
/// so each case is from addresses of its own. Thousands of requests a flood: run alone (Floods), not to
/// starve the servers of the tests alongside.
/// </summary>
[Collection(nameof(Floods))]
public sealed class SignInHardeningTests
{
    private static async Task<TestServer> Server()
    {
        Needs.Server();
        var lib = Fixtures.MakeLibrary();
        var srv = await new TestServer(Ports.Port(), lib.Music, lib.Data, new Dictionary<string, object?>
            { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>(), ["upnpMulticast"] = false, ["identify"] = false }).Start();
        try { await Session.SignIn(srv.Base); } catch { await srv.Stop(); throw; }
        return srv;
    }

    private static Dictionary<string, string> From(string ip) => new() { ["X-Forwarded-For"] = ip };

    // A sign-in begun from ip: its answer.
    private static Task<Http.Answer> Begin(string b, string ip) => Http.Post(b + "/api/auth/challenge", new { username = Session.User }, From(ip));

    private static async Task<JsonNode> Challenge(string b, string ip)
    {
        var r = await Begin(b, ip);
        Assert.True(r.Status == 200, $"a sign-in begun from {ip}: {r.Status} {r.Text}");
        return r.J;
    }

    // The sign-in ch finished from ip with this password: the answer's status.
    private static async Task<int> Verify(string b, JsonNode ch, string ip, string password)
    {
        var start = Srp.ClientStart();
        var proof = Srp.ClientProof(Session.User, password, (string)ch["salt"]!, ch["iterations"]!.GetValue<int>(), start, (string)ch["B"]!);
        return (await Http.Post(b + "/api/auth/verify", new { id = (string?)ch["id"], A = start.A, M1 = proof.M1, want_token = true, device_name = "test" }, From(ip))).Status;
    }

    // A guess at a sign-in that isn't there (never begun, or given up): answered at once, never a password checked.
    private static async Task<int> Stray(string b, string ip) =>
        (await Http.Post(b + "/api/auth/verify", new { id = "nothing", A = "02", M1 = "00" }, From(ip))).Status;

    private static string Count(IEnumerable<int> statuses) => string.Join(" ", statuses.GroupBy(s => s).OrderBy(g => g.Key).Select(g => $"{g.Count()}x{g.Key}"));

    [Test]
    public async Task Five_wrong_passwords_lock_an_address_out_even_sent_all_at_once()
    {
        await using var srv = await Server();
        var b = srv.Base;
        const string ip = "203.0.113.7";
        Assert.Equal(401, await Verify(b, await Challenge(b, ip), ip, "wrong"));
        // Eight more at once. Each waits a little after a wrong password anywhere (Slowdown), and every one
        // was let in at the door before the first was found wrong: nine guesses where five are allowed.
        var chs = new List<JsonNode>();
        for (int i = 0; i < 8; i++) chs.Add(await Challenge(b, ip));
        var at = await Task.WhenAll(chs.Select(ch => Verify(b, ch, ip, "wrong")));
        Assert.Equal("4x401 4x429", Count(at));
        // Locked out, the right password too; another address isn't.
        Assert.Equal(429, (await Begin(b, ip)).Status);
        Assert.Equal(429, await Verify(b, await Challenge(b, "203.0.113.8"), ip, Session.Pass));
        Assert.Equal(200, await Verify(b, await Challenge(b, "203.0.113.8"), "203.0.113.8", Session.Pass));

        // A guess that never came to a password (its sign-in unknown, or gone) holds no place once answered.
        const string other = "203.0.113.9";
        var none = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Stray(b, other)));
        Assert.Equal("10x400", Count(none));
        // A right password clears the wrong ones before it.
        for (int i = 0; i < 4; i++) Assert.Equal(401, await Verify(b, await Challenge(b, other), other, "wrong"));
        Assert.Equal(200, await Verify(b, await Challenge(b, other), other, Session.Pass));
        for (int i = 0; i < 4; i++) Assert.Equal(401, await Verify(b, await Challenge(b, other), other, "wrong"));
        Assert.Equal(200, await Verify(b, await Challenge(b, other), other, Session.Pass));
    }

    [Test]
    public async Task An_IPv6_address_is_locked_out_with_its_whole_64()
    {
        await using var srv = await Server();
        var b = srv.Base;
        // Five wrong passwords, each from another address of one /64.
        for (int i = 1; i <= 5; i++)
        {
            var ip = $"2001:db8:1:2::{i:x}";
            Assert.Equal(401, await Verify(b, await Challenge(b, ip), ip, "wrong"));
        }
        // Any address in it is locked out now, written however it is written.
        foreach (var ip in new[] { "2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:DB8:1:2:0:0:0:99" })
        {
            Assert.Equal(429, (await Begin(b, ip)).Status);
            Assert.Equal(429, await Verify(b, await Challenge(b, "2001:db8:1:3::1"), ip, Session.Pass));
        }
        // The next /64, and IPv4, aren't.
        Assert.Equal(200, await Verify(b, await Challenge(b, "2001:db8:1:3::1"), "2001:db8:1:3::1", Session.Pass));
        Assert.Equal(200, await Verify(b, await Challenge(b, "198.51.100.3"), "198.51.100.3", Session.Pass));
    }

    [Test]
    public async Task A_flood_of_new_addresses_leaves_nothing_behind_and_cant_push_a_locked_address_out()
    {
        await using var srv = await Server();
        var b = srv.Base;
        const string ip = "198.51.100.1";
        for (int i = 0; i < 4; i++) Assert.Equal(401, await Verify(b, await Challenge(b, ip), ip, "wrong"));
        // 5,001 addresses each asking once (a sign-in that isn't there: answered at once). Each was kept, with
        // no wrong password, and past 5,000 kept the first was let go: the address four wrong passwords in.
        var addrs = Enumerable.Range(0, 5001).Select(i => $"10.{i >> 16 & 255}.{i >> 8 & 255}.{i & 255}").ToList();
        foreach (var chunk in addrs.Chunk(20))
            Assert.Equal($"{chunk.Length}x400", Count(await Task.WhenAll(chunk.Select(a => Stray(b, a)))));
        Assert.Equal(401, await Verify(b, await Challenge(b, ip), ip, "wrong"));
        Assert.Equal(429, (await Begin(b, ip)).Status);
    }

    [Test]
    public async Task A_flood_of_sign_ins_begun_cant_take_the_owners_half_way_through()
    {
        await using var srv = await Server();
        var b = srv.Base;
        // The owner begins; a stranger begins 3,000 from one address before the owner's proof comes back.
        var mine = await Challenge(b, "192.168.1.20");
        foreach (var chunk in Enumerable.Range(0, 3000).Chunk(20))
            await Task.WhenAll(chunk.Select(_ => Begin(b, "203.0.113.50")));
        Assert.Equal(200, await Verify(b, mine, "192.168.1.20", Session.Pass));

        // Ten held for an address at most: its eleventh gives up its first.
        var eleven = new List<JsonNode>();
        for (int i = 0; i < 11; i++) eleven.Add(await Challenge(b, "203.0.113.51"));
        Assert.Equal(400, await Verify(b, eleven[0], "203.0.113.51", Session.Pass));
        Assert.Equal(200, await Verify(b, eleven[1], "203.0.113.51", Session.Pass));

        // From many addresses, 500 held in all, the oldest going first: one begun after a full table's worth
        // is kept through 490 more.
        foreach (var n in Enumerable.Range(0, 60))
            await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Begin(b, $"203.0.114.{n}")));
        var newer = await Challenge(b, "192.168.1.21");
        foreach (var n in Enumerable.Range(0, 49))
            await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Begin(b, $"203.0.115.{n}")));
        Assert.Equal(200, await Verify(b, newer, "192.168.1.21", Session.Pass));
    }
}

/// <summary>Tests that flood a server with requests: run once the others have finished, one at a time.</summary>
[CollectionDefinition(nameof(Floods), DisableParallelization = true)]
public sealed class Floods;
