// Xml.cs — lib/xml.js (v0.8.37) for the playback ports (stage 2 of
// docs/specs/csharp-migration.md): escaping what is written to a player, and
// reading what it writes back.
//
// The Node server reads XML with fast-xml-parser 5.11.1, namespaces stripped,
// attributes as "@name", values as trimmed strings, the five XML entities
// decoded. What a player sends is often sloppy and every reader here is
// forgiving with it, so the reading is that parser's, step for step, rather
// than System.Xml's: the same tree for the same text, wrong or right, and
// null where it gives up. Its tree is JavaScript's (Tags/Js.cs): objects with
// JavaScript's key order, one child as itself and several as a list, text as
// "#text". What that means in practice:
//
//   - nothing is validated: a closing tag closes whatever is open, whatever its
//     name; an unclosed tag is closed by the end; text outside the root is
//     dropped (unless a stray closing tag, a CDATA section or a processing
//     instruction keeps it); a comment is skipped and the text either side of
//     it joined;
//   - it gives up (null) on a tag, comment, CDATA or processing instruction
//     never closed, more than about a hundred tags open at once, a tag opened
//     as "#text" (<#text/> passes, as empty text), one named "__proto__",
//     "constructor" or "prototype", and a DOCTYPE it can't read; "toString"
//     and its kind are renamed "__toString";
//   - numeric references (&#38;) are left as they are, except those XML
//     forbids (&#0;, a surrogate; a control character unless the document
//     says version="1.1"), which are dropped;
//     entities a DOCTYPE declares are expanded, unless their text looks like
//     markup or script (the parser's own safety list).
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

/* Where fast-xml-parser throws: lib/xml.js's parse() turns it into null. */
internal sealed class XmlRefused(string message) : Exception(message);

internal static partial class Xml
{
    /* parse(): the tree, or null for anything but a non-empty string, or text the parser gives up on. */
    public static object? Parse(object? text)
    {
        if (text is not string s || s.Length == 0) return null;
        try { return Compress(new Reader(s).Read()); }
        catch (XmlRefused) { return null; }
    }

    /* escape(): String(s), with & < > " ' as entities (null and undefined as ""). */
    public static string Escape(object? s)
    {
        var t = Js.IsNullish(s) ? "" : Js.Str(s);
        return t.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&apos;");
    }

    /* list(): one child as a list of one; none as an empty list. */
    public static List<object?> ListOf(object? v) => v switch
    {
        null or Undef => [],
        List<object?> l => l,
        _ => [v]
    };

    /* text(): a node's text, whether it came as a bare string or with attributes beside it. */
    public static string Text(object? v) => v switch
    {
        null or Undef => "",
        string s => s,
        double d => Js.Num(d),
        JsObj o when !Js.IsNullish(o["#text"]) => Js.Str(o["#text"]),
        _ => ""
    };

    /* node.key, for the names the readers ask for: none of them is inherited by a string, a list or a plain object. */
    public static object? Prop(object? node, string key) => node is JsObj o ? o[key] : Undef.V;

    /* a || b */
    public static object? Or(object? a, object? b) => Js.Truthy(a) ? a : b;

    // -- the parser's own tree, before it is made into objects (xmlNode.js) --

    private sealed class Node(string tag)
    {
        public string Tag = tag;
        public readonly List<object> Child = [];   // Node, or Text
        public JsObj? Attrs;
    }
    private sealed record Text_(object Value);

