"use strict";
/*
 * The release build is shrunk by R8 (bug list item 158), which drops code nothing in Java calls. The app's native code
 * calls back into Java by name: dropped, the call fails where it is made (bug list item 160: away from home, the first
 * Opus track ended the player with "NoSuchMethodError: SimpleDecoderOutputBuffer.init", libopus asking for a method
 * R8 had taken out). Every class the native code names is kept whole by android/app/proguard-rules.pro.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app");
const rules = fs.readFileSync(path.join(APP, "proguard-rules.pro"), "utf8");

/** The classes [rules] keeps whole: `-keep class a.b.C { *; }`, or a whole package with `a.b.**`. */
function keeps(cls) {
  for (const m of rules.matchAll(/^-keep class ([\w.*]+) \{ \*; \}/gm)) {
    const k = m[1];
    if (k === cls || (k.endsWith(".**") && cls.startsWith(k.slice(0, -2)))) return true;
  }
  return false;
}

test("every Java class the app's native code names is kept whole by R8", () => {
  const dir = path.join(APP, "src/main/cpp");
  const named = new Set();
  for (const f of fs.readdirSync(dir).filter(n => /\.(c|cc|cpp)$/.test(n))) {
    for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/FindClass\(\s*"([^"]+)"/g)) named.add(m[1].replace(/\//g, "."));
  }
  assert.ok(named.has("androidx.media3.decoder.SimpleDecoderOutputBuffer"), "the Opus decoder's output buffer, found in opus_jni.cc");
  for (const cls of named) assert.ok(keeps(cls), `${cls} is named by native code but not kept whole in proguard-rules.pro`);
});

test("the app's own code, its Opus decoder and every native method are kept", () => {
  assert.ok(keeps("com.musicd.server.android.MainActivity"));
  assert.ok(keeps("androidx.media3.decoder.opus.OpusDecoder"));
  assert.match(rules, /^-keepclasseswithmembernames class \* \{ native <methods>; \}/m);
});
