"use strict";
/*
 * The Android builds fetch Gradle ahead with curl (item 381): the wrapper's own download tries once, and on 9 Nov 2026
 * GitHub's release service answered it 504 try after try, every APK failing before it was built. .github/gradle-retry.sh
 * fetches the distribution first, trying again, and puts it where the wrapper looks (its folder named by the MD5 of the
 * address in base 36). Run here against a stand-in that answers 504 twice and then sends it; the wrapper stood in for by a
 * gradlew that only says whether the distribution is in place.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const SCRIPT = path.join(__dirname, "..", ".github", "gradle-retry.sh");

// The wrapper's folder for [url]: its MD5 in base 36, as the wrapper's PathAssembler names it (BigInteger(1, md5).toString(36)).
const hash = url => BigInt("0x" + crypto.createHash("md5").update(url).digest("hex")).toString(36);

test("Gradle is fetched ahead, tried again past GitHub's 504s, and put where the wrapper looks", async () => {
  let asked = 0;
  const srv = http.createServer((req, res) => {
    asked++;
    if (asked <= 2) { res.writeHead(504); return res.end("Gateway Time-out"); }
    res.writeHead(200, { "Content-Type": "application/zip" }); res.end("the distribution");
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gradle-prefetch-"));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/distributions/gradle-8.14.3-bin.zip`;
    fs.mkdirSync(path.join(dir, "gradle", "wrapper"), { recursive: true });
    fs.writeFileSync(path.join(dir, "gradle", "wrapper", "gradle-wrapper.properties"), `distributionUrl=${url.replace(":", "\\:")}\n`);
    const home = path.join(dir, "home");
    const zip = path.join(home, "wrapper", "dists", "gradle-8.14.3-bin", hash(url), "gradle-8.14.3-bin.zip");
    fs.writeFileSync(path.join(dir, "gradlew"), `#!/bin/sh\n[ -f "${zip}" ] && echo "the wrapper finds it" || { echo "not there"; exit 1; }\n`, { mode: 0o755 });
    const out = await new Promise((resolve) => {
      const p = spawn("bash", [SCRIPT, "assemble"], { cwd: dir, env: Object.assign({}, process.env, { GRADLE_USER_HOME: home, GRADLE_PREFETCH_DELAY_S: "1", GRADLE_RETRY_WAIT_S: "1" }) });
      let s = ""; p.stdout.on("data", d => { s += d; }); p.stderr.on("data", d => { s += d; });
      p.on("exit", code => resolve({ code, s }));
    });
    assert.equal(out.code, 0, out.s);
    assert.match(out.s, /Gradle fetched ahead/);
    assert.match(out.s, /the wrapper finds it/);
    assert.equal(fs.readFileSync(zip, "utf8"), "the distribution");
    assert.equal(asked, 3, "asked again after each 504");
    // Both apps' wrappers check what they unpack against Gradle's published sum.
    for (const w of ["android", "bridge/android"]) {
      assert.match(fs.readFileSync(path.join(__dirname, "..", w, "gradle", "wrapper", "gradle-wrapper.properties"), "utf8"), /^distributionSha256Sum=[0-9a-f]{64}$/m, w);
    }
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
