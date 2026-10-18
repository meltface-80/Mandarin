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
const { compare, validate, main } = require("../tools/quality/parity");

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
  const src = 'Text("IconButton(") // Slider(\n/* Button( */ x';
  const m = mask(src);
  assert.equal(m.length, src.length);
  assert.equal(m.split("\n").length, 2);
  assert.ok(!/IconButton|Slider|Button/.test(m), m);
  assert.deepEqual(scan(src).findings.filter(f => /IconButton|Slider|Button/.test(f)), [], "nothing taken for a control");
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
    'odd: kind is "button", not action or shows', "mute: a control with no label", 'mine: only "page", and why', 'deep: in "title", which is not a control of play']);
});

test("Contract.kt is the contract's labels; the gate refuses one written by hand, the gaps list one that grows", () => {
  const k = contractKotlin(contract());
  assert.match(k, /"play\.back" to listOf\("Back"\),\n {8}"play\.play" to listOf\("Play", "Pause"\),/);
  assert.ok(!/play\.title|play\.desk/.test(k), "no readouts, nothing the page's alone");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-parity-"));
  const git = (...a) => spawnSync("git", a, { cwd: root, stdio: "pipe" });
  const put = (p, t) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); };
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  put("docs/specs/screens.json", JSON.stringify(contract()));
  put(F, SCREEN.replace(/FilledIconButton[^\n]*\n/, "\n"));
  put("android/app/src/main/java/x/Shell.kt", "@Composable fun Shell() {}");
  const gate = (...a) => { const log = console.log; const out = []; console.log = (s) => out.push(s); try { return [main(a, root), out]; } finally { console.log = log; } };
  assert.equal(gate("write")[0], 0);
  assert.deepEqual(gate("accept"), [0, ["parity: tools/quality/parity-gaps.json written", "parity: the app's native screens keep the contract (1 items still to build in preview, tools/quality/parity-gaps.json)"]]);
  git("add", "-A"); git("commit", "-q", "-m", "a preview with one gap");
  put("android/core/src/main/kotlin/com/musicd/server/client/Contract.kt", "object Contract {}");
  assert.match(gate()[1].join("\n"), /Contract\.kt: not the contract's labels/);
  gate("write");
  // Back taken out of the app: accept doesn't add it to the gaps, and the gate says so.
  put(F, SCREEN.replace(/FilledIconButton[^\n]*\n/, "\n").replace(/IconButton[^\n]*\n/, "\n"));
  const [code, out] = gate("accept");
  assert.equal(code, 1);
  assert.match(out.join("\n"), /play\.back: on the page, not in the app \(PlayScreen\.kt\), nor on the gaps list/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "tools/quality/parity-gaps.json"), "utf8")), { play: ["play"] });
  fs.rmSync(root, { recursive: true, force: true });
});
