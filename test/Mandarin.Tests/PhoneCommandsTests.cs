using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// What the phone's long poll of its commands may count on (Phones.Commands, audit A-M1, A-M2): every command after
/// `after` is handed to every poll that asks with it, two at once alike, and none at or below it. So a phone whose old
/// loop is still out when a new one starts is handed each command twice, and the app applies it once (PollTurns).
/// </summary>
public sealed class PhoneCommandsTests
{
    private static List<double> Seqs(JsonNode? batch) => [.. batch?["commands"].Items().Select(c => c.Num("seq") ?? 0) ?? []];

    [Test]
    public async Task Two_polls_with_the_same_after_are_both_handed_the_command_and_a_poll_after_it_none()
    {
        await using var s = await Session.Started();
        var zoneId = (await s.Api("phone/hello", new { name = "Pixel 8" })).J.Str("zone_id");
        var after = (await s.Api("phone/commands?after=0&wait=0")).J.Num("seq");
        // The old loop's poll, still out, and the new loop's, asked with the same after.
        var old = s.Api($"phone/commands?after={after}&wait=25000");
        var now = s.Api($"phone/commands?after={after}&wait=25000");
        await Session.Until(async () => (await s.Api("status")).J["waits"].Num("phone_commands") == 2, 10000, "both polls waiting");
        var one = (await s.Album("Album One"))!;
        Assert.Equal(200, (await s.Api("play", new { offset = one.Num("offset"), zone_or_output_id = zoneId, kind = "play_now" })).Status);
        var a = await old.WaitAsync(TimeSpan.FromSeconds(10));
        var b = await now.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.NotEmpty(Seqs(a.J));
        Assert.True(Seqs(a.J).All(n => n > after), a.Text);
        Assert.True(Seqs(a.J).SequenceEqual(Seqs(b.J)), "both handed the same commands: " + a.Text + " / " + b.Text);
        var n = Seqs(a.J).Max();
        var none = await s.Api($"phone/commands?after={n}&wait=0");
        Assert.Equal(200, none.Status);
        Assert.Empty(Seqs(none.J));
    }
}
