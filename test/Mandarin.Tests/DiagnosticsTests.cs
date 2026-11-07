namespace Mandarin.Tests;

/// <summary>
/// The server's side of the Android app's logging (bug list item 121, Diagnostics.cs): on unless switched off
/// (item 334), each line the server logs kept without what is the owner's alone (their account's name, keys,
/// internet and Tailscale addresses: LogScrubTests) but with what helps (a home-network address, a device's name,
/// item 235); switched off, deleted and nothing kept; on again, kept again.
/// </summary>
public sealed class DiagnosticsTests
{
    private static async Task WrongPassword(Session s)
    {
        try { await Session.SignIn(s.Base, password: "not the password", create: false); }
        catch (InvalidOperationException) { /* turned away, as meant */ }
    }

    [Test]
    public async Task The_servers_log_kept_for_the_app_holds_what_helps_and_not_the_owners_own()
    {
        await using var s = await Session.Started();
        Assert.True((await s.Api("diagnostics")).J["on"]!.GetValue<bool>(), "on unless switched off (item 334)");
        // Switched off: nothing kept.
        Assert.False((await s.Api("diagnostics", new { on = false })).J["on"]!.GetValue<bool>());
        await WrongPassword(s);
        Assert.Equal("", (await s.Api("diagnostics/log")).Text);

        Assert.True((await s.Api("diagnostics", new { on = true })).J["on"]!.GetValue<bool>());
        await WrongPassword(s);
        await Session.SignIn(s.Base);
        var log = (await s.Api("diagnostics/log")).Text;
        Assert.Contains("[diagnostics] on", log);
        // The lines as written, "[auth] wrong password from {ip}" and "[auth] signed in: {name} ({kind}) from {ip}":
        // the device's own address and the device's name kept; the account's name nowhere.
        Assert.Contains("[auth] wrong password from 127.0.0.1", log);
        Assert.Contains("[auth] signed in: test (android) from 127.0.0.1", log);
        Assert.DoesNotContain(Session.User, log);

        Assert.False((await s.Api("diagnostics", new { on = false })).J["on"]!.GetValue<bool>());
        Assert.Equal("", (await s.Api("diagnostics/log")).Text);
        await WrongPassword(s);
        Assert.Equal("", (await s.Api("diagnostics/log")).Text);
    }
}