    /* node2json.js's compress: the children as an object, text joined as "#text", attributes laid over. */
    private static JsObj Compress(List<object> arr)
    {
        object? text = Undef.V;
        var o = new JsObj();
        foreach (var e in arr)
        {
            // A node named ":@" has no name left once its attributes take the key; one named "#text" counts as text.
            string? prop = e is Text_ ? "#text" : ((Node)e).Tag == ":@" ? null : ((Node)e).Tag;
            if (prop == null) continue;
            if (prop == "#text")
            {
                // A self-closing <#text/> passes as text: its value is its (empty) list of children.
                object? v = e is Text_ t ? t.Value : new List<object?>();
                text = text is Undef ? v : Js.Str(text) + Js.Str(v);
                continue;
            }
            var n = (Node)e;
            var c = Compress(n.Child);
            object? val = c;
            if (n.Attrs != null) foreach (var k in n.Attrs.Keys) c[k] = n.Attrs[k];
            else if (c.Count == 1 && c["#text"] is not Undef) val = c["#text"];
            else if (c.Count == 0) val = "";
            if (o.Has(prop))
            {
                if (o[prop] is List<object?> l) l.Add(val);
                else o[prop] = new List<object?> { o[prop], val };
            }
            else o[prop] = val;
        }
        if (text is string ts) { if (ts.Length > 0) o["#text"] = ts; }
        else if (text is not Undef) o["#text"] = text;
        return o;
    }

    /* sanitizeName: names that would reach an object's prototype are refused, or renamed. */
    private static string Sanitize(string name) => name switch
    {
        "__proto__" or "constructor" or "prototype" => throw new XmlRefused($"[SECURITY] Invalid name: \"{name}\""),
        "hasOwnProperty" or "toString" or "valueOf" or "__defineGetter__" or "__defineSetter__" or "__lookupGetter__" or "__lookupSetter__" => "__" + name,
        _ => name
    };

    private static string TrimStart(string s)
    {
        var a = 0;
        while (a < s.Length && Js.IsWs(s[a])) a++;
        return s[a..];
    }

    /* JavaScript's substring: clamped, and the ends swapped when given backwards. */
    private static string Sub(string s, int a, int b)
    {
        a = Math.Clamp(a, 0, s.Length);
        b = Math.Clamp(b, 0, s.Length);
        if (a > b) (a, b) = (b, a);
        return s[a..b];
    }

    /* OrderedObjParser.js's parseXml, with lib/xml.js's options. */
    private sealed class Reader(string text)
    {
        private readonly string s = text.Replace("\r\n", "\n").Replace('\r', '\n');
        private readonly Entities entities = new();
        private readonly List<Node> stack = [];
        private bool docType;

        private int At(int i) => i >= 0 && i < s.Length ? s[i] : -1;

        private int FindClosing(string str, int i, string error)
        {
            var at = i > s.Length ? -1 : s.IndexOf(str, Math.Max(i, 0), StringComparison.Ordinal);
            if (at == -1) throw new XmlRefused(error);
            return at + str.Length - 1;
        }

