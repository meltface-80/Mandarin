"use strict";
/*
 * The screens contract's gate (tools/quality/parity.js,
 * docs/specs/native-parity.md), on made-up screens: what it reads of a
 * native screen's Compose source, and each way the app can differ from the
 * contract that it refuses. The gaps list's ratchet is held against commits,
 * so that part runs in a real `git init`.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { scan, mask, contractKotlin } = require("../tools/quality/parity-kotlin");
const { compare, validate, onPage, main } = require("../tools/quality/parity");

const F = "android/app/src/main/java/x/PlayScreen.kt";
/** A contract of one screen, "play": a Back, a title, a Play that is Play or Pause. */
const contract = (over = {}) => ({
  shell: { "android/app/src/main/java/x/Shell.kt": "the frame" },
  screens: { play: Object.assign({ page: "p", native: [F], preview: true, items: {
    back: { kind: "action", label: "Back" },
    title: { kind: "shows" },
    play: { kind: "action", label: ["Play", "Pause"] },
    desk: { kind: "action", label: "Desk", only: "page", why: "a desktop's" }
  } }, over) }
});
const SCREEN = `
@Composable fun PlayScreen() {
    Column {
        IconButton(onClick = {}, modifier = Modifier.parity("play.back", Contract.label("play.back"))) { Text("‹") }
        Text(title, Modifier.parity("play.title"))
        FilledIconButton(onClick = {}, modifier = Modifier.parity("play.play", Contract.label("play.play", 1))) { Icon(x, null) }
    }
}`;
const run = (src, over = {}, gaps = {}, refs = []) => compare({ contract: contract(over), gaps, sources: { [F]: src }, composables: [F], refs });

test("the source read as code: comments and strings blanked, every offset kept", () => {
  const src = 'import androidx.compose.foundation.clickable\nText("IconButton(") // Slider(\n/* Button( */ x';
  const m = mask(src);
  assert.equal(m.length, src.length);
  assert.equal(m.split("\n").length, 3);
  assert.ok(!/IconButton|Slider|Button|clickable/.test(m), m);
  assert.deepEqual(scan(src).findings.filter(f => /IconButton|Slider|Button|clickable/.test(f)), [], "nothing taken for a control");
});

test("a screen read: its controls and readouts by key, and what has none", () => {
  const r = scan(SCREEN);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.tags.map(t => [t.key, t.kind, t.label]), [["play.back", "action", "play.back"], ["play.title", "shows", null], ["play.play", "action", "play.play"]]);
  const bad = scan(`
    IconButton(onClick = {}) { Text("x") }
    Text(other)
    Box(Modifier.size(4.dp).clickable { go() })
    Box(Modifier.parity("play.title")) { Image(a, contentDescription = "Cover") }
    Slider(value = 0f, onValueChange = {}, modifier = Modifier.parity(key))`).findings;
  assert.equal(bad.length, 5, bad.join("\n"));
  assert.match(bad.join("\n"), /line 2: IconButton with no parity/);
  assert.match(bad.join("\n"), /line 3: Text with no parity/);
  assert.match(bad.join("\n"), /line 4: \.clickable with no parity/);
  assert.match(bad.join("\n"), /line 5: a label written in the screen/);
  assert.match(bad.join("\n"), /line 6: parity\(\) with its key not written out/);
  assert.deepEqual(scan(`Box(Modifier.parity("play.back", Contract.label("play.back")).clickable { }) { Text("‹") }`).tags.map(t => t.kind), ["action"], "a tap on a Box is a control");
});

