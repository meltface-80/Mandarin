// BuildVersion.cs — this program's version as it was built (-p:Version, from package.json): a release's "1.1.3", or
// a test build's "1.1.4-t7" (bug list item 141: dev's builds are the next release with -tN, tools/test-version.js),
// whose suffix the assembly's own four-number version can't hold. The updater orders 1.1.4-t7 before 1.1.4, so the
// release is offered over a test build (Admin/Updater.cs, CmpVer).
using System.Reflection;

namespace Mandarin.Server;

internal static class BuildVersion
{
    /* The version [a] was built as. */
    public static string Of(Assembly a) => Parse(a.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion, a.GetName().Version);

    /* The informational version without the source revision the build may add ("+1a2b3c"), when it is a version;
       else the assembly version's three numbers, as it always was. */
    public static string Parse(string? informational, Version? assembly)
    {
        var s = (informational ?? "").Split('+')[0].Trim();
        return s.Length > 0 && Admin.Updater.ParseVer(s) != null ? s : (assembly ?? new Version(0, 0, 0)).ToString(3);
    }
}