        public List<object> Read()
        {
            var root = new Node("!xml");
            var cur = root;
            var text = new StringBuilder();
            for (var i = 0; i < s.Length; i++)
            {
                var ch = s[i];
                if (ch != '<') { text.Append(ch); continue; }
                var c1 = At(i + 1);
                if (c1 == '/')
                {
                    // A closing tag closes whatever is open; its name only has to be allowed.
                    var close = FindClosing(">", i, "Closing Tag is not closed.");
                    var name = Js.Trim(Sub(s, i + 2, close));
                    var colon = name.IndexOf(':');
                    if (colon != -1) name = name[(colon + 1)..];
                    Sanitize(name);
                    SaveText(text, cur);
                    if (stack.Count > 0) { cur = stack[^1]; stack.RemoveAt(stack.Count - 1); } else cur = root;
                    i = close;
                }
                else if (c1 == '?')
                {
                    var tag = ReadTagExp(i, false, "?>") ?? throw new XmlRefused("Pi Tag is not closed.");
                    SaveText(text, cur);
                    var attrs = Attributes(tag.Exp);
                    if (attrs != null)
                    {
                        // <?xml version="1.1"?> lets control characters through as references.
                        var ver = Js.ToNumber(attrs["@version"]);
                        entities.Version11 = (double.IsNaN(ver) || ver == 0 ? 1.0 : ver) == 1.1;
                    }
                    var node = new Node(tag.Name);
                    node.Child.Add(new Text_(""));
                    if (tag.Name != tag.Exp && tag.AttrExpPresent && attrs is { Count: > 0 }) node.Attrs = attrs;
                    cur.Child.Add(node);
                    i = tag.Close + 1;
                }
                else if (c1 == '!' && At(i + 2) == '-' && At(i + 3) == '-')
                {
                    // Skipped, and the text either side of it is one text.
                    i = FindClosing("-->", i + 4, "Comment is not closed.");
                    continue;
                }
                else if (c1 == '!' && At(i + 2) == 'D')
                {
                    if (docType) throw new XmlRefused("Multiple DOCTYPE declarations found.");
                    docType = true;
                    var (declared, end) = new DocType(s).Read(i);
                    entities.Declare(declared);
                    i = end;
                    continue;
                }
                else if (c1 == '!' && At(i + 2) == '[')
                {
                    // CDATA: as it is, untrimmed and undecoded (the nine characters of "<![CDATA[" taken on trust).
                    var close = FindClosing("]]>", i, "CDATA is not closed.") - 2;
                    var exp = Sub(s, i + 9, close);
                    SaveText(text, cur);
                    cur.Child.Add(new Text_(exp));
                    i = close + 2;
                }
                else
                {
                    var tag = ReadTagExp(i, true, ">") ?? throw new XmlRefused($"readTagExp returned undefined at position {i}");
                    var name = Sanitize(tag.Name);
                    var exp = tag.Exp;
                    var attrExp = tag.AttrExpPresent;
                    if (name == "#text") throw new XmlRefused($"Invalid tag name: {name}");
                    if (text.Length > 0 && cur.Tag != "!xml") SaveText(text, cur);
                    var selfClosing = false;
                    if (exp.Length > 0 && exp.LastIndexOf('/') == exp.Length - 1)
                    {
                        selfClosing = true;
                        if (name.Length > 0 && name[^1] == '/') { name = name[..^1]; exp = name; }
                        else exp = exp[..^1];
                        attrExp = name != exp;
                    }
                    JsObj? attrs = null;
                    if (name != exp && attrExp) attrs = Attributes(exp);
                    if (selfClosing)
                    {
                        cur.Child.Add(new Node(Sanitize(name)) { Attrs = attrs });
                    }
                    else
                    {
                        var node = new Node(name) { Attrs = attrs };
                        if (stack.Count > 100) throw new XmlRefused("Maximum nested tags exceeded");
                        stack.Add(cur);
                        cur.Child.Add(node);
                        cur = node;
                    }
                    i = tag.Close;
                }
                text.Clear();
            }
            return root.Child;
        }

        /* saveTextToParentTag: trimmed, then decoded; nothing kept if nothing is left. */
        private void SaveText(StringBuilder text, Node to)
        {
            if (text.Length == 0) return;
            var val = Js.Trim(text.ToString());
            text.Clear();
            if (val.Length == 0) return;
            val = entities.Decode(val);
            if (val.Length > 0) to.Child.Add(new Text_(val));
        }

        private readonly record struct TagExp(string Name, string Exp, int Close, bool AttrExpPresent);

        /* readTagExp: the text up to the closing mark (quotes may hide it), split at the first white space. */
        private TagExp? ReadTagExp(int i, bool removeNs, string closing)
        {
            var data = new StringBuilder();
            int boundary = 0, segment = i + 1, close = -1;
            for (var at = i + 1; at < s.Length; at++)
            {
                var c = s[at];
                if (boundary != 0) { if (c == boundary) boundary = 0; }
                else if (c is '"' or '\'') boundary = c;
                else if (c == closing[0])
                {
                    if (closing.Length == 1 || At(at + 1) == closing[1]) { data.Append(s, segment, at - segment); close = at; break; }
                }
                else if (c == '\t') { data.Append(s, segment, at - segment).Append(' '); segment = at + 1; }
            }
            if (close == -1) return null;
            var full = data.ToString();
            var exp = full;
            var name = full;
            var attrExp = true;
            var sep = -1;
            for (var k = 0; k < full.Length; k++) if (Js.IsWs(full[k])) { sep = k; break; }
            if (sep != -1) { name = full[..sep]; exp = TrimStart(full[(sep + 1)..]); }
            if (removeNs)
            {
                var colon = name.IndexOf(':');
                if (colon != -1) { name = name[(colon + 1)..]; attrExp = name != full[(colon + 1)..]; }
            }
            return new TagExp(name, exp, close, attrExp);
        }

