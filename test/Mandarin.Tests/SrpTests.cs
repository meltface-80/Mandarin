using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// SRP-6a, held together (test/srp.test.js, in C#): the page's public/srp.js, run in the browser it is
/// written for, against .NET's own hashes, a full sign-in both ways, and the fixed example
/// (test/srp-vector.json) that the Android app's Kotlin copy, the C# server and the tests' own
/// client (Harness/Srp.cs) are each checked against: phone and server must agree to the byte.
/// </summary>
public sealed class SrpTests
{
    private static readonly JsonNode V = JsonNode.Parse(File.ReadAllText(Path.Combine(ServerProcess.Root, "test", "srp-vector.json")))!;
    private static string Vs(string key) => (string)V[key]!;

    private static async Task<(Browser B, Page P)> SrpPage()
    {
        Browser.Need();
        var b = await Browser.Launch();
        var p = await b.Page("about:blank");
        await p.Eval(await File.ReadAllTextAsync(Path.Combine(ServerProcess.Root, "public", "srp.js")));
        return (b, p);
    }

    private static string Js(string s) => System.Text.Json.JsonSerializer.Serialize(s);

    [Test]
    public async Task Srp_js_sha256_hmac_and_pbkdf2_match_dotnet()
    {
        var (b, p) = await SrpPage();
        await using var _ = b;
        foreach (var n in new[] { 0, 1, 55, 56, 63, 64, 65, 119, 120, 1000 })
        {
            var bytes = RandomNumberGenerator.GetBytes(n);
            var js = (string?)await p.Eval($"MusicdSrp.toHex(MusicdSrp.sha256(MusicdSrp.fromHex({Js(Convert.ToHexStringLower(bytes))})))");
            Assert.True(Convert.ToHexStringLower(SHA256.HashData(bytes)) == js, "sha256 " + n);
        }
        foreach (var kl in new[] { 0, 5, 64, 65, 100 })
        {
            var k = RandomNumberGenerator.GetBytes(kl);
            var m = RandomNumberGenerator.GetBytes(77);
            var js = (string?)await p.Eval($"MusicdSrp.toHex(MusicdSrp.hmacSha256(MusicdSrp.fromHex({Js(Convert.ToHexStringLower(k))}), MusicdSrp.fromHex({Js(Convert.ToHexStringLower(m))})))");
            Assert.True(Convert.ToHexStringLower(HMACSHA256.HashData(k, m)) == js, "hmac " + kl);
        }
        var pw = Encoding.UTF8.GetBytes("pässword");
        var salt = RandomNumberGenerator.GetBytes(16);
        var pb = (string?)await p.Eval($"MusicdSrp.toHex(MusicdSrp.pbkdf2(MusicdSrp.fromHex({Js(Convert.ToHexStringLower(pw))}), MusicdSrp.fromHex({Js(Convert.ToHexStringLower(salt))}), 1500))");
        Assert.Equal(Convert.ToHexStringLower(Rfc2898DeriveBytes.Pbkdf2(pw, salt, 1500, HashAlgorithmName.SHA256, 32)), pb);
        Assert.Empty(p.Errors);
    }

    [Test]
    public async Task Srp_js_sign_in_succeeds_with_the_password_and_fails_without_it()
    {
        var (b, p) = await SrpPage();
        await using var _ = b;
        var r = (await p.Eval("""
            (() => {
              const v = MusicdSrp.makeVerifier("Someone", "right", 1000);
              const cs = MusicdSrp.clientStart(), ss = MusicdSrp.serverStart(v.verifier);
              const ok = MusicdSrp.clientProof(" someone ", "right", v.salt, 1000, cs, ss.B);
              const r = MusicdSrp.serverVerify(ss, cs.A, ok.M1);
              const bad = MusicdSrp.clientProof("someone", "wrong", v.salt, 1000, cs, ss.B);
              let threw = "";
              try { MusicdSrp.clientProof("someone", "right", v.salt, 1000, cs, "00"); } catch (e) { threw = e.message; }
              return { ok: r.ok, m2: r.M2 === ok.expectM2, bad: MusicdSrp.serverVerify(ss, cs.A, bad.M1).ok, threw };
            })()
            """))!;
        Assert.True(r["ok"]!.GetValue<bool>());
        Assert.True(r["m2"]!.GetValue<bool>());
        Assert.False(r["bad"]!.GetValue<bool>());
        Assert.Matches("bad server value", (string?)r["threw"]);
    }

    [Test]
    public async Task Srp_js_fixed_example_still_comes_out_the_same()
    {
        var (b, p) = await SrpPage();
        await using var _ = b;
        var r = (await p.Eval($$"""
            (() => {
              const V = {{V.ToJsonString()}};
              const v = MusicdSrp.makeVerifier(V.username, V.password, V.iterations, V.salt);
              const cs = MusicdSrp.clientStart(V.a), ss = MusicdSrp.serverStart(V.verifier, V.b);
              const p = MusicdSrp.clientProof(V.username, V.password, V.salt, V.iterations, cs, V.B);
              return { verifier: v.verifier, A: cs.A, B: ss.B, M1: p.M1, K: p.K, M2: MusicdSrp.serverVerify(ss, V.A, V.M1).M2 };
            })()
            """))!;
        foreach (var k in new[] { "verifier", "A", "B", "M1", "K", "M2" }) Assert.True(Vs(k) == (string?)r[k], k);
    }

    [Test]
    public void The_tests_own_client_agrees_with_the_fixed_example()
    {
        var (salt, verifier) = Srp.MakeVerifier(Vs("username"), Vs("password"), V["iterations"]!.GetValue<int>(), Vs("salt"));
        Assert.Equal(Vs("salt"), salt);
        Assert.Equal(Vs("verifier"), verifier);
        var start = Srp.ClientStart(Vs("a"));
        Assert.Equal(Vs("A"), start.A);
        var proof = Srp.ClientProof(Vs("username"), Vs("password"), Vs("salt"), V["iterations"]!.GetValue<int>(), start, Vs("B"));
        Assert.Equal(Vs("M1"), proof.M1);
        Assert.Equal(Vs("K"), proof.K);
        Assert.Equal(Vs("M2"), proof.ExpectM2);
        Assert.Throws<InvalidOperationException>(() => Srp.ClientProof("someone", "right", Vs("salt"), 1000, start, "00"));
    }

    // The C# server's half (v0.8.2, server/Srp.cs) against the same example.
    [Test]
    public void The_servers_half_agrees_with_the_fixed_example()
    {
        Needs.Server();
        var psi = new ProcessStartInfo(ServerProcess.Bin) { RedirectStandardOutput = true, UseShellExecute = false };
        psi.ArgumentList.Add("--srp-vector");
        psi.ArgumentList.Add(Path.Combine(ServerProcess.Root, "test", "srp-vector.json"));
        using var proc = Process.Start(psi)!;
        var output = JsonNode.Parse(proc.StandardOutput.ReadToEnd())!;
        proc.WaitForExit();
        Assert.True(Vs("B") == (string?)output["B"], "B");
        Assert.True(output["ok"]!.GetValue<bool>(), "the right proof is accepted");
        Assert.True(Vs("M2") == (string?)output["M2"], "M2");
        Assert.False(output["wrong_ok"]!.GetValue<bool>(), "a wrong proof is refused");
    }
}
