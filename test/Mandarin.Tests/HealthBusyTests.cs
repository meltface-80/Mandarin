namespace Mandarin.Tests;

/// <summary>
/// Whether anything is under way, in /api/health (HealthRoutes.cs, item 389): Mandarin OS's weekly upkeep asks it, and
/// waits for no room playing, no scan and no track being made before an update or a restart. Said only to this
/// machine; another (a home device through a trusted proxy, here) gets the health as before, without it.
/// </summary>
public sealed class HealthBusyTests
{
    [Test]
    public async Task Whether_anything_is_under_way_is_said_to_this_machine_alone()
    {
        await using var s = await Session.Started();
        var here = (await Http.Get(s.Base + "/api/health")).J;
        Assert.True(here["ok"]!.GetValue<bool>());
        JsonAssert.Same("""{"any":false,"playing":0,"scanning":false,"making":0}""", here["busy"]);
        var other = (await Http.Get(s.Base + "/api/health", new Dictionary<string, string> { ["X-Forwarded-For"] = "192.168.1.20" })).J;
        Assert.True(other["ok"]!.GetValue<bool>());
        Assert.Null(other["busy"]);
    }
}
