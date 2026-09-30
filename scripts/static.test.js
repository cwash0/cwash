const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createStore = require("../assets/site-data");
const createBluetooth = require("../assets/bluetooth");
const { createServer, normalizeBasePath, renderNotFound } = require("../preview/local-preview");
const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "assets/data");
const catalog = JSON.parse(fs.readFileSync(path.join(dataRoot, "catalog.json")));
const loadJson = async (file) => JSON.parse(fs.readFileSync(path.join(dataRoot, file)));
const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
};

test("all sites and machine cycles survive in the static bundle", async () => {
  assert.equal(catalog.length, 2864);
  assert.equal(new Set(catalog.map((site) => site.id)).size, catalog.length);
  const store = createStore({ storage, loadJson });
  let machineCount = 0, cycles = 0;
  for (const entry of catalog) {
    assert.match(entry.file, /^sites-\d{2}\.json$/);
    const site = await store.loadSite(entry.id);
    for (const machine of site.machines) {
      machineCount++;
      assert.ok(machine.bluetoothName && machine.name && machine.id);
      for (const cycle of machine.cycles) {
        cycles++;
        assert.ok(cycle.key && cycle.label);
        assert.match(cycle.command, /^\[ACTIVATE:01:PULSE:(?:NONE|OCCUPIED_HIGH|END_HIGH_PULSE):[0-9A-F]{8}:[0-9A-F]{8}:[0-9A-F]{8}:[0-9A-F]{4}:[^\]]+\]$/);
      }
    }
  }
  assert.equal(machineCount, 20710);
  assert.equal(cycles, 51705);
});

test("search handles names, accents, addresses and compact postcodes", () => {
  const store = createStore({ storage, loadJson });
  assert.ok(store.search(catalog, "wallscourt").some((site) => site.id === "wallscourt_phase_2"));
  assert.equal(store.search(catalog, "qzxnonexistentsite").length, 0);
  assert.equal(store.search(catalog, " ").length, 0);
  const fixture = [{ id: "a", name: "Café & Court", address: "Bristol, BS16 1QY" }];
  assert.equal(store.search(fixture, "cafe and").length, 1);
  assert.equal(store.search(fixture, "bs161qy").length, 1);
  assert.equal(store.search(fixture, "bristol court").length, 1);
});

test("saved site persists between visits and changing site replaces it", async () => {
  const memory = storage();
  const first = createStore({ storage: () => memory, loadJson });
  assert.equal(first.savedSiteId(), "");
  assert.equal(first.rememberSite("wallscourt_phase_2"), true);
  const returning = createStore({ storage: () => memory, loadJson });
  assert.equal(returning.savedSiteId(), "wallscourt_phase_2");
  assert.ok((await returning.loadSite(returning.savedSiteId())).machines.length);
  returning.rememberSite("sawley_marina");
  assert.equal(first.savedSiteId(), "sawley_marina");
  assert.equal(await first.loadSite("invalid-saved-site"), null);
});

test("blocked storage still allows a site URL and machine loading", async () => {
  const store = createStore({ storage: () => { throw new Error("Blocked"); }, loadJson });
  assert.equal(store.savedSiteId(), "");
  assert.equal(store.rememberSite("sawley_marina"), false);
  assert.equal(store.activationUrl("sawley_marina"), "activate.html?site=sawley_marina");
  assert.ok((await store.loadSite("sawley_marina")).machines.length);
});

test("failed static downloads can be retried", async () => {
  let failCatalog = true, failMachines = true;
  const store = createStore({ storage, loadJson: async (file) => {
    if (file === "catalog.json" && failCatalog) { failCatalog = false; throw new Error("Offline"); }
    if (file !== "catalog.json" && failMachines) { failMachines = false; throw new Error("Offline"); }
    return loadJson(file);
  } });
  await assert.rejects(store.loadCatalog());
  assert.equal((await store.loadCatalog()).length, 2864);
  await assert.rejects(store.loadSite("sawley_marina"));
  assert.ok((await store.loadSite("sawley_marina")).machines.length);
});

