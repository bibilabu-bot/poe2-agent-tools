"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");

const FILE_NAME = "agent-credentials.v1.json";

class AgentCredentialStore {
  constructor({ userDataPath, safeStorage, fileSystem = fs }) {
    this.safeStorage = safeStorage;
    this.fs = fileSystem;
    this.filePath = path.join(userDataPath, FILE_NAME);
  }

  ensureEncryption() {
    const weakBackend = this.safeStorage?.getSelectedStorageBackend?.() === "basic_text";
    if (!this.safeStorage?.isEncryptionAvailable?.() || weakBackend) {
      const error = new Error("系统安全存储暂不可用，API Key 未保存");
      error.code = "SECURE_STORAGE_UNAVAILABLE";
      throw error;
    }
  }

  async save({ baseUrl, apiKey }) {
    this.ensureEncryption();
    const encryptedKey = this.safeStorage.encryptString(apiKey).toString("base64");
    const payload = JSON.stringify({ version: 1, baseUrl, encryptedKey });
    const temporaryPath = `${this.filePath}.tmp`;
    await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.fs.writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
    await this.fs.rename(temporaryPath, this.filePath);
  }

  async load() {
    let raw;
    try { raw = await this.fs.readFile(this.filePath, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    this.ensureEncryption();
    try {
      const value = JSON.parse(raw);
      if (value?.version !== 1 || typeof value.baseUrl !== "string" || typeof value.encryptedKey !== "string") throw new Error("invalid credential payload");
      const encrypted = Buffer.from(value.encryptedKey, "base64");
      if (!encrypted.length || value.baseUrl.length > 2048 || encrypted.length > 16_384) throw new Error("invalid credential bounds");
      const apiKey = this.safeStorage.decryptString(encrypted);
      if (!apiKey || apiKey.length > 4096) throw new Error("invalid decrypted credential");
      return { baseUrl: value.baseUrl, apiKey };
    } catch (error) {
      // A different OS encryption context can fail to decrypt valid credentials.
      // Reading must never destroy the user's encrypted data.
      const failure = new Error("无法读取本地 API Key 缓存；原文件已保留，请检查安全存储或重新保存");
      failure.code = "CREDENTIAL_CACHE_INVALID";
      failure.cause = error;
      throw failure;
    }
  }

  async clear() {
    await this.fs.rm(this.filePath, { force: true });
    await this.fs.rm(`${this.filePath}.tmp`, { force: true });
  }
}

module.exports = { AgentCredentialStore, FILE_NAME };
