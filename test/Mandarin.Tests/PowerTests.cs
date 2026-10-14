namespace Mandarin.Tests;

/// <summary>
/// The side menu's power button: Restart and Shut down (v0.6.12): what each install can do, and how it
/// is started again after Shut down (Docker's restart policy, or however it was started). The C#
/// server's rule (PowerRoutes.cs); the routes run for real in PowerCsharpTests (test/power.test.js, in C#).
/// </summary>
public sealed class PowerTests
{
    [Test]
    public async Task What_each_install_can_do_and_how_it_starts_again()
    {
        var p = (await Score.Run(new
        {
            fn = "auth",
            powers = new object[]
            {
                new { env = new Dictionary<string, string> { ["DOCKER"] = "1" } },
                new { env = new Dictionary<string, string>() },
                // A Mac's login item from before v1.0.3: nothing of its own any more.
                new { env = new Dictionary<string, string> { ["MANDARIN_LAUNCHD"] = "app.mandarin.server", ["XPC_SERVICE_NAME"] = "app.mandarin.server" } }
            }
        }))["powers"].Items().ToList();
        JsonAssert.Same("""{"restart":true,"shutdown":false,"docker":true,"start_again":"docker"}""", p[0]);
        JsonAssert.Same("""{"restart":true,"shutdown":true,"docker":false,"start_again":"manual"}""", p[1]);
        JsonAssert.Same(p[1]!.ToJsonString(), p[2]);
    }
}
