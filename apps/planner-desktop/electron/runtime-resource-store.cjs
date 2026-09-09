const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const RESOURCE_ERROR_CODES = Object.freeze({
  NOT_FOUND: "RESOURCE_NOT_FOUND",
  NETWORK_UNAVAILABLE: "NETWORK_UNAVAILABLE",
  INTEGRITY_FAILED: "INTEGRITY_FAILED",
  CACHE_WRITE_FAILED: "CACHE_WRITE_FAILED",
});

class RuntimeResourceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "RuntimeResourceError";
    this.code = code;
  }
}

function publicRuntimeResourceFailure(error) {
  const knownCodes = new Set(Object.values(RESOURCE_ERROR_CODES));
  const code = error instanceof RuntimeResourceError && knownCodes.has(error.code)
    ? error.code
    : RESOURCE_ERROR_CODES.NETWORK_UNAVAILABLE;
  const messages = {
    [RESOURCE_ERROR_CODES.NOT_FOUND]: "Runtime resource is not available.",
    [RESOURCE_ERROR_CODES.NETWORK_UNAVAILABLE]: "Pinned resource is currently unavailable.",
    [RESOURCE_ERROR_CODES.INTEGRITY_FAILED]: "Downloaded resource failed canonical integrity verification.",
    [RESOURCE_ERROR_CODES.CACHE_WRITE_FAILED]: "Verified resource could not be stored safely.",
  };
  return Object.freeze({ code, message: messages[code] });
}

function validateDescriptor(source, kind, name) {
  if (!source || source.status !== "active" || !source.consumers?.includes("planner-runtime")) {
    throw new RuntimeResourceError(RESOURCE_ERROR_CODES.NOT_FOUND, "Runtime resource is not active in the canonical lock.");
  }
  if (source.origin?.type !== "github"
    || !/^[0-9a-f]{40}$/.test(source.origin.revision || "")
    || !source.transport?.url?.includes(source.origin.revision)
    || source.integrity?.algorithm !== "sha256"
    || !/^[0-9a-f]{64}$/.test(source.integrity.sha256 || "")
    || !Number.isSafeInteger(source.integrity.bytes)
    || source.integrity.bytes <= 0) {
    throw new RuntimeResourceError(RESOURCE_ERROR_CODES.INTEGRITY_FAILED, "Runtime lock metadata is invalid.");
  }
  return Object.freeze({
    id: source.id,
    kind,
    name,
    url: source.transport.url,
    bytes: source.integrity.bytes,
    sha256: source.integrity.sha256,
  });
}

function createRuntimeResourceCatalog(lock, manifest) {
  if (lock?.schemaVersion !== 1 || !Array.isArray(lock.sources) || !Array.isArray(manifest?.core)) {
    throw new RuntimeResourceError(RESOURCE_ERROR_CODES.INTEGRITY_FAILED, "Runtime source configuration is invalid.");
  }
  const byId = new Map(lock.sources.map(source => [source.id, source]));
  const core = new Map();
  for (const item of manifest.core) {
    if (typeof item?.name !== "string" || typeof item?.lockId !== "string" || path.basename(item.name) !== item.name) {
      throw new RuntimeResourceError(RESOURCE_ERROR_CODES.INTEGRITY_FAILED, "Runtime cache manifest is invalid.");
    }
    core.set(item.name, validateDescriptor(byId.get(item.lockId), "data", item.name));
  }

  const portraits = new Map();
  for (const source of lock.sources) {
    if (!source.id?.startsWith("runtime.drydream.portrait-")) continue;
    const name = path.posix.basename(source.origin?.path || "");
    if (!/^background-[a-z0-9-]+\.webp$/.test(name)) continue;
    portraits.set(name, validateDescriptor(source, "portrait", name));
  }

  return Object.freeze({
    coreNames: Object.freeze([...core.keys()]),
    portraitNames: Object.freeze([...portraits.keys()]),
    resolve(kind, name) {
      if (typeof name !== "string" || path.basename(name) !== name) return null;
      if (kind === "data") return core.get(name) || null;
      if (kind === "portrait") return portraits.get(name) || null;
      return null;
    },
  });
}