        /* buildAttributesMap: name="value" and name='value' pairs, namespaces and xmlns dropped, values trimmed and decoded. */
        private JsObj? Attributes(string str)
        {
            var found = new List<(string Name, string? Value)>();
            var p = 0;
            // /([^\s=]+)\s*(=\s*(['"])([\s\S]*?)\3)?/g
            while (p < str.Length)
            {
                if (Js.IsWs(str[p]) || str[p] == '=') { p++; continue; }
                var start = p;
                while (p < str.Length && !Js.IsWs(str[p]) && str[p] != '=') p++;
                var name = str[start..p];
                while (p < str.Length && Js.IsWs(str[p])) p++;
                string? value = null;
                if (p < str.Length && str[p] == '=')
                {
                    var q = p + 1;
                    while (q < str.Length && Js.IsWs(str[q])) q++;
                    if (q < str.Length && str[q] is '"' or '\'')
                    {
                        var end = str.IndexOf(str[q], q + 1);
                        if (end != -1) { value = str[(q + 1)..end]; p = end + 1; }
                    }
                }
                found.Add((name, value));
            }
            var values = new string?[found.Count];
            for (var k = 0; k < found.Count; k++)
                if (ResolveNamespace(found[k].Name).Length > 0 && found[k].Value is { } v) values[k] = entities.Decode(Js.Trim(v));
            JsObj? attrs = null;
            for (var k = 0; k < found.Count; k++)
            {
                var name = ResolveNamespace(found[k].Name);
                if (name.Length == 0 || values[k] is not { } v) continue;
                attrs ??= new JsObj();
                attrs["@" + name] = v;
            }
            return attrs;
        }

        private static string ResolveNamespace(string name)
        {
            var parts = name.Split(':');
            if (parts[0] == "xmlns") return "";
            return parts.Length == 2 ? (name.Length > 0 && name[0] == '/' ? "/" : "") + parts[1] : name;
        }
    }

    /* @nodable/entities' EntityDecoder, as fast-xml-parser sets it up: the five XML entities, a DOCTYPE's own, numeric references left alone but for those XML 1.0 forbids. */
    private sealed class Entities
    {
        public bool Version11;
        private Dictionary<string, string> declared = new(StringComparer.Ordinal);
        private double expanded;

        public void Declare(List<(string Name, string Value)> list)
        {
            expanded = 0;
            declared = new(StringComparer.Ordinal);
            foreach (var (name, value) in list) if (!Unsafe(value)) declared[name] = value;
        }

        private static string? Named(string name) => name switch
        {
            "amp" => "&", "apos" => "'", "gt" => ">", "lt" => "<", "quot" => "\"", _ => null
        };

        public string Decode(string str)
        {
            if (str.Length == 0 || str.IndexOf('&') == -1) return str;
            StringBuilder? sb = null;
            int last = 0, i = 0, len = str.Length;
            while (i < len)
            {
                if (str[i] != '&') { i++; continue; }
                var j = i + 1;
                while (j < len && str[j] != ';' && j - i <= 32) j++;
                if (j >= len || str[j] != ';') { i++; continue; }
                var token = str[(i + 1)..j];
                if (token.Length == 0) { i++; continue; }
                string? rep = token[0] == '#' ? Numeric(token)
                    : declared.TryGetValue(token, out var d) ? d : Named(token);
                if (rep == null) { i++; continue; }
                sb ??= new StringBuilder(len);
                sb.Append(str, last, i - last).Append(rep);
                last = j + 1;
                i = last;
                var delta = rep.Length - (token.Length + 2);
                if (delta > 0 && (expanded += delta) > 100000) throw new XmlRefused("[EntityReplacer] Expanded content length limit exceeded");
            }
            if (sb == null) return str;
            if (last < len) sb.Append(str, last, len - last);
            return sb.ToString();
        }

