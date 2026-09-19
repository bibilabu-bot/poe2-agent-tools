"use strict";

const { app, safeStorage } = require("electron");
const { AgentCredentialStore } = require("../electron/agent-credential-store.cjs");

app.whenReady().then(async () => {
  const userDataPath = process.env.P2AT_CREDENTIAL_SMOKE_DIR;
  const mode = process.env.P2AT_CREDENTIAL_SMOKE_MODE;
  const secret = process.env.P2AT_CREDENTIAL_SMOKE_SECRET;
  if (!userDataPath || !secret || !["write", "read", "clear"].includes(mode)) throw new Error("smoke environment is incomplete");
  const store = new AgentCredentialStore({ userDataPath, safeStorage });
  if (mode === "write") {
    await store.save({ baseUrl: "https://example.com/v1", apiKey: secret });
    process.stdout.write(JSON.stringify({ encryptionAvailable: safeStorage.isEncryptionAvailable(), saved: true }));
  } else if (mode === "read") {
    const restored = await store.load();
    process.stdout.write(JSON.stringify({ restored: restored?.apiKey === secret, baseUrl: restored?.baseUrl }));
  } else {
    await store.clear();
    process.stdout.write(JSON.stringify({ cleared: (await store.load()) === null }));
  }
  app.quit();
}).catch((error) => { process.stderr.write(`${error.code || "SMOKE_FAILED"}: ${error.message}\n`); app.exit(1); });