function createRuntimeResourceStore(dependencies = {}) {
  const operations = {
    mkdir: (...arguments_) => fs.mkdir(...arguments_),
    open: (...arguments_) => fs.open(...arguments_),
    readFile: (...arguments_) => fs.readFile(...arguments_),
    rename: (...arguments_) => fs.rename(...arguments_),
    stat: (...arguments_) => fs.stat(...arguments_),
    unlink: (...arguments_) => fs.unlink(...arguments_),
    ...dependencies.operations,
  };
  const fetchResource = dependencies.fetchResource;
  const randomId = dependencies.randomId || (() => crypto.randomUUID());

  function verifyBytes(bytes, descriptor) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (buffer.length !== descriptor.bytes) {
      throw new RuntimeResourceError(RESOURCE_ERROR_CODES.INTEGRITY_FAILED, "Resource byte count does not match the canonical lock.");
    }
    const actual = crypto.createHash("sha256").update(buffer).digest("hex");
    if (actual !== descriptor.sha256) {
      throw new RuntimeResourceError(RESOURCE_ERROR_CODES.INTEGRITY_FAILED, "Resource SHA-256 does not match the canonical lock.");
    }
    return buffer;
  }

  async function readVerifiedFile(filePath, descriptor) {
    try {
      const stats = await operations.stat(filePath);
      if (stats.size !== descriptor.bytes) return null;
      return verifyBytes(await operations.readFile(filePath), descriptor);
    } catch (error) {
      if (error instanceof RuntimeResourceError) return null;
      return null;
    }
  }

  async function resolveVerifiedLocal(descriptor, bundledPath, cachePath) {
    const bundledBytes = await readVerifiedFile(bundledPath, descriptor);
    if (bundledBytes) return { source: "bundled", bytes: bundledBytes };
    const cachedBytes = await readVerifiedFile(cachePath, descriptor);
    if (cachedBytes) return { source: "cache", bytes: cachedBytes };
    return null;
  }

  async function removeTemporaryFile(temporaryPath) {
    try {
      await operations.unlink(temporaryPath);
    } catch {
      // Best-effort cleanup; preserve the primary write or replacement failure.
    }
  }

  async function writeVerifiedCache(cachePath, descriptor, bytes) {
    const verified = verifyBytes(bytes, descriptor);
    const temporaryPath = path.join(
      path.dirname(cachePath),
      `.${path.basename(cachePath)}.${process.pid}.${randomId()}.tmp`,
    );
    let handle;
    let temporaryCreated = false;
    try {
      await operations.mkdir(path.dirname(cachePath), { recursive: true });
      handle = await operations.open(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      await handle.writeFile(verified);
      await handle.sync();
      await handle.close();
      handle = null;
      await operations.rename(temporaryPath, cachePath);
      temporaryCreated = false;
      return verified;
    } catch (error) {
      if (handle) {
        try { await handle.close(); } catch {}
      }
      if (temporaryCreated) await removeTemporaryFile(temporaryPath);
      if (error instanceof RuntimeResourceError) throw error;
      throw new RuntimeResourceError(
        RESOURCE_ERROR_CODES.CACHE_WRITE_FAILED,
        "Verified resource could not be stored safely.",
        { cause: error },
      );
    }
  }

  async function readDownloadedBytes(response, descriptor) {
    if (!response?.ok) {
      throw new RuntimeResourceError(RESOURCE_ERROR_CODES.NETWORK_UNAVAILABLE, "Pinned resource is unavailable from its transport.");
    }
    try {
      const bytes = Buffer.from(await response.arrayBuffer());
      return verifyBytes(bytes, descriptor);
    } catch (error) {
      if (error instanceof RuntimeResourceError) throw error;
      throw new RuntimeResourceError(RESOURCE_ERROR_CODES.NETWORK_UNAVAILABLE, "Pinned resource download could not be completed.", { cause: error });
    }
  }

  async function downloadAndCache(descriptor, cachePath) {
    if (typeof fetchResource !== "function") {
      throw new RuntimeResourceError(RESOURCE_ERROR_CODES.NETWORK_UNAVAILABLE, "Pinned resource transport is unavailable.");
    }
    let response;
    try {
      response = await fetchResource(descriptor.url);
    } catch (error) {
      throw new RuntimeResourceError(RESOURCE_ERROR_CODES.NETWORK_UNAVAILABLE, "Pinned resource download could not be started.", { cause: error });
    }
    const bytes = await readDownloadedBytes(response, descriptor);
    return writeVerifiedCache(cachePath, descriptor, bytes);
  }

  return Object.freeze({ downloadAndCache, readVerifiedFile, resolveVerifiedLocal, verifyBytes, writeVerifiedCache });
}

module.exports = Object.freeze({
  RESOURCE_ERROR_CODES,
  RuntimeResourceError,
  createRuntimeResourceCatalog,
  createRuntimeResourceStore,
  publicRuntimeResourceFailure,
});
