// Native.cs — the C libraries the engine calls: ALSA (libasound) for the
// sound device, and libc for the playback thread's core and priority.
using System.Runtime.InteropServices;

namespace Mandarin.Audio;

internal static partial class Alsa
{
    private const string Lib = "libasound.so.2";

    public const int StreamPlayback = 0;
    public const int FormatS32Le = 10;            // SND_PCM_FORMAT_S32_LE
    public const int AccessRwInterleaved = 3;     // SND_PCM_ACCESS_RW_INTERLEAVED

    [LibraryImport(Lib, EntryPoint = "snd_pcm_open", StringMarshalling = StringMarshalling.Utf8)]
    public static partial int Open(out IntPtr pcm, string name, int stream, int mode);

    [LibraryImport(Lib, EntryPoint = "snd_pcm_set_params")]
    public static partial int SetParams(IntPtr pcm, int format, int access, uint channels, uint rate, int softResample, uint latencyUs);

    [LibraryImport(Lib, EntryPoint = "snd_pcm_writei")]
    public static unsafe partial nint WriteI(IntPtr pcm, byte* buffer, nuint frames);

    [LibraryImport(Lib, EntryPoint = "snd_pcm_recover")]
    public static partial int Recover(IntPtr pcm, int err, int silent);

    [LibraryImport(Lib, EntryPoint = "snd_pcm_delay")]
    public static partial int Delay(IntPtr pcm, out nint frames);

    [LibraryImport(Lib, EntryPoint = "snd_pcm_drain")]
    public static partial int Drain(IntPtr pcm);

    [LibraryImport(Lib, EntryPoint = "snd_pcm_drop")]
    public static partial int Drop(IntPtr pcm);

    [LibraryImport(Lib, EntryPoint = "snd_pcm_prepare")]
    public static partial int Prepare(IntPtr pcm);

    [LibraryImport(Lib, EntryPoint = "snd_pcm_pause")]
    public static partial int Pause(IntPtr pcm, int enable);

    [LibraryImport(Lib, EntryPoint = "snd_pcm_close")]
    public static partial int Close(IntPtr pcm);

    [LibraryImport(Lib, EntryPoint = "snd_strerror")]
    private static partial IntPtr StrErrorPtr(int err);

    public static string StrError(int err)
    {
        try { return Marshal.PtrToStringUTF8(StrErrorPtr(err)) ?? ("error " + err); }
        catch { return "error " + err; }
    }

    // Whether this machine has ALSA at all (a Mac, a container without it).
    public static bool Available()
    {
        try { return NativeLibrary.TryLoad(Lib, out var h) && h != IntPtr.Zero; }
        catch { return false; }
    }
}

internal static partial class Libc
{
    private const int SchedFifo = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct SchedParam { public int Priority; }

    [LibraryImport("libc", EntryPoint = "sched_setscheduler", SetLastError = true)]
    private static partial int SetScheduler(int pid, int policy, ref SchedParam param);

    [LibraryImport("libc", EntryPoint = "sched_setaffinity", SetLastError = true)]
    private static unsafe partial int SetAffinity(int pid, nuint size, byte* mask);

    [LibraryImport("libc", EntryPoint = "setpriority", SetLastError = true)]
    private static partial int SetPriority(int which, int who, int prio);

    [LibraryImport("libc", EntryPoint = "gettid")]
    private static partial int GetTid();

    /*
     * The calling thread on its own core, at a real-time priority where the
     * system allows it (root, or a container run with --privileged or with
     * the SYS_NICE capability), else at a higher ordinary priority where
     * that is allowed. Returns what was granted, for the log.
     */
    public static string FavourThisThread(int core)
    {
        if (!OperatingSystem.IsLinux()) return "ordinary";
        var granted = new List<string>();
        try
        {
            if (core >= 0 && core < 1024)
            {
                unsafe
                {
                    var mask = stackalloc byte[128];
                    for (int i = 0; i < 128; i++) mask[i] = 0;
                    mask[core / 8] = (byte)(1 << (core % 8));
                    if (SetAffinity(0, 128, mask) == 0) granted.Add("core " + core);
                }
            }
            var p = new SchedParam { Priority = 20 };
            if (SetScheduler(0, SchedFifo, ref p) == 0) granted.Add("real-time priority");
            else if (SetPriority(0, GetTid(), -10) == 0) granted.Add("higher priority");
        }
        catch (Exception) { /* a libc without these: the thread runs as it is */ }
        return granted.Count > 0 ? string.Join(", ", granted) : "ordinary";
    }
}