test("the app as the contract has it: clean; each way it can differ refused", () => {
  assert.deepEqual(run(SCREEN).findings, []);
  assert.deepEqual(run(SCREEN).missing, { play: [] });
  const one = (src, over, gaps, refs) => run(src, over, gaps, refs).findings.join("\n");
  assert.match(one(SCREEN.replace('Text(title, Modifier.parity("play.title"))', 'Text(title, Modifier.parity("play.title"))\n Text(s, Modifier.parity("play.lyrics"))')), /play\.lyrics, which play's contract hasn't/);
  assert.match(one(SCREEN.replace("Contract.label(\"play.back\")", "\"Back\"")), /play\.back's label from the contract/);
  assert.match(one(SCREEN.replace('Text(title, Modifier.parity("play.title"))', 'TextButton(onClick = {}, modifier = Modifier.parity("play.title")) { Text(title) }')), /play\.title is a control here; on the page it only shows/);
  assert.match(one(SCREEN + '\nTextButton(onClick = {}, modifier = Modifier.parity("play.desk", Contract.label("play.desk"))) { }'), /play\.desk is the page's alone \(a desktop's\)/);
  // An item the page has and the app hasn't: on the gaps list in preview, never out of it.
  const noPlay = SCREEN.replace(/FilledIconButton[^\n]*\n/, "\n");
  assert.match(one(noPlay), /play\.play: on the page, not in the app \(PlayScreen\.kt\), nor on the gaps list/);
  assert.deepEqual(run(noPlay, {}, { play: ["play"] }).findings, []);
  assert.match(one(noPlay, { preview: false }, { play: ["play"] }), /play\.play: on the page, not in the app[^,]*$/m);
  assert.match(one(SCREEN, {}, { play: ["play"] }), /play\.play: built: `npm run parity -- accept`/);
  // The gaps list against an earlier commit: it never grows, and a screen out of preview stays out.
  const ref = (gaps, over = {}) => [{ name: "HEAD", contract: contract(over), gaps }];
  assert.deepEqual(run(noPlay, {}, { play: ["play"] }, ref({ play: ["play"] })).findings, []);
  assert.match(one(noPlay, {}, { play: ["play"] }, ref({})), /play\.play is a gap HEAD hadn't: the list only shrinks/);
  assert.match(one(noPlay, {}, { play: ["play"] }, ref({ play: ["play"] }, { preview: false })), /out of preview at HEAD; a screen never goes back into it/);
  assert.deepEqual(run(noPlay, {}, { play: ["play"] }, ref({}, { native: [] })).findings, [], "a screen new to the app starts with its gaps");
  // A Compose file that is no screen's and not the shell's.
  assert.match(compare({ contract: contract(), gaps: {}, sources: { [F]: SCREEN }, composables: [F, "android/app/src/main/java/x/Lyrics.kt"], refs: [] }).findings.join("\n"), /Lyrics\.kt: Compose, and no screen of the contract's/);
});

test("the contract itself: kinds, labels, the page's alone with a reason, in a control", () => {
  const c = contract();
  c.screens.play.items.odd = { kind: "button" };
  c.screens.play.items.mute = { kind: "action" };
  c.screens.play.items.mine = { kind: "action", label: "x", only: "page" };
  c.screens.play.items.deep = { kind: "shows", in: "title" };
  assert.deepEqual(validate(c).map(f => f.replace(/^.*?: play\./, "")), [
    'odd: kind is "button", not action or shows', "mute: a control with no label", 'mine: only "page" or "app", and why', 'deep: in "title", which is not a control of play']);
});

test("the app's alone (item 116, the log build): keyed and labelled in the app, never asked of the page", () => {
  const log = { log: { kind: "action", label: "Save log", only: "app", why: "the log build's" } };
  const items = (x) => ({ items: Object.assign({}, contract().screens.play.items, x), preview: false });
  const withLog = SCREEN.replace("    }\n}", '        TextButton(onClick = {}, modifier = Modifier.parity("play.log", Contract.label("play.log"))) { Text("Save log") }\n    }\n}');
  assert.deepEqual(run(withLog, items(log)).findings, []);
  assert.match(run(SCREEN, items(log)).findings.join("\n"), /play\.log: the app's alone, and not in the app \(PlayScreen\.kt\)/);
  const c = contract(); c.screens.play.items.log = log.log;
  assert.deepEqual(validate(c), []);
  assert.deepEqual(onPage(c, '"play.back" "play.title" "play.play" "play.desk"'), [], "the page needn't carry it");
  assert.match(Object.values(contractKotlin(c)).join("\n"), /"play\.log" to listOf\("Save log"\)/);
  c.screens.play.items.log = { kind: "action", label: "Save log", only: "app" };
  assert.match(validate(c).join("\n"), /log: only "page" or "app", and why/);
});

test("Contract.kt is the contract's labels; the gate refuses one written by hand, the gaps list one that grows", () => {
  const k = Object.values(contractKotlin(contract())).join("\n");
  assert.match(k, /"play\.back" to listOf\("Back"\),\n {8}"play\.play" to listOf\("Play", "Pause"\),/);
  assert.ok(!/play\.title|play\.desk/.test(k), "no readouts, nothing the page's alone");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-parity-"));
  const git = (...a) => spawnSync("git", a, { cwd: root, stdio: "pipe" });
  const put = (p, t) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); };
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  put("docs/specs/screens.json", JSON.stringify(contract()));
  put(F, SCREEN.replace(/FilledIconButton[^\n]*\n/, "\n"));
  put("android/app/src/main/java/x/Shell.kt", "@Composable fun Shell() {}");
  put("public/index.html", '<b data-parity="play.back"></b><b data-parity="play.title"></b><b data-parity="play.play"></b><b data-parity="play.desk"></b>');
  const gate = (...a) => { const log = console.log; const out = []; console.log = (s) => out.push(s); try { return [main(a, root), out]; } finally { console.log = log; } };
  assert.equal(gate("write")[0], 0);
  assert.deepEqual(gate("accept"), [0, ["parity: tools/quality/parity-gaps.json written", "parity: the app's native screens keep the contract (1 items still to build in preview, tools/quality/parity-gaps.json)"]]);
  git("add", "-A"); git("commit", "-q", "-m", "a preview with one gap");
  put("android/core/src/main/kotlin/com/musicd/server/client/Contract.kt", "object Contract {}");
  assert.match(gate()[1].join("\n"), /Contract\.kt: not the contract's labels/);
  gate("write");
  // A part left from a longer contract: the gate says so, and write takes it away.
  put("android/core/src/main/kotlin/com/musicd/server/client/ContractLabels9.kt", "internal object ContractLabels9 {}");
  assert.match(gate()[1].join("\n"), /ContractLabels9\.kt: a part of the contract's labels no longer written/);
  gate("write");
  assert.ok(!fs.existsSync(path.join(root, "android/core/src/main/kotlin/com/musicd/server/client/ContractLabels9.kt")));
  // Back taken out of the app: accept doesn't add it to the gaps, and the gate says so.
  put(F, SCREEN.replace(/FilledIconButton[^\n]*\n/, "\n").replace(/IconButton[^\n]*\n/, "\n"));
  const [code, out] = gate("accept");
  assert.equal(code, 1);
  assert.match(out.join("\n"), /play\.back: on the page, not in the app \(PlayScreen\.kt\), nor on the gaps list/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "tools/quality/parity-gaps.json"), "utf8")), { play: ["play"] });
  fs.rmSync(root, { recursive: true, force: true });
});