const machine = { name: "Washer 1", bluetoothName: "TEST_MACHINE", cycles: [{ key: "standard", label: "Standard Eco", command: "[ACTIVATE:TEST]" }] };
function fakeBluetooth({ occupancy = "0", notifications = true, ack = true, errorAt, wrongDevice = false, writeMode = "writeValueWithoutResponse", pause } = {}) {
  const writes = [], waits = [];
  const device = new EventTarget();
  device.name = wrongDevice ? "WRONG_MACHINE" : machine.bluetoothName;
  const rx = new EventTarget();
  rx.startNotifications = async () => {};
  const tx = { [writeMode]: async (bytes) => {
    const text = new TextDecoder().decode(bytes);
    writes.push(text);
    if (!notifications) return;
    const reply = errorAt === text ? "[ERROR:REJECTED]" : ack ? text === "[HANDSHAKE:ENABLE]" ? "[ACK:HANDSHAKE]" : text === "[EXEC]" ? "[ACK:EXEC]" : "[ACK:ACTIVATE]" : "";
    for (const part of [reply.slice(0, 4), reply.slice(4)]) {
      const bytes = new TextEncoder().encode(part);
      rx.value = new DataView(bytes.buffer);
      rx.dispatchEvent(new Event("characteristicvaluechanged"));
    }
  } };
  let currentOccupancy = occupancy;
  const service = { getCharacteristic: async (uuid) => {
    if (uuid.startsWith("569a2001")) return tx;
    if (uuid.startsWith("569a2000")) { if (!notifications) throw new Error("Unavailable"); return rx; }
    return { readValue: async () => {
      if (currentOccupancy === null) throw new Error("No occupancy sensor");
      const bytes = typeof currentOccupancy === "string" ? new TextEncoder().encode(currentOccupancy) : currentOccupancy;
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } };
  } };
  device.gatt = { connected: false, connect: async () => { device.gatt.connected = true; return { getPrimaryService: async () => service }; }, disconnect: () => { device.gatt.connected = false; device.dispatchEvent(new Event("gattserverdisconnected")); } };
  let disconnects = 0;
  const controller = createBluetooth({ bluetooth: { requestDevice: async (options) => {
    assert.deepEqual(options.filters, [{ name: machine.bluetoothName }]);
    return device;
  } }, onDisconnect: () => disconnects++, pause: async (ms) => { waits.push(ms); await pause?.(ms); } });
  return { controller, writes, waits, device, setOccupancy: (value) => { currentOccupancy = value; }, disconnects: () => disconnects };
}

test("unlimited activation preserves command order, timing and acknowledgments", async () => {
  const fixture = fakeBluetooth();
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(await fixture.controller.connect(machine), { occupied: false });
    assert.deepEqual(await fixture.controller.start("standard"), { acknowledged: true });
    assert.equal(fixture.controller.isConnected(), false);
  }
  assert.equal(fixture.writes.length, 30);
  assert.deepEqual(fixture.writes.slice(0, 3), ["[HANDSHAKE:ENABLE]", "[ACTIVATE:TEST]", "[EXEC]"]);
  assert.deepEqual(fixture.waits.slice(0, 3), [1000, 1000, 2000]);
  assert.equal(fixture.disconnects(), 0);
});

test("occupied machines cannot start; occupancy is rechecked before starting", async () => {
  for (const occupancy of ["1120", new Uint8Array([0x11, 0x20])]) {
    const fixture = fakeBluetooth({ occupancy });
    assert.deepEqual(await fixture.controller.connect(machine), { occupied: true });
    await assert.rejects(fixture.controller.start("standard"));
    assert.equal(fixture.writes.length, 0);
  }
  const fixture = fakeBluetooth();
  await fixture.controller.connect(machine);
  fixture.setOccupancy("1120");
  await assert.rejects(fixture.controller.start("standard"), /in use/);
  assert.equal(fixture.writes.length, 0);
});

test("legacy controllers without notifications or occupancy can receive commands", async () => {
  const fixture = fakeBluetooth({ notifications: false, occupancy: null });
  await fixture.controller.connect(machine);
  assert.deepEqual(await fixture.controller.start("standard"), { acknowledged: false });
  assert.equal(fixture.writes.length, 3);
});

test("write transport falls back for older browser implementations", async () => {
  for (const writeMode of ["writeValueWithResponse", "writeValue"]) {
    const fixture = fakeBluetooth({ writeMode });
    await fixture.controller.connect(machine);
    assert.deepEqual(await fixture.controller.start("standard"), { acknowledged: true });
  }
});

