"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AgentCredentialStore } = require("../electron/agent-credential-store.cjs");

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
};

test("credential store persists only encrypted key material and restores it", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "p2at-credentials-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new AgentCredentialStore({ userDataPath: directory, safeStorage });
  await store.save({ baseUrl: "https://example.com/v1", apiKey: "plain-secret" });
  const disk = await fs.readFile(store.filePath, "utf8");
  assert.ok(!disk.includes("plain-secret"));
  assert.deepEqual(await store.load(), { baseUrl: "https://example.com/v1", apiKey: "plain-secret" });
  await store.clear();
  assert.equal(await store.load(), null);
});

test("credential store refuses plaintext fallback when encryption is unavailable", async () => {
  const store = new AgentCredentialStore({ userDataPath: os.tmpdir(), safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(() => store.save({ baseUrl: "https://example.com/v1", apiKey: "secret" }), { code: "SECURE_STORAGE_UNAVAILABLE" });
});

test("credential store refuses Electron's weak basic_text backend", async () => {
  const store = new AgentCredentialStore({ userDataPath: os.tmpdir(), safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" } });
  await assert.rejects(() => store.save({ baseUrl: "https://example.com/v1", apiKey: "secret" }), { code: "SECURE_STORAGE_UNAVAILABLE" });
});
