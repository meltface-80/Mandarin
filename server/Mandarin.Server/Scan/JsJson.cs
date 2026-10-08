// JsJson.cs — JSON.parse, into the tag reader's JavaScript values (v0.8.18):
// objects as JsObj (JavaScript's key order), arrays as lists, numbers as
// doubles, and strings with their \u escapes as the code units they name (a
// lone surrogate too, which System.Text.Json refuses). What the scan reads
// back from the database is read as the Node server read it.
using System.Globalization;
using System.Text;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Scan;

// The tag reader's JavaScript, not Mandarin.Server's JSON helpers of the same name.
using Js = Mandarin.Server.Tags.Js;

internal static class JsJson
{
    public static object? Parse(string s)
    {
        var p = new Parser(s);
        p.Space();
        var v = p.Value(0);
        p.Space();
        if (p.At != s.Length) throw p.Error();
        return v;
    }

    private sealed class Parser(string s)
    {
        public int At;

        public JsError Error() => At < s.Length
            ? new JsError($"Unexpected token '{s[At]}', \"{(s.Length > 30 ? s[..30] + "\"... " : s + "\" ")}is not valid JSON")
            : new JsError("Unexpected end of JSON input");

        public void Space()
        {
            while (At < s.Length && s[At] is ' ' or '\t' or '\n' or '\r') At++;
        }

        private void Expect(string word)
        {
            if (string.CompareOrdinal(s, At, word, 0, word.Length) != 0) throw Error();
            At += word.Length;
        }

        public object? Value(int depth)
        {
            if (depth > 2000) throw new JsError("Maximum call stack size exceeded");
            if (At >= s.Length) throw Error();
            switch (s[At])
            {
                case '{':
                {
                    At++;
                    var o = new JsObj();
                    Space();
                    if (At < s.Length && s[At] == '}') { At++; return o; }
                    while (true)
                    {
                        Space();
                        if (At >= s.Length || s[At] != '"') throw Error();
                        var k = Str();
                        Space();
                        if (At >= s.Length || s[At] != ':') throw Error();
                        At++;
                        Space();
                        o[k] = Value(depth + 1);
                        Space();
                        if (At < s.Length && s[At] == ',') { At++; continue; }
                        if (At < s.Length && s[At] == '}') { At++; return o; }
                        throw Error();
                    }
                }
                case '[':
                {
                    At++;
                    var l = new List<object?>();
                    Space();
                    if (At < s.Length && s[At] == ']') { At++; return l; }
                    while (true)
                    {
                        Space();
                        l.Add(Value(depth + 1));
                        Space();
                        if (At < s.Length && s[At] == ',') { At++; continue; }
                        if (At < s.Length && s[At] == ']') { At++; return l; }
                        throw Error();
                    }
                }
                case '"': return Str();
                case 't': Expect("true"); return true;
                case 'f': Expect("false"); return false;
                case 'n': Expect("null"); return null;
                default: return Number();
            }
        }

        private string Str()
        {
            At++;
            var sb = new StringBuilder();
            while (true)
            {
                if (At >= s.Length) throw Error();
                var c = s[At++];
                if (c == '"') return sb.ToString();
                if (c < 0x20) { At--; throw Error(); }
                if (c != '\\') { sb.Append(c); continue; }
                if (At >= s.Length) throw Error();
                var e = s[At++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        if (At + 4 > s.Length || !int.TryParse(s.AsSpan(At, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var u)) throw Error();
                        sb.Append((char)u);
                        At += 4;
                        break;
                    default: At--; throw Error();
                }
            }
        }

        private double Number()
        {
            var start = At;
            if (At < s.Length && s[At] == '-') At++;
            if (At >= s.Length) throw Error();
            if (s[At] == '0') At++;
            else if (s[At] >= '1' && s[At] <= '9') { while (At < s.Length && char.IsAsciiDigit(s[At])) At++; }
            else throw Error();
            if (At < s.Length && s[At] == '.')
            {
                At++;
                if (At >= s.Length || !char.IsAsciiDigit(s[At])) throw Error();
                while (At < s.Length && char.IsAsciiDigit(s[At])) At++;
            }
            if (At < s.Length && s[At] is 'e' or 'E')
            {
                At++;
                if (At < s.Length && s[At] is '+' or '-') At++;
                if (At >= s.Length || !char.IsAsciiDigit(s[At])) throw Error();
                while (At < s.Length && char.IsAsciiDigit(s[At])) At++;
            }
            return double.Parse(s.AsSpan(start, At - start), NumberStyles.Float, CultureInfo.InvariantCulture);
        }
    }
}
