const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const core = require("../boulevard-replay-core");
const { boulevardCaptures } = require("./local-server");
const { stageSite } = require("./stage-site");

const logs = [
  { id: "washer2", file: path.join(os.homedir(), "Downloads", "bugreport-walleye-OPM1.171019.019-2026-10-17-02-47-27", "FS", "data", "misc", "bluetooth", "logs", "btsnoop_hci.log"), sequence: 115, gapMs: 13954 },
  { id: "dryer1", file: path.join(os.homedir(), "Downloads", "dryer", "FS", "data", "misc", "bluetooth", "logs", "btsnoop_hci.log"), sequence: 87, gapMs: 28372 }
];

test("rejects data that is not an Android HCI btsnoop log", () => {
  assert.throws(() => core.parseBtsnoop(new Uint8Array(16)), /btsnoop log/);
});

test("raw notification formatting preserves every byte and escapes non-printable text", () => {
  const formatted = core.formatNotification(Uint8Array.from([0x5b, 0x41, 0x43, 0x4b, 0x00, 0xff, 0x22, 0x5c]));
  assert.equal(formatted, 'len=8 hex=5b41434b00ff225c ascii="[ACK\\x00\\xff\\"\\\\"');
});

for (const log of logs) {
  test(`${log.id} capture is complete and counter +1 alters no other bytes`, { skip: !fs.existsSync(log.file) }, () => {
    const events = core.parseBtsnoop(fs.readFileSync(log.file));
    const captures = core.findSecureCaptures(events);
    assert.equal(captures.length, 1);
    const capture = captures[0];
    assert.equal(capture.currentSequence, log.sequence);
    assert.equal(capture.packetSequence, log.sequence + 1);
    assert.deepEqual(capture.prelude.map((value) => core.ascii(value).startsWith("[") ? value.length : 0), [9, 20, 9]);
    assert.equal(capture.preludeDelaysMs[2], log.gapMs);
    assert.deepEqual(capture.chunks.map((value) => value.length), [20, 20, 20, 20, 17]);
    assert.ok(capture.writeOpcodes.every((opcode) => opcode === 0x52));
    assert.ok(capture.preludeOpcodes.every((opcode) => opcode === 0x52));
    const modified = core.incrementPacketCounter(capture);
    assert.equal(modified.original, log.sequence + 1);
    assert.equal(modified.modified, log.sequence + 2);
    assert.deepEqual(modified.packet.slice(0, 4), capture.packet.slice(0, 4));
    assert.equal(modified.packet[4], capture.packet[4] + 1);
    assert.deepEqual(modified.packet.slice(5), capture.packet.slice(5));
    assert.deepEqual(modified.chunks.map((value) => value.length), [20, 20, 20, 20, 17]);
  });
}

test("local preview returns only the two matching Boulevard B Block captures", { skip: logs.some((log) => !fs.existsSync(log.file)) }, async () => {
  const captures = await boulevardCaptures();
  assert.deepEqual(captures.map((capture) => capture.id), ["washer2", "dryer1"]);
  assert.deepEqual(captures.map((capture) => capture.capturedSequence), [115, 87]);
  assert.deepEqual(captures.map((capture) => capture.packetCounter), [116, 88]);
  assert.deepEqual(captures.map((capture) => capture.preludeDelaysMs[2]), logs.map((log) => log.gapMs));
  assert.ok(captures.every((capture) => capture.prelude.length === 3 && capture.chunks.length === 5));
  assert.ok(captures.every((capture) => !("password" in capture)));
});

test("the site root contains the self-contained replay page without duplicate trees", async () => {
  const root = path.resolve(__dirname, "..");
  for (const name of ["boulevard-replay.html", "boulevard-replay.js", "boulevard-replay-core.js"]) {
    assert.ok(fs.existsSync(path.join(root, name)), name);
  }
  const bundled = JSON.parse(fs.readFileSync(path.join(root, "boulevard-captures.json"), "utf8"));
  assert.deepEqual(bundled.captures.map((capture) => capture.id), ["washer2", "dryer1"]);
  assert.ok(bundled.captures.every((capture) => capture.prelude.length === 3 && capture.chunks.length === 5));
  if (fs.existsSync(path.join(root, "production"))) assert.deepEqual(fs.readdirSync(path.join(root, "production")), []);
  assert.equal(fs.existsSync(path.join(root, "preview")), false);
  if (logs.every((log) => fs.existsSync(log.file))) assert.deepEqual(bundled.captures, await boulevardCaptures());
});

test("deployment staging includes only root site files", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cwash-stage-test-"));
  try {
    await stageSite(directory);
    for (const name of ["index.html", "activate.html", "boulevard-replay.html", "boulevard-captures.json", "assets/data/catalog.json", ".nojekyll"]) {
      assert.ok(fs.existsSync(path.join(directory, name)), name);
    }
    for (const name of ["package.json", "netlify.toml", "README.md", "scripts", "preview", "production"]) {
      assert.equal(fs.existsSync(path.join(directory, name)), false, name);
    }
  } finally {
    if (path.basename(directory).startsWith("cwash-stage-test-")) fs.rmSync(directory, { recursive: true, force: true });
  }
});