test("the labels in parts of 300 rows at most, a screen's together, Contract.kt joining them", () => {
  const items = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => ["b" + i, { kind: "action", label: "B" + i }]));
  const files = contractKotlin({ screens: { one: { page: "p", items: items(200) }, two: { page: "p", items: items(150) }, three: { page: "p", items: items(100) } } });
  const parts = Object.keys(files).filter(f => /ContractLabels\d+\.kt$/.test(f)).sort();
  assert.equal(parts.length, 2, "one alone, then two and three");
  const rows = (f) => (files[f].match(/ to listOf\(/g) || []).length;
  assert.deepEqual(parts.map(rows), [200, 250]);
  assert.ok(Object.values(files).every(t => t.split("\n").length < 400), "no part near the length watch");
  assert.match(files[Object.keys(files).find(f => f.endsWith("/Contract.kt"))], /val labels: Map<String, List<String>> = ContractLabels1\.labels \+ ContractLabels2\.labels\n/);
});

test("one element two screens': keys space-separated, each held by its own screen, a file both screens draw", () => {
  const c = contract();
  c.screens.list = { page: "p", native: [F], preview: true, items: { back: { kind: "action", label: "Back" }, rows: { kind: "shows" } } };
  const src = SCREEN.replace('Modifier.parity("play.back", Contract.label("play.back"))', 'Modifier.parity("play.back list.back", Contract.label("play.back"))') +
    '\nText(rows, Modifier.parity("list.rows"))';
  const r = compare({ contract: c, gaps: {}, sources: { [F]: src }, composables: [F], refs: [] });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.missing, { play: [], list: [] }, "Back counted for both");
  const other = compare({ contract: c, gaps: {}, sources: { [F]: src + '\nText(x, Modifier.parity("elsewhere.title"))' }, composables: [F], refs: [] }).findings;
  assert.deepEqual(other.filter(f => /elsewhere/.test(f)).length, 1, "a key of no screen drawn here, said once: " + other.join("; "));
  const label = compare({ contract: c, gaps: {}, sources: { [F]: src.replace('Contract.label("play.back")', 'Contract.label("play.title")') }, composables: [F], refs: [] }).findings;
  assert.match(label.join("\n"), /play\.back's label from the contract/);
});

test("a screen's own composable: its readouts covered where every call of it is keyed", () => {
  const helper = `
@Composable private fun Row2(title: String, modifier: Modifier) { Row(modifier) { Text(title) } }`;
  assert.deepEqual(scan(SCREEN + helper + '\nRow2(t, Modifier.parity("play.title"))').findings, [], "its one call keyed");
  assert.match(scan(SCREEN + helper + '\nRow2(t, Modifier.parity("play.title"))\nRow2(u, Modifier)').findings.join("\n"), /Text with no parity/, "a call of it with no key");
  assert.match(scan(SCREEN + helper).findings.join("\n"), /Text with no parity/, "never called");
  assert.deepEqual(scan(SCREEN + helper + '\nRow2(t, Modifier.parity("play.back", Contract.label("play.back")).clickable { })').tags.slice(-1).map(t => t.kind), ["action"], "a tap on it is a control");
});

test("every key of the contract written out in the page's source", () => {
  const page = '<b data-parity="play.back"></b><b data-parity="play.title"></b> b.dataset.parity = "play.play"; <i data-parity="play.desk">';
  assert.deepEqual(onPage(contract(), page), []);
  assert.deepEqual(onPage(contract(), page.replace("play.title", "play.titel")), ["play.title: written nowhere in the page (public/): the page carries every key as data-parity"]);
});