        /* &#…; and &#x…; read as parseInt reads them; only the forbidden ones are touched, and they go. */
        private string? Numeric(string token)
        {
            var hex = token.Length > 1 && token[1] is 'x' or 'X';
            var cp = ParseInt(hex ? token[2..] : token[1..], hex ? 16 : 10);
            if (double.IsNaN(cp) || cp < 0 || cp > 0x10FFFF) return null;
            var forbidden = cp == 0 || (cp >= 0xD800 && cp <= 0xDFFF) || (!Version11 && cp >= 1 && cp <= 0x1F && cp != 9 && cp != 10 && cp != 13);
            return forbidden ? "" : null;
        }

        /* parseInt(s, radix) for 10 and 16: leading space, a sign, "0x" in hex, then as many digits as there are. */
        private static double ParseInt(string s, int radix)
        {
            var i = 0;
            while (i < s.Length && Js.IsWs(s[i])) i++;
            var neg = false;
            if (i < s.Length && s[i] is '+' or '-') { neg = s[i] == '-'; i++; }
            if (radix == 16 && i + 1 < s.Length && s[i] == '0' && s[i + 1] is 'x' or 'X') i += 2;
            double v = 0;
            var start = i;
            for (; i < s.Length; i++)
            {
                var c = s[i];
                var d = c >= '0' && c <= '9' ? c - '0' : radix == 16 && (c | 0x20) >= 'a' && (c | 0x20) <= 'f' ? (c | 0x20) - 'a' + 10 : -1;
                if (d < 0) break;
                v = v * radix + d;
            }
            if (i == start) return double.NaN;
            return neg ? -v : v;
        }
    }

    // -- a DOCTYPE (DocTypeReader.js): its internal entities kept, the rest read past --

    private sealed class DocType(string s)
    {
        private char? C(int i) => i >= 0 && i < s.Length ? s[i] : null;

        private bool HasSeq(string seq, int i)
        {
            for (var j = 0; j < seq.Length; j++) if (C(i + j + 1) != seq[j]) return false;
            return true;
        }

        private int SkipWs(int i)
        {
            while (i < s.Length && Js.IsWs(s[i])) i++;
            return i;
        }

        public (List<(string, string)>, int) Read(int i)
        {
            var entities = new List<(string Name, string Value)>();
            if (!HasSeq("OCTYPE", i + 2)) throw new XmlRefused("Invalid Tag instead of DOCTYPE");
            i += 9;
            int brackets = 1, count = 0;
            bool body = false, comment = false;
            char? quote = null;
            for (; i < s.Length; i++)
            {
                var c = s[i];
                if (quote != null) { if (c == quote) quote = null; continue; }
                if (!body && !comment && c is '"' or '\'') { quote = c; continue; }
                if (c == '<' && !comment)
                {
                    if (body && HasSeq("!ENTITY", i))
                    {
                        i += 7;
                        var (name, value, at) = ReadEntity(i + 1);
                        i = at;
                        if (value.IndexOf('&') == -1)
                        {
                            if (count >= 1000) throw new XmlRefused("Entity count exceeds maximum allowed");
                            var k = entities.FindIndex(e => e.Name == name);
                            if (k >= 0) entities[k] = (name, value); else entities.Add((name, value));
                            count++;
                        }
                    }
                    else if (body && HasSeq("!ELEMENT", i)) { i += 8; i = ReadElement(i + 1); }
                    else if (body && HasSeq("!ATTLIST", i)) i += 8;
                    else if (body && HasSeq("!NOTATION", i)) { i += 9; i = ReadNotation(i + 1); }
                    else if (HasSeq("!--", i)) comment = true;
                    else throw new XmlRefused("Invalid DOCTYPE");
                    brackets++;
                }
                else if (c == '>')
                {
                    if (comment) { if (C(i - 1) == '-' && C(i - 2) == '-') { comment = false; brackets--; } }
                    else brackets--;
                    if (brackets == 0) break;
                }
                else if (c == '[') body = true;
            }
            if (quote != null || brackets != 0) throw new XmlRefused("Unclosed DOCTYPE");
            return (entities, i);
        }

