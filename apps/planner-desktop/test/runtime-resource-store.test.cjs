const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const lock = require("../../../data/upstream-sources.lock.json");
const manifest = require("../data/cache/manifest.json");
const {
  RESOURCE_ERROR_CODES,
  RuntimeResourceError,
  createRuntimeResourceCatalog,
  createRuntimeResourceStore,
  publicRuntimeResourceFailure,
} = require("../electron/runtime-resource-store.cjs");

function descriptorFor(bytes, overrides = {}) {
  return {
    id: "test.resource",
    kind: "data",
    name: "resource.json",
    url: "https://example.invalid/immutable/resource.json",
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    ...overrides,
  };
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "poe2-runtime-resource-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("runtime catalog resolves core resources to immutable lock URLs", () => {
  const catalog = createRuntimeResourceCatalog(lock, manifest);
  assert.equal(catalog.coreNames.length, 8);
  for (const name of catalog.coreNames) {
    const source = catalog.resolve("data", name);
    assert.match(source.url, /\/[0-9a-f]{40}\//);
    assert.doesNotMatch(source.url, /\/(?:main|dev)\//);
    assert.ok(source.bytes > 0);
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
  }
});

test("runtime catalog resolves exactly the eight current class portraits", () => {
  const catalog = createRuntimeResourceCatalog(lock, manifest);
  assert.deepEqual([...catalog.portraitNames].sort(), [
    "background-druid.webp",
    "background-huntress.webp",
    "background-mercenary.webp",
    "background-monk.webp",
    "background-ranger.webp",
    "background-sorceress.webp",
    "background-warrior.webp",
    "background-witch.webp",
  ]);
  for (const name of catalog.portraitNames) assert.equal(catalog.resolve("portrait", name).kind, "portrait");
  assert.equal(catalog.resolve("portrait", "background-unknown.webp"), null);
});

test("public errors distinguish network and integrity failures without leaking details", () => {
  const network = publicRuntimeResourceFailure(new Error("C:\\private\\cache\\secret.json"));
  const integrity = publicRuntimeResourceFailure(new RuntimeResourceError(
    RESOURCE_ERROR_CODES.INTEGRITY_FAILED,
    "bad hash at C:\\private\\cache\\secret.json",
  ));
  assert.equal(network.code, RESOURCE_ERROR_CODES.NETWORK_UNAVAILABLE);
  assert.equal(integrity.code, RESOURCE_ERROR_CODES.INTEGRITY_FAILED);
  assert.doesNotMatch(JSON.stringify([network, integrity]), /private|secret|stack/i);
});

test("a valid cache is reused without a network request", async (t) => {
  const directory = await temporaryDirectory(t);
  const bytes = Buffer.from("approved cache");
  const descriptor = descriptorFor(bytes);
  const cached = path.join(directory, "cache", descriptor.name);
  await fs.mkdir(path.dirname(cached), { recursive: true });
  await fs.writeFile(cached, bytes);
  let fetches = 0;
  const store = createRuntimeResourceStore({ fetchResource: async () => { fetches += 1; } });

  const found = await store.resolveVerifiedLocal(descriptor, path.join(directory, "missing"), cached);
  assert.equal(found.source, "cache");
  assert.deepEqual(found.bytes, bytes);
  assert.equal(fetches, 0);
});

test("stale or corrupt cache bytes are rejected", async (t) => {
  const directory = await temporaryDirectory(t);
  const approved = Buffer.from("approved cache");
  const cached = path.join(directory, "resource.json");
  await fs.writeFile(cached, Buffer.from("stale cache!"));
  const store = createRuntimeResourceStore();

  assert.equal(await store.readVerifiedFile(cached, descriptorFor(approved)), null);
});

test("a bundled file is preferred only when it matches the lock", async (t) => {
  const directory = await temporaryDirectory(t);
  const approved = Buffer.from("approved resource");
  const descriptor = descriptorFor(approved);
  const bundled = path.join(directory, "bundled.json");
  const cached = path.join(directory, "cached.json");
  await fs.writeFile(bundled, approved);
  await fs.writeFile(cached, approved);
  const store = createRuntimeResourceStore();
  assert.equal((await store.resolveVerifiedLocal(descriptor, bundled, cached)).source, "bundled");

  await fs.writeFile(bundled, Buffer.from("invalid bundled"));
  assert.equal((await store.resolveVerifiedLocal(descriptor, bundled, cached)).source, "cache");
});

test("a download with the wrong byte count is rejected before cache replacement", async (t) => {
  const directory = await temporaryDirectory(t);
  const approved = Buffer.from("approved resource");
  const old = Buffer.from("old cache remains");
  const target = path.join(directory, "resource.json");
  await fs.writeFile(target, old);
  const store = createRuntimeResourceStore({
    fetchResource: async () => ({ ok: true, arrayBuffer: async () => Buffer.from("short") }),
  });

  await assert.rejects(
    store.downloadAndCache(descriptorFor(approved), target),
    error => error.code === RESOURCE_ERROR_CODES.INTEGRITY_FAILED,
  );
  assert.deepEqual(await fs.readFile(target), old);
});

test("a same-size download with the wrong SHA-256 is rejected", async (t) => {
  const directory = await temporaryDirectory(t);
  const approved = Buffer.from("approved resource");
  const wrong = Buffer.from("corrupt! resource");
  assert.equal(wrong.length, approved.length);
  const target = path.join(directory, "resource.json");
  const old = Buffer.from("old cache remains");
  await fs.writeFile(target, old);
  const store = createRuntimeResourceStore({
    fetchResource: async () => ({ ok: true, arrayBuffer: async () => wrong }),
  });

  await assert.rejects(
    store.downloadAndCache(descriptorFor(approved), target),
    error => error.code === RESOURCE_ERROR_CODES.INTEGRITY_FAILED,
  );
  assert.deepEqual(await fs.readFile(target), old);
});

test("network failure has a distinct code and preserves the old cache", async (t) => {
  const directory = await temporaryDirectory(t);
  const target = path.join(directory, "resource.json");
  const old = Buffer.from("old cache remains");
  await fs.writeFile(target, old);
  const store = createRuntimeResourceStore({ fetchResource: async () => { throw new Error("offline"); } });

  await assert.rejects(
    store.downloadAndCache(descriptorFor(Buffer.from("new approved bytes")), target),
    error => error.code === RESOURCE_ERROR_CODES.NETWORK_UNAVAILABLE,
  );
  assert.deepEqual(await fs.readFile(target), old);
});

test("replacement failure preserves the old cache and cleans the candidate", async (t) => {
  const directory = await temporaryDirectory(t);
  const target = path.join(directory, "resource.json");
  const approved = Buffer.from("new approved bytes");
  const old = Buffer.from("old cache remains");
  await fs.writeFile(target, old);
  const store = createRuntimeResourceStore({
    fetchResource: async () => ({ ok: true, arrayBuffer: async () => approved }),
    operations: { rename: async () => { throw new Error("replace failed"); } },
    randomId: () => "replacement-failure",
  });

  await assert.rejects(
    store.downloadAndCache(descriptorFor(approved), target),
    error => error.code === RESOURCE_ERROR_CODES.CACHE_WRITE_FAILED,
  );
  assert.deepEqual(await fs.readFile(target), old);
  assert.deepEqual(await fs.readdir(directory), ["resource.json"]);
});

test("verified downloads replace cache through a unique sibling file", async (t) => {
  const directory = await temporaryDirectory(t);
  const target = path.join(directory, "resource.json");
  const approved = Buffer.from("new approved bytes");
  await fs.writeFile(target, Buffer.from("old cache remains"));
  const store = createRuntimeResourceStore({
    fetchResource: async url => {
      assert.equal(url, descriptorFor(approved).url);
      return { ok: true, arrayBuffer: async () => approved };
    },
    randomId: () => "successful-replacement",
  });

  assert.deepEqual(await store.downloadAndCache(descriptorFor(approved), target), approved);
  assert.deepEqual(await fs.readFile(target), approved);
  assert.deepEqual(await fs.readdir(directory), ["resource.json"]);
});