test("wrong devices, invalid cycles and command errors cannot execute a start", async () => {
  const wrong = fakeBluetooth({ wrongDevice: true });
  await assert.rejects(wrong.controller.connect(machine), /selected machine/);
  const fixture = fakeBluetooth({ errorAt: "[ACTIVATE:TEST]" });
  await fixture.controller.connect(machine);
  await assert.rejects(fixture.controller.start("missing-cycle"), /unavailable/);
  await assert.rejects(fixture.controller.start("standard"), /could not accept/);
  assert.deepEqual(fixture.writes, ["[HANDSHAKE:ENABLE]", "[ACTIVATE:TEST]"]);
  assert.equal(fixture.controller.isConnected(), false);
});

test("duplicate clicks are rejected and disconnects stop subsequent commands", async () => {
  let resume;
  const fixture = fakeBluetooth({ pause: () => new Promise((resolve) => { resume = resolve; }) });
  await fixture.controller.connect(machine);
  const starting = fixture.controller.start("standard");
  await assert.rejects(fixture.controller.start("standard"), /already in progress/);
  await new Promise((resolve) => setImmediate(resolve));
  fixture.device.gatt.disconnect();
  resume();
  await assert.rejects(starting, /Connection ended/);
  assert.deepEqual(fixture.writes, ["[HANDSHAKE:ENABLE]"]);
  assert.equal(fixture.disconnects(), 1);
});

test("cancelling a pending device selection does not restore an old connection", async () => {
  let resolveDevice;
  const fixture = fakeBluetooth();
  const controller = createBluetooth({ bluetooth: { requestDevice: () => new Promise((resolve) => { resolveDevice = resolve; }) } });
  const connecting = controller.connect(machine);
  controller.disconnect();
  resolveDevice(fixture.device);
  await assert.rejects(connecting, /cancelled/);
  assert.equal(controller.isConnected(), false);
});