        private string Word(ref int i, bool stopAtQuote)
        {
            var start = i;
            while (i < s.Length && !Js.IsWs(s[i]) && !(stopAtQuote && s[i] is '"' or '\'')) i++;
            return s[start..i];
        }

        private (string, string, int) ReadEntity(int i)
        {
            i = SkipWs(i);
            var name = Word(ref i, true);
            if (!QName(name)) throw new XmlRefused($"Invalid entity name {name}");
            i = SkipWs(i);
            if (Js.Upper(Sub(s, i, i + 6)) == "SYSTEM") throw new XmlRefused("External entities are not supported");
            if (C(i) == '%') throw new XmlRefused("Parameter entities are not supported");
            var (at, value) = Quoted(i, "entity");
            if (value.Length > 10000) throw new XmlRefused($"Entity \"{name}\" size exceeds maximum allowed size");
            return (name, value, at - 1);
        }

        private int ReadElement(int i)
        {
            i = SkipWs(i);
            var name = Word(ref i, false);
            if (!QName(name)) throw new XmlRefused($"Invalid element name: \"{name}\"");
            i = SkipWs(i);
            if (C(i) == 'E' && HasSeq("MPTY", i)) i += 4;
            else if (C(i) == 'A' && HasSeq("NY", i)) i += 2;
            else if (C(i) == '(')
            {
                i++;
                while (i < s.Length && s[i] != ')') i++;
                if (C(i) != ')') throw new XmlRefused("Unterminated content model");
            }
            else throw new XmlRefused("Invalid Element Expression");
            return i;
        }

        private int ReadNotation(int i)
        {
            i = SkipWs(i);
            var name = Word(ref i, false);
            if (!QName(name)) throw new XmlRefused($"Invalid entity name {name}");
            i = SkipWs(i);
            var type = Js.Upper(Sub(s, i, i + 6));
            if (type != "SYSTEM" && type != "PUBLIC") throw new XmlRefused($"Expected SYSTEM or PUBLIC, found \"{type}\"");
            i += type.Length;
            i = SkipWs(i);
            if (type == "PUBLIC")
            {
                (i, _) = Quoted(i, "publicIdentifier");
                i = SkipWs(i);
                if (C(i) is '"' or '\'') (i, _) = Quoted(i, "systemIdentifier");
            }
            else
            {
                (i, var system) = Quoted(i, "systemIdentifier");
                if (system.Length == 0) throw new XmlRefused("Missing mandatory system identifier for SYSTEM notation");
            }
            return i - 1;
        }

        private (int, string) Quoted(int i, string type)
        {
            var q = C(i);
            if (q is not ('"' or '\'')) throw new XmlRefused("Expected quoted string");
            i++;
            var start = i;
            while (i < s.Length && s[i] != q) i++;
            var value = s[start..i];
            if (C(i) != q) throw new XmlRefused($"Unterminated {type} value");
            return (i + 1, value);
        }
    }

    // xml-naming's QName for XML 1.0 (the DOCTYPE's names): a name, or prefix:name, of XML's name characters.
    private const string NcStart = "A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u0486\u0488-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD";
    private const string NcChar = NcStart + "\\-.0-9\u00B7\u0300-\u036F\u203F-\u2040";
    [GeneratedRegex("^[" + NcStart + "][" + NcChar + "]*(?::[" + NcStart + "][" + NcChar + "]*)?\\z", RegexOptions.CultureInvariant)]
    private static partial Regex QNameRe();
    private static bool QName(string name) => QNameRe().IsMatch(name);

