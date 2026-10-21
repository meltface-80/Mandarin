namespace Mandarin.Tests;

/// <summary>
/// The server's side of the Android app's logging (bug list item 121, Diagnostics.cs): nothing kept
/// until it is switched on; then each line the server logs, with the code's own words and no value that
/// could be someone's personal data (an IP address, a user name, a device's kind); off again, deleted.
/// </summary>
public sealed class DiagnosticsTests
{
    private static async Task WrongPassword(Session s)
    {
        try { await Session.SignIn(s.Base, password: "not the password", create: false); }
        catch (InvalidOperationException) { /* turned away, as meant */ }
    }

    [Test]
    public async Task The_servers_log_kept_for_the_app_holds_no_personal_data()
    {
        await using var s = await Session.Started();
        Assert.False((await s.Api("diagnostics")).J["on"]!.GetValue<bool>(), "off unless switched on");
        await WrongPassword(s);
        Assert.Equal("", (await s.Api("diagnostics/log")).Text);

        Assert.True((await s.Api("diagnostics", new { on = true })).J["on"]!.GetValue<bool>());
        await WrongPassword(s);
        await Session.SignIn(s.Base);
        var log = (await s.Api("diagnostics/log")).Text;
        Assert.Contains("[diagnostics] on", log);
        // The line as written: "[auth] wrong password from {ip}" and "[auth] signed in: {name} ({kind}) from {ip}".
        Assert.Contains("[auth] wrong password from […]", log);
        Assert.Contains("[auth] signed in: […] ([…]) from […]", log);
        Assert.DoesNotContain("127.0.0.1", log);
        Assert.DoesNotContain(Session.User, log);

        Assert.False((await s.Api("diagnostics", new { on = false })).J["on"]!.GetValue<bool>());
        Assert.Equal("", (await s.Api("diagnostics/log")).Text);
        await WrongPassword(s);
        Assert.Equal("", (await s.Api("diagnostics/log")).Text);
    }
}