test("the repository root contains the complete static site with no build or public folder", () => {
  const output = root;
  const files = [".nojekyll", "404.html", "activate.html", "index.html", ...fs.readdirSync(path.join(root, "assets"), { recursive: true }).filter((file) => fs.statSync(path.join(root, "assets", file)).isFile()).map((file) => path.join("assets", file))];
  assert.deepEqual(files.filter((file) => file.endsWith(".html")).sort(), ["404.html", "activate.html", "index.html"]);
  for (const file of files) {
    assert.ok(file === ".nojekyll" || file.endsWith(".html") || file.startsWith(`assets${path.sep}`));
    if (!/\.(js|html|css)$/.test(file)) continue;
    const source = fs.readFileSync(path.join(output, file), "utf8");
    assert.doesNotMatch(source, /\.netlify\/functions|stripe|sendBeacon|support\.html|admin\.html|pay\.html|trial\.html|feedback\.html|account-menu|access.code|weeklyUsage/i);
    if (file.endsWith(".html")) for (const match of source.matchAll(/<(?:link|script|img|a)\b[^>]*(?:src|href)="([^"?#]+)(?:[^\"]*)"/g)) {
      const ref = match[1];
      if (/^https?:/.test(ref)) continue;
      const local = path.join(output, ref === "/" ? "index.html" : ref.replace(/^\//, ""));
      assert.ok(fs.existsSync(local), `Missing page asset: ${ref}`);
    }
  }
  assert.ok(!fs.existsSync(path.join(root, "netlify/functions")));
  assert.ok(!fs.existsSync(path.join(root, "production/netlify/functions")));
  assert.ok(!fs.existsSync(path.join(root, "netlify.toml")));
  assert.ok(!fs.existsSync(path.join(root, "production/netlify.toml")));
  assert.ok(fs.existsSync(path.join(output, ".nojekyll")));
  assert.ok(!fs.existsSync(path.join(root, "public")));
  assert.ok(!fs.existsSync(path.join(root, "production/public")));
  assert.ok(!fs.existsSync(path.join(root, "scripts/build.js")));
  assert.equal(Object.keys(require("../package.json").dependencies || {}).length, 0);
});

test("static preview serves pages and data, and rejects removed endpoints and private paths", async () => {
  const server = createServer({ basePath: "/" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const url of ["/", "/activate.html", "/assets/site.css", "/assets/data/catalog.json"]) assert.equal((await fetch(base + url)).status, 200);
    for (const url of ["/admin.html", "/support.html", "/pay.html", "/.netlify/functions/login", "/.retired/previous-app/netlify/data/access-config.json", "/preview/.env.local", "/package.json", "/%2e%2e%5cpackage.json", "/absent/nested/page"]) {
      const response = await fetch(base + url);
      assert.equal(response.status, 404, url);
      assert.match(await response.text(), /Page not found/);
    }
    assert.equal((await fetch(base + "/activate.html", { method: "POST" })).status, 405);
    assert.equal((await fetch(base + "/%E0%A4%A")).status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("GitHub Pages base paths cover root, repository and nested 404 URLs", () => {
  const template = fs.readFileSync(path.join(root, "404.html"), "utf8");
  for (const [input, expected] of [["", "/"], ["/", "/"], ["cwash", "/cwash/"], ["/cwash/", "/cwash/"]]) {
    assert.equal(normalizeBasePath(input), expected);
    const rendered = renderNotFound(template, input);
    assert.ok(rendered.includes(`<base href="${expected}">`));
    const baseUrl = new URL(expected, "https://example.github.io/repo/missing/deep/page");
    assert.equal(new URL("index.html?change=1", baseUrl).pathname, `${expected}index.html`);
  }
  for (const invalid of ["/../", "/repo/./", "https://example.com", '/repo?x=1', '/repo\"/']) {
    assert.throws(() => normalizeBasePath(invalid));
  }
  const inlineScript = template.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [hostname, expected] of [["cwash0.github.io", "/cwash/"], ["circuitwash.com", "/"], ["127.0.0.1", "/"]]) {
    const baseElement = { href: "/" };
    vm.runInNewContext(inlineScript, { location: { hostname }, document: { querySelector: () => baseElement } });
    assert.equal(baseElement.href, expected);
  }
});

test("search, site JSON, navigation and nested 404 recovery work under a Pages repository path", async () => {
  const prefix = "/cwash/";
  const server = createServer({ basePath: prefix });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = new URL(prefix, origin);
  try {
    const redirect = await fetch(origin + "/cwash?change=1", { redirect: "manual" });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get("location"), "/cwash/?change=1");
    for (const page of ["index.html", "activate.html"]) {
      const response = await fetch(new URL(page, base));
      assert.equal(response.status, 200);
      const html = await response.text();
      for (const match of html.matchAll(/<(?:link|script|img|a)\b[^>]*(?:src|href)="([^\"]+)"/g)) {
        if (/^https?:/.test(match[1])) continue;
        const url = new URL(match[1], new URL(page, base));
        assert.ok(url.pathname.startsWith(prefix), `Link escapes the project: ${url}`);
        assert.equal((await fetch(url)).status, 200);
      }
    }

    const requested = [];
    const browser = { localStorage: storage() };
    vm.runInNewContext(fs.readFileSync(path.join(root, "assets/site-data.js"), "utf8"), {
      window: browser,
      document: { currentScript: { src: new URL("assets/site-data.js", base).href } },
      URL,
      fetch: (url) => { requested.push(url.href); return fetch(url); }
    });
    const store = browser.CircuitWash;
    const sites = await store.loadCatalog();
    const matches = store.search(sites, "BS16 1ZH");
    assert.ok(matches.some((site) => site.id === "wallscourt_phase_2"));
    const site = await store.loadSite("wallscourt_phase_2");
    assert.ok(site.machines.some((machine) => machine.type === "washer"));
    assert.ok(requested.every((url) => new URL(url).pathname.startsWith(`${prefix}assets/data/`)));
    const activation = new URL(store.activationUrl(site.id), base);
    assert.equal(activation.pathname, "/cwash/activate.html");
    assert.equal((await fetch(activation)).status, 200);
    store.rememberSite(site.id);
    assert.equal(store.savedSiteId(), site.id);
    assert.equal(new URL("index.html?change=1", activation).pathname, "/cwash/index.html");

    const missing = await fetch(new URL("missing/deep/page", base));
    assert.equal(missing.status, 404);
    const notFound = await missing.text();
    const pageBase = new URL(notFound.match(/<base href="([^\"]+)">/)[1], base);
    assert.equal((await fetch(new URL("assets/site.css", pageBase))).status, 200);
    assert.equal((await fetch(new URL("index.html?change=1", pageBase))).status, 200);
    assert.equal((await fetch(origin + "/assets/data/catalog.json")).status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
