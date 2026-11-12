namespace Mandarin.Tests;

/// <summary>
/// How the server is installed, said to the page (item 389): the login's forgotten password and the empty library say
/// what to do for this install. Mandarin OS has no shell and no container, so a Docker command there was wrong.
/// Open in /api/auth/status (the login asks it before anyone is signed in) and in /api/status.
/// </summary>
public sealed class InstallKindTests
{
    [Test]
    public async Task How_the_server_is_installed_is_said_to_the_page()
    {
        foreach (var (env, want) in new[]
        {
            (new Dictionary<string, string>(), "native"),
            (new Dictionary<string, string> { ["MANDARIN_SYSTEMD"] = "mandarin.service" }, "linux"),
            (new Dictionary<string, string> { ["MANDARIN_SYSTEMD"] = "mandarin.service", ["MANDARIN_OS"] = "0.1.0" }, "mandarin-os"),
        })
        {
            await using var s = await Session.Started(env: env);
            Assert.Equal(want, (await Http.Get(s.Base + "/api/auth/status")).J["install"]!.GetValue<string>());
            Assert.Equal(want, (await s.Api("status")).J["install"]!.GetValue<string>());
        }
    }
}
