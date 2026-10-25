// Auth.Lockout.cs — wrong passwords, and sign-ins begun (moved from Auth.cs
// with item 174).
//
// Five wrong passwords from one address in 15 minutes lock that address out
// for 15 minutes; every failure anywhere also slows the next attempt. An
// address is an IPv6 one's /64: a network hands its devices any address in it,
// as many as they like. A password is given its place among the five as it is
// taken, before the wait and the check, and holds it until it is found right
// (the wrong ones forgotten) or wrong (one of the five): checked only once
// found wrong, every guess sent at once was let in while the first was still
// being checked, hundreds where five were meant. An address with no wrong
// password leaves nothing behind.
//
// A sign-in begun (/api/auth/challenge) is kept for a minute, for the proof
// that finishes it: ten at most for an address, its oldest given up for the
// next, and five hundred in all, the oldest given up first. A stranger's
// flood of them, unlimited and given up at random, could take the owner's
// half-way through.
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;

namespace Mandarin.Server;

internal static partial class Auth
{
    private const int MaxWrong = 5;
    private const long LockMs = 15 * 60000;
    private const int AddressesKept = 5000;

    private static readonly object lockGate = new();
    private static readonly Dictionary<string, List<long>> failures = new();   // address → its wrong passwords' times
    private static readonly Dictionary<string, int> checking = new();          // address → its passwords being checked
    private static List<long> recentFailures = [];

    /* The address a lockout is kept for: IPv4 as it is, IPv6 its /64. */
    private static string LockKey(string ip)
    {
        if (!IPAddress.TryParse(ip, out var a)) return ip;
        if (a.IsIPv4MappedToIPv6) a = a.MapToIPv4();
        if (a.AddressFamily != AddressFamily.InterNetworkV6) return a.ToString();
        var b = a.GetAddressBytes();
        Array.Clear(b, 8, 8);
        return new IPAddress(b) + "/64";
    }

    // The wrong passwords from key in the last 15 minutes (under lockGate); an address left with none is let go.
    private static List<long> Recent(string key, long now)
    {
        if (!failures.TryGetValue(key, out var list)) return [];
        list.RemoveAll(t => now - t >= LockMs);
        if (list.Count == 0) failures.Remove(key);
        return list;
    }

    private static long Wait(List<long> list, long now) => list.Count >= MaxWrong ? Math.Max(0, list[^1] + LockMs - now) : 0;

    /* How long ip is locked out for (0: it isn't). */
    private static long LockedFor(string ip)
    {
        lock (lockGate) { var now = Now; return Wait(Recent(LockKey(ip), now), now); }
    }

    private static Task TooMany(HttpContext ctx, long wait) =>
        Error(ctx, 429, $"Too many wrong passwords — try again in {(int)Math.Ceiling(wait / 60000.0)} min");

    /*
     * A password from ip about to be checked: its place among the five, taken
     * now; null, with how long to wait, when the address is locked out or its
     * guesses being checked already make five. Disposed without a verdict (a
     * sign-in gone, say), the place is given back.
     */
    private static Guess? TakeGuess(string ip, out long wait)
    {
        lock (lockGate)
        {
            var now = Now;
            var key = LockKey(ip);
            var list = Recent(key, now);
            int busy = checking.GetValueOrDefault(key);
            wait = Wait(list, now);
            if (wait == 0 && list.Count + busy >= MaxWrong) wait = 60000;   // the ones being checked decide within the minute
            if (wait > 0) return null;
            checking[key] = busy + 1;
            return new Guess(ip, key);
        }
    }

    private sealed class Guess(string ip, string key) : IDisposable
    {
        private bool done;

        /* Wrong: one of the address's five. */
        public void Wrong()
        {
            lock (lockGate)
            {
                Settle();
                var now = Now;
                var list = Recent(key, now);
                list.Add(now);
                failures[key] = list;
                recentFailures = recentFailures.Where(t => now - t < 3600000).Append(now).ToList();
                if (failures.Count > AddressesKept) Forget(now, key);
            }
            Server.Log($"[auth] wrong password from {ip}");
        }

        /* Right: the address's wrong passwords forgotten. */
        public void Right()
        {
            lock (lockGate) { Settle(); failures.Remove(key); }
        }

        public void Dispose()
        {
            lock (lockGate) Settle();
        }

        // Under lockGate: the place given back, once.
        private void Settle()
        {
            if (done) return;
            done = true;
            if (checking.GetValueOrDefault(key) <= 1) checking.Remove(key);
            else checking[key]--;
        }
    }

    // Past AddressesKept (under lockGate): the addresses whose wrong passwords have all expired, then the one wrong longest ago.
    private static void Forget(long now, string keep)
    {
        foreach (var k in failures.Keys.ToList()) Recent(k, now);
        while (failures.Count > AddressesKept) failures.Remove(failures.Where(kv => kv.Key != keep).MinBy(kv => kv.Value[^1]).Key);
    }

    private static Task Slowdown()
    {
        int n; lock (lockGate) n = recentFailures.Count;
        return Task.Delay(Math.Min(3000, 150 * n));
    }

    // ------------------------------------------------------------ SRP sessions
    private sealed record Challenge(string Username, Srp.Start Start, bool Real, long Expires, string From, long Order = 0);

    private const int ChallengesEach = 10, ChallengesAll = 500;
    private static readonly object challengeGate = new();
    private static readonly Dictionary<string, Challenge> challenges = new();
    private static long challengesMade;

    /* A sign-in begun, kept: its id. Room made for it as above, the expired gone first. */
    private static string Begin(Challenge ch)
    {
        var id = B64Url(RandomNumberGenerator.GetBytes(12));
        lock (challengeGate)
        {
            var now = Now;
            foreach (var (k, c) in challenges.ToList()) if (c.Expires < now) challenges.Remove(k);
            var mine = challenges.Where(kv => kv.Value.From == ch.From).OrderBy(kv => kv.Value.Order).ToList();
            for (int i = 0; i <= mine.Count - ChallengesEach; i++) challenges.Remove(mine[i].Key);
            while (challenges.Count >= ChallengesAll) challenges.Remove(challenges.MinBy(kv => kv.Value.Order).Key);
            challenges[id] = ch with { Order = ++challengesMade };
        }
        return id;
    }

    /* The sign-in begun as id, taken (a proof is checked against it once), or null. */
    private static Challenge? TakeChallenge(string id)
    {
        lock (challengeGate) return challenges.Remove(id, out var ch) ? ch : null;
    }
}
