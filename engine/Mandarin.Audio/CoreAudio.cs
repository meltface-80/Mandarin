// CoreAudio.cs — a Mac's sound devices (bug list item 155): the C calls Core Audio is driven by (the
// CoreAudio, AudioToolbox and CoreFoundation frameworks), and the sink that plays a device through
// the HAL output unit. Opened by the device's name (coreaudio:<name>, as Settings → Audio Devices
// lists it), at each track's own rate: the device is set to that rate (never resampled; a rate it
// can't take is an error, as on ALSA), held for this program alone while it plays (hog mode, so
// nothing else is mixed in), and handed 32-bit samples as they are (Core Audio's float holds
// 24 bits exactly). The engine writes into a ring the device's thread takes from.
using System.Runtime.InteropServices;
using System.Text;

namespace Mandarin.Audio;

internal static unsafe partial class CoreAudioNative
{
    private const string CoreAudioLib = "/System/Library/Frameworks/CoreAudio.framework/CoreAudio";
    private const string ToolboxLib = "/System/Library/Frameworks/AudioToolbox.framework/AudioToolbox";
    private const string FoundationLib = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";

    public static uint Code(string s) => (uint)(s[0] << 24 | s[1] << 16 | s[2] << 8 | s[3]);

    [StructLayout(LayoutKind.Sequential)]
    public struct Address { public uint Selector, Scope, Element; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RateRange { public double Min, Max; }

    [StructLayout(LayoutKind.Sequential)]
    public struct ComponentDescription { public uint Type, SubType, Manufacturer, Flags, FlagsMask; }

    [StructLayout(LayoutKind.Sequential)]
    public struct StreamFormat
    {
        public double SampleRate;
        public uint FormatId, FormatFlags, BytesPerPacket, FramesPerPacket, BytesPerFrame, ChannelsPerFrame, BitsPerChannel, Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RenderCallback { public delegate* unmanaged<nint, uint*, void*, uint, uint, BufferList*, int> Proc; public nint RefCon; }

    [StructLayout(LayoutKind.Sequential)]
    public struct Buffer { public uint Channels, Bytes; public byte* Data; }

    [StructLayout(LayoutKind.Sequential)]
    public struct BufferList { public uint Count; public Buffer First; }

    public const uint SystemObject = 1;
    public static readonly uint Global = Code("glob"), OutputScope = Code("outp");

    [LibraryImport(CoreAudioLib, EntryPoint = "AudioObjectGetPropertyDataSize")]
    public static partial int GetSize(uint obj, in Address a, uint qualifierSize, nint qualifier, out uint size);
    [LibraryImport(CoreAudioLib, EntryPoint = "AudioObjectGetPropertyData")]
    public static partial int Get(uint obj, in Address a, uint qualifierSize, nint qualifier, ref uint size, void* data);
    [LibraryImport(CoreAudioLib, EntryPoint = "AudioObjectSetPropertyData")]
    public static partial int Set(uint obj, in Address a, uint qualifierSize, nint qualifier, uint size, void* data);

    [LibraryImport(ToolboxLib, EntryPoint = "AudioComponentFindNext")]
    public static partial nint FindComponent(nint after, in ComponentDescription d);
    [LibraryImport(ToolboxLib, EntryPoint = "AudioComponentInstanceNew")]
    public static partial int NewUnit(nint component, out nint unit);
    [LibraryImport(ToolboxLib, EntryPoint = "AudioComponentInstanceDispose")]
    public static partial int DisposeUnit(nint unit);
    [LibraryImport(ToolboxLib, EntryPoint = "AudioUnitSetProperty")]
    public static partial int SetUnit(nint unit, uint id, uint scope, uint element, void* data, uint size);
    [LibraryImport(ToolboxLib, EntryPoint = "AudioUnitInitialize")]
    public static partial int Initialize(nint unit);
    [LibraryImport(ToolboxLib, EntryPoint = "AudioUnitUninitialize")]
    public static partial int Uninitialize(nint unit);
    [LibraryImport(ToolboxLib, EntryPoint = "AudioOutputUnitStart")]
    public static partial int Start(nint unit);
    [LibraryImport(ToolboxLib, EntryPoint = "AudioOutputUnitStop")]
    public static partial int Stop(nint unit);

    [LibraryImport(FoundationLib, EntryPoint = "CFStringGetLength")]
    private static partial nint StringLength(nint s);
    [LibraryImport(FoundationLib, EntryPoint = "CFStringGetCString")]
    [return: MarshalAs(UnmanagedType.U1)]
    private static partial bool StringBytes(nint s, byte* buffer, nint size, uint encoding);
    [LibraryImport(FoundationLib, EntryPoint = "CFRelease")]
    public static partial void Release(nint o);

    /* A CFString's text, released. */
    public static string Text(nint s)
    {
        if (s == 0) return "";
        try
        {
            var size = StringLength(s) * 4 + 1;
            var buf = new byte[size];
            fixed (byte* b = buf)
                if (!StringBytes(s, b, size, 0x08000100 /* UTF-8 */)) return "";
            return Encoding.UTF8.GetString(buf, 0, Array.IndexOf(buf, (byte)0) is var n and >= 0 ? n : buf.Length);
        }
        finally { Release(s); }
    }

    /* Whether this machine has Core Audio at all. */
    public static bool Available() => OperatingSystem.IsMacOS() && NativeLibrary.TryLoad(CoreAudioLib, out _);
}
