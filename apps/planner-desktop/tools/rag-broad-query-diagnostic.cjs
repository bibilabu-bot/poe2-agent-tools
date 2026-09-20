"use strict";

// One explicitly opted-in paid run against a synthetic conversation. It prints
// timings and public tool names only; credentials and model text never leave the
// trusted Electron/Python boundary.
const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AgentCredentialStore } = require("../electron/agent-credential-store.cjs");
const { createRetrievalSettings } = require("../electron/retrieval-settings.cjs");
const { PythonAgentClient } = require("../electron/python-agent-client.cjs");
const { AgentService } = require("../electron/agent-service.cjs");
const { passiveCorpusIdentity } = require("../electron/passive-corpus.cjs");
const lock = require("../../../data/upstream-sources.lock.json");
const candidates = require("../data/localization-candidates.json");

app.setPath("userData", path.join(app.getPath("appData"), "poe2-planner-desktop"));
app.whenReady().then(async () => {
  if (process.env.P2AT_RAG_DIAG !== "1") throw new Error("Explicit P2AT_RAG_DIAG=1 required for one paid diagnostic run");
  const userData = app.getPath("userData");
  const [profiles, chat] = await Promise.all([
    createRetrievalSettings({ userDataPath: userData, safeStorage, isTrustedSender: () => false }).profiles(),
    new AgentCredentialStore({ userDataPath: userData, safeStorage }).load(),
  ]);
  if (!profiles || !chat) throw new Error("Saved chat, embedding and reranker profiles are required");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "p2at-rag-diag-"));
  const client = new PythonAgentClient({ memoryPath: path.join(temp, "memory.sqlite3") });
  const agent = new AgentService({ client });
  const config = { path: path.join(userData, "passive-rag.sqlite3"), profiles,
    sourceVersion: passiveCorpusIdentity(lock, candidates) };
  agent.ragConfiguration = async () => config;
  const started = performance.now();
  const timeline = [];
  try {
    await agent.configure(chat);
    const reply = await agent.send({ model: process.env.P2AT_RAG_CHAT_MODEL || "kimi-k3",
      text: "你能查询流放之路2的天赋树吗", toolsEnabled: true }, event => {
      timeline.push({ ms: Math.round(performance.now() - started), type: event.type,
        phase: event.phase, tool: event.name, ok: event.ok,
        textChars: typeof event.text === "string" ? event.text.length : undefined });
    });
    console.log("RAG_BROAD_DIAGNOSTIC " + JSON.stringify({ elapsedMs: Math.round(performance.now() - started),
      ok: reply.ok, error: reply.error || null, timeline,
      tools: (reply.trace || []).map(row => ({ name: row.name, ok: row.ok, durationMs: row.durationMs })) }));
    if (!reply.ok) process.exitCode = 1;
  } finally {
    client.terminate();
  }
}).then(() => app.exit(process.exitCode || 0), error => {
  console.error("RAG_BROAD_DIAGNOSTIC_FAILED " + JSON.stringify({ code: error.code || "DIAGNOSTIC_FAILED", message: error.message }));
  app.exit(1);
});
