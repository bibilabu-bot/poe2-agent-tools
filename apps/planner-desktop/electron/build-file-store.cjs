const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const MAX_BUILD_FILE_BYTES = 5 * 1024 * 1024;
const BUILD_FILE_ERROR_CODES = Object.freeze({
  CANCELED: "CANCELED",
  INVALID_REQUEST: "INVALID_REQUEST",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  READ_FAILED: "READ_FAILED",
  WRITE_FAILED: "WRITE_FAILED",
  REPLACE_FAILED: "REPLACE_FAILED",
});

class BuildFileError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "BuildFileError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeBuildSaveRequest(request) {
  if (!isRecord(request)) {
    throw new BuildFileError(
      BUILD_FILE_ERROR_CODES.INVALID_REQUEST,
      "Save request must be an object containing serialized Build text.",
    );
  }
  const allowedKeys = new Set(["text", "suggestedName"]);
  if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
    throw new BuildFileError(
      BUILD_FILE_ERROR_CODES.INVALID_REQUEST,
      "Save request contains unsupported fields.",
    );
  }
  if (typeof request.text !== "string" || request.text.length === 0) {
    throw new BuildFileError(
      BUILD_FILE_ERROR_CODES.INVALID_REQUEST,
      "Save request text must be a non-empty string.",
    );
  }
  if (request.suggestedName !== undefined
    && (typeof request.suggestedName !== "string" || request.suggestedName.length > 128)) {
    throw new BuildFileError(
      BUILD_FILE_ERROR_CODES.INVALID_REQUEST,
      "Suggested Build name must be a string of at most 128 characters.",
    );
  }

  const text = request.text.endsWith("\n") ? request.text : `${request.text}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_BUILD_FILE_BYTES) {
    throw new BuildFileError(
      BUILD_FILE_ERROR_CODES.FILE_TOO_LARGE,
      "Serialized Build exceeds the 5 MiB limit.",
    );
  }
  return { text, suggestedName: request.suggestedName, bytes };
}

function createBuildFileStore(dependencies = {}) {
  const operations = {
    open: (...arguments_) => fs.open(...arguments_),
    rename: (...arguments_) => fs.rename(...arguments_),
    unlink: (...arguments_) => fs.unlink(...arguments_),
    ...dependencies.operations,
  };
  const randomId = dependencies.randomId || (() => crypto.randomUUID());

  async function readBuildText(filePath) {
    let handle = null;
    let text = null;
    let failure = null;
    try {
      handle = await operations.open(filePath, "r");
      const stats = await handle.stat();
      if (stats.size > MAX_BUILD_FILE_BYTES) {
        failure = new BuildFileError(
          BUILD_FILE_ERROR_CODES.FILE_TOO_LARGE,
          "Build file exceeds the 5 MiB limit.",
        );
      } else {
        const buffer = Buffer.allocUnsafe(MAX_BUILD_FILE_BYTES + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(
            buffer,
            offset,
            buffer.length - offset,
            null,
          );
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset > MAX_BUILD_FILE_BYTES) {
          failure = new BuildFileError(
            BUILD_FILE_ERROR_CODES.FILE_TOO_LARGE,
            "Build file exceeds the 5 MiB limit.",
          );
        } else {
          text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
        }
      }
    } catch (error) {
      failure = error;
    }

    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        if (!failure) failure = error;
      }
    }
    if (failure) {
      if (failure instanceof BuildFileError) throw failure;
      throw new BuildFileError(
        BUILD_FILE_ERROR_CODES.READ_FAILED,
        "The selected Build file could not be read as UTF-8 text.",
        { cause: failure },
      );
    }
    return text;
  }

  async function removeTemporaryFile(temporaryPath) {
    try {
      await operations.unlink(temporaryPath);
    } catch {
      // Best-effort cleanup: the original write/replace error remains primary.
    }
  }

  async function writeBuildText(filePath, request) {
    const normalized = normalizeBuildSaveRequest(request);
    const temporaryName = `.${path.basename(filePath)}.${process.pid}.${randomId()}.tmp`;
    const temporaryPath = path.join(path.dirname(filePath), temporaryName);
    let handle = null;
    let temporaryCreated = false;
    let failure = null;

    try {
      handle = await operations.open(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      await handle.writeFile(normalized.text, { encoding: "utf8" });
      await handle.sync();
    } catch (error) {
      failure = error;
    }

    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        if (!failure) failure = error;
      }
    }
    if (failure) {
      if (temporaryCreated) await removeTemporaryFile(temporaryPath);
      throw new BuildFileError(
        BUILD_FILE_ERROR_CODES.WRITE_FAILED,
        "Build data could not be written safely.",
        { cause: failure },
      );
    }

    try {
      await operations.rename(temporaryPath, filePath);
      temporaryCreated = false;
    } catch (error) {
      if (temporaryCreated) await removeTemporaryFile(temporaryPath);
      throw new BuildFileError(
        BUILD_FILE_ERROR_CODES.REPLACE_FAILED,
        "The destination Build file could not be replaced safely.",
        { cause: error },
      );
    }
    return { bytes: normalized.bytes };
  }

  return Object.freeze({ readBuildText, writeBuildText });
}

function cancellationResult() {
  return {
    ok: false,
    canceled: true,
    error: {
      code: BUILD_FILE_ERROR_CODES.CANCELED,
      message: "Operation canceled.",
    },
  };
}

function failureResult(error, fallbackCode, fallbackMessage) {
  const known = error instanceof BuildFileError;
  return {
    ok: false,
    canceled: false,
    error: {
      code: known ? error.code : fallbackCode,
      message: known ? error.message : fallbackMessage,
    },
  };
}

function safeDefaultName(suggestedName) {
  const base = (suggestedName || "build")
    .replace(/\.json$/i, "")
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "_")
    .replace(/^\.+/, "") || "build";
  return `${base}.json`;
}

function createBuildIpcHandlers({ dialogs, ensureBuildDir, store = createBuildFileStore() }) {
  async function save(_event, request) {
    let normalized;
    try {
      normalized = normalizeBuildSaveRequest(request);
    } catch (error) {
      return failureResult(
        error,
        BUILD_FILE_ERROR_CODES.INVALID_REQUEST,
        "Save request is invalid.",
      );
    }

    let directory;
    let selection;
    try {
      directory = await ensureBuildDir();
      selection = await dialogs.showSaveDialog({
        title: "保存 PoE2 Build",
        defaultPath: path.join(directory, safeDefaultName(normalized.suggestedName)),
        filters: [{ name: "PoE2 Build JSON", extensions: ["json"] }],
      });
    } catch (error) {
      return failureResult(
        error,
        BUILD_FILE_ERROR_CODES.WRITE_FAILED,
        "The Build save dialog could not be opened.",
      );
    }
    if (selection.canceled || !selection.filePath) return cancellationResult();

    try {
      await store.writeBuildText(selection.filePath, {
        text: normalized.text,
        suggestedName: normalized.suggestedName,
      });
      return { ok: true, canceled: false, filePath: selection.filePath };
    } catch (error) {
      return failureResult(
        error,
        BUILD_FILE_ERROR_CODES.WRITE_FAILED,
        "The Build file could not be saved.",
      );
    }
  }

  async function open() {
    let directory;
    let selection;
    try {
      directory = await ensureBuildDir();
      selection = await dialogs.showOpenDialog({
        title: "打开 PoE2 Build",
        defaultPath: directory,
        properties: ["openFile"],
        filters: [{ name: "PoE2 Build JSON", extensions: ["json"] }],
      });
    } catch (error) {
      return failureResult(
        error,
        BUILD_FILE_ERROR_CODES.READ_FAILED,
        "The Build open dialog could not be opened.",
      );
    }
    if (selection.canceled || !selection.filePaths?.[0]) return cancellationResult();

    const filePath = selection.filePaths[0];
    try {
      const text = await store.readBuildText(filePath);
      return { ok: true, canceled: false, filePath, text };
    } catch (error) {
      return failureResult(
        error,
        BUILD_FILE_ERROR_CODES.READ_FAILED,
        "The selected Build file could not be read.",
      );
    }
  }

  return Object.freeze({ save, open });
}

module.exports = Object.freeze({
  BUILD_FILE_ERROR_CODES,
  MAX_BUILD_FILE_BYTES,
  BuildFileError,
  createBuildFileStore,
  createBuildIpcHandlers,
  normalizeBuildSaveRequest,
});
