using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The long polls (/api/zone-state?wait_for, /api/phone/commands?wait): a wait holds no database connection, and
/// one whose device goes away ends at once, not at its 25 s (the waits /api/status counts); a change still
/// answers a wait the moment it comes.
/// </summary>
public sealed class LongPollTests
{
    private static async Task<JsonNode> Waits(Session s) => (await s.Api("status")).J["waits"]!;

    // A poll the test lets go of part way: its connection closed, as a phone dropping off the network does.
    private static async Task Dropped(Session s, string path, string kind)
    {
        using var client = new HttpClient(new SocketsHttpHandler { UseProxy = false });
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + "/api/" + path);
        req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + s.Token);
        using var cts = new CancellationTokenSource();
        var poll = client.SendAsync(req, cts.Token);
        await Session.Until(async () => (await Waits(s)).Num(kind) == 1, 10000, "the " + kind + " poll waiting");
        Assert.True((await Waits(s)).Num("database") == 0, "a waiting poll holds no database connection");
        await cts.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => poll);
        // Well before the 25 s it asked to wait.
        await Session.Until(async () => (await Waits(s)).Num(kind) == 0, 5000, "the dropped " + kind + " poll let go");
    }

    [Test]
    public async Task A_zone_state_poll_holds_no_connection_ends_when_its_device_goes_and_answers_a_change()
    {
        await using var s = await Session.Started();
        var rev = (await s.Api("zone-state")).J.Num("revision");
        await Dropped(s, $"zone-state?wait_for={rev}&timeout=25000", "zone_state");

        // A change while waiting: answered then, with the new revision.
        var poll = s.Api($"zone-state?wait_for={rev}&timeout=25000");
        await Session.Until(async () => (await Waits(s)).Num("zone_state") == 1, 10000, "the poll waiting");
        await s.Api("phone/hello", new { name = "Pixel 8" });
        var answer = await poll.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(200, answer.Status);
        Assert.True(answer.J.Num("revision") > rev, "the revision moved: " + answer.Text);
        Assert.True((await Waits(s)).Num("zone_state") == 0, "the answered poll let go");
    }

    [Test]
    public async Task A_phone_commands_poll_holds_no_connection_ends_when_the_phone_goes_and_answers_a_command()
    {
        await using var s = await Session.Started();
        var zoneId = (await s.Api("phone/hello", new { name = "Pixel 8" })).J.Str("zone_id");
        var seq = (await s.Api("phone/commands?after=0&wait=0")).J.Num("seq");
        await Dropped(s, $"phone/commands?after={seq}&wait=25000", "phone_commands");

        // A command while waiting: answered then.
        var poll = s.Api($"phone/commands?after={seq}&wait=25000");
        await Session.Until(async () => (await Waits(s)).Num("phone_commands") == 1, 10000, "the poll waiting");
        var one = (await s.Album("Album One"))!;
        Assert.Equal(200, (await s.Api("play", new { offset = one.Num("offset"), zone_or_output_id = zoneId, kind = "play_now" })).Status);
        var answer = await poll.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(200, answer.Status);
        Assert.NotEmpty(answer.J["commands"].Items());
        Assert.True((await Waits(s)).Num("phone_commands") == 0, "the answered poll let go");
    }
}
