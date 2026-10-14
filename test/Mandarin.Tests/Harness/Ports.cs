using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace Mandarin.Tests;

/// <summary>
/// Ports and loopback addresses that are this test process's alone (test/ports.js's way, in C#): each
/// process claims a slot in a registry in the temp directory (a file per slot naming the process that
/// holds it, reclaimed when that process is gone), and the slot owns a block of ports and of
/// 127.0.0.x addresses. Inside the process tests run side by side, so each call hands out the next
/// port that nothing is listening on, round the block. Kept apart from the Node suite's (its own
/// registry, ports and addresses) while the two run together.
/// Never write a port number or a 127.0.0.x address (other than 127.0.0.1) into a test: take one here.
/// </summary>
public static class Ports
{
    private const int Slots = 4;
    private const int PortsPerSlot = 600;
    private const int HostsPerSlot = 25;
    private const int FirstHost = 150;
    private static readonly int BasePort = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_CS_TEST_PORT_BASE"), out var b) ? b : 22000;
    private static readonly string Dir = Path.Combine(Path.GetTempPath(), "mandarin-cs-test-slots");
    private static readonly Lazy<int> SlotOf = new(Claim);
    private static int nextPort = -1, nextHost = -1;

    /// <summary>The next free port of this process's block: a different one each call.</summary>
    public static int Port()
    {
        int first = BasePort + SlotOf.Value * PortsPerSlot;
        for (int tries = 0; tries < PortsPerSlot; tries++)
        {
            int p = first + (int)((uint)Interlocked.Increment(ref nextPort) % PortsPerSlot);
            if (Free(IPAddress.Loopback, p)) return p;
        }
        throw new InvalidOperationException($"Ports: all {PortsPerSlot} ports of slot {SlotOf.Value} are in use");
    }

    /// <summary>
    /// <paramref name="count"/> loopback addresses no other test is using (a stand-in speaker answers on
    /// port 1400 and nowhere else, so each room of a fake household has an address of its own).
    /// </summary>
    public static string[] Hosts(int count)
    {
        var out_ = new List<string>();
        for (int tries = 0; out_.Count < count && tries < HostsPerSlot * 2; tries++)
        {
            int i = (int)((uint)Interlocked.Increment(ref nextHost) % HostsPerSlot);
            var host = "127.0.0." + (FirstHost + SlotOf.Value * HostsPerSlot + i);
            if (!out_.Contains(host) && Free(IPAddress.Parse(host), 1400)) out_.Add(host);
        }
        if (out_.Count < count) throw new InvalidOperationException($"Ports: no {count} free addresses in slot {SlotOf.Value}");
        return [.. out_];
    }

    private static bool Free(IPAddress ip, int port)
    {
        try
        {
            using var l = new TcpListener(ip, port);
            l.Start();
            l.Stop();
            return true;
        }
        catch (SocketException) { return false; }
    }

    private static int Claim()
    {
        Directory.CreateDirectory(Dir);
        using var lockFile = Locked();
        int me = Environment.ProcessId;
        for (int k = 0; k < Slots; k++)
        {
            var file = Path.Combine(Dir, "slot-" + k);
            int holder = 0;
            try { holder = int.Parse(File.ReadAllText(file).Trim(), System.Globalization.CultureInfo.InvariantCulture); } catch (IOException) { } catch (FormatException) { }
            if (holder == me || !Alive(holder))
            {
                File.WriteAllText(file, me.ToString(System.Globalization.CultureInfo.InvariantCulture));
                AppDomain.CurrentDomain.ProcessExit += (_, _) => { try { File.Delete(file); } catch (IOException) { } };
                return k;
            }
        }
        throw new InvalidOperationException($"Ports: all {Slots} slots are taken ({Dir}); run fewer test processes at once");
    }

    private static FileStream Locked()
    {
        var path = Path.Combine(Dir, "lock");
        for (int tries = 0; ; tries++)
        {
            try { return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) when (tries < 2000) { Thread.Sleep(5); }
        }
    }

    private static bool Alive(int pid)
    {
        if (pid <= 0) return false;
        try { using var p = Process.GetProcessById(pid); return !p.HasExited; }
        catch (ArgumentException) { return false; }
    }
}