    // is-unsafe's HTML and XML lists, which a DOCTYPE's entity must pass to be expanded (written out
    // case by case: JavaScript's /i folds ASCII letters only, its \s is its own white space, \w and \b ASCII).
    private const string Ws = "\\t\\n\\v\\f\\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF";
    private const string Wb = "(?<![A-Za-z0-9_])";
    private static string Ci(string word)
    {
        var sb = new StringBuilder();
        foreach (var c in word)
            if (char.IsAsciiLetter(c)) sb.Append('[').Append(char.ToUpperInvariant(c)).Append(char.ToLowerInvariant(c)).Append(']');
            else sb.Append(c);
        return sb.ToString();
    }
    private static readonly Regex[] UnsafePatterns = new[]
    {
        // HTML
        "<" + Ci("script") + "[" + Ws + ">/]",
        "</" + Ci("script") + "[" + Ws + ">]",
        string.Join("[\\t\\n\\r ]*", "javascript".Select(c => Ci(c.ToString()))) + "[\\t\\n\\r ]*:",
        Ci("vbscript") + "[\\t\\n\\r ]*:",
        Ci("data") + "[\\t\\n\\r ]*:[\\t\\n\\r ]*" + Ci("text") + "/" + Ci("html"),
        Ci("data") + "[\\t\\n\\r ]*:[\\t\\n\\r ]*" + Ci("application") + "/" + Ci("xhtml"),
        Ci("data") + "[\\t\\n\\r ]*:[\\t\\n\\r ]*" + Ci("image") + "/" + Ci("svg") + "\\+" + Ci("xml"),
        Wb + Ci("on") + "[A-Za-z0-9_]{1,30}[" + Ws + "]*=",
        "(?:&#" + Ci("x") + "0*3[Cc];?|&#0*60;?|&" + Ci("lt") + ";)[" + Ws + "]*" + Ci("script"),
        "(?:&#" + Ci("x") + "0*6[Aa];?|&#0*106;?)[" + Ws + "]*(?:&#" + Ci("x") + "0*61;?|" + Ci("a") + ")[\\s\\S]{0,80}" + Ci("script") + "[" + Ws + "]*:",
        Ci("style") + "[\\s\\S]{0,20}" + Ci("expression") + "[" + Ws + "]*\\(",
        "<(?:" + Ci("object") + "|" + Ci("embed") + ")[" + Ws + ">/]",
        "<" + Ci("base") + "[" + Ws + ">]",
        "<" + Ci("meta") + "[\\s\\S]{0,40}" + Ci("http-equiv") + "[\\s\\S]{0,20}" + Ci("refresh"),
        Ci("srcdoc") + "[" + Ws + "]*=",
        "<" + Ci("iframe") + "[" + Ws + ">/]",
        "<" + Ci("form") + "[" + Ws + ">/]",
        // XML
        "<!\\[" + Ci("CDATA") + "\\[",
        "\\]\\]>",
        "<\\?(?:" + Ci("xml") + "[- ]|" + Ci("php") + "|" + Ci("asp") + ")",
        "<!" + Ci("DOCTYPE") + "(?:[" + Ws + "\\[]|\\z)",
        Wb + Ci("SYSTEM") + "[" + Ws + "]+[\"']",
        Wb + Ci("PUBLIC") + "[" + Ws + "]+[\"']",
        "<!" + Ci("ENTITY") + "[" + Ws + "%]",
        "(?:&[A-Za-z0-9_]{1,20};){3,}",
        Wb + Ci("xmlns") + "[" + Ws + "]*(?::[A-Za-z0-9_]{1,40})?[" + Ws + "]*=",
        "<!--",
        "-->",
        "\\?>"
    }.Select(p => new Regex(p, RegexOptions.CultureInvariant)).ToArray();

    private static bool Unsafe(string value) => UnsafePatterns.Any(r => r.IsMatch(value));
}
