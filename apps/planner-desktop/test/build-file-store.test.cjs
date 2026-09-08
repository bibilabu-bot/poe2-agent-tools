const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  BUILD_FILE_ERROR_CODES,
  MAX_BUILD_FILE_BYTES,
  BuildFileError,
  createBuildFileStore,
  createBuildIpcHandlers,
  normalizeBuildSaveRequest,
} = require("../electron/build-file-store.cjs");

async function withTempDirectory(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "poe2-build-store-test-"));
  try {
    return await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function buildText() {
  return `${JSON.stringify({
    format: "poe2-agent-tools-build",
    schemaVersion: 1,
    build: {},
  }, null, 2)}\n`;
}

test("readBuildText returns UTF-8 text and rejects an oversized file", async () => {
  await withTempDirectory(async (directory) => {
    const store = createBuildFileStore();
    const validPath = path.join(directory, "valid.json");
    const oversizedPath = path.join(directory, "oversized.json");
    await fs.writeFile(validPath, buildText(), "utf8");
    await fs.writeFile(oversizedPath, Buffer.alloc(MAX_BUILD_FILE_BYTES + 1, 0x78));

    assert.equal(await store.readBuildText(validPath), buildText());
    await assert.rejects(
      store.readBuildText(oversizedPath),
      ({ code }) => code === BUILD_FILE_ERROR_CODES.FILE_TOO_LARGE,
    );
  });
});

test("readBuildText maps injected read failures to a stable code", async () => {
  const store = createBuildFileStore({
    operations: {
      open: async () => {
        throw new Error("sensitive read failure");
      },
    },
  });

  await assert.rejects(
    store.readBuildText("unused.json"),
    ({ code, message }) => code === BUILD_FILE_ERROR_CODES.READ_FAILED
      && !message.includes("sensitive"),
  );
});

test("readBuildText rejects invalid UTF-8 without returning replacement text", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "invalid-utf8.json");
    await fs.writeFile(filePath, Buffer.from([0xff, 0xfe, 0xfd]));

    await assert.rejects(
      createBuildFileStore().readBuildText(filePath),
      ({ code }) => code === BUILD_FILE_ERROR_CODES.READ_FAILED,
    );
  });
});

test("normalizeBuildSaveRequest accepts only bounded text and adds a newline", () => {
  assert.deepEqual(normalizeBuildSaveRequest({ text: "{}", suggestedName: "my build" }), {
    text: "{}\n",
    suggestedName: "my build",
    bytes: 3,
  });

  for (const request of [null, {}, { text: 42 }, { text: "", path: "arbitrary.json" }, { text: "{}", extra: true }]) {
    assert.throws(
      () => normalizeBuildSaveRequest(request),
      ({ code }) => code === BUILD_FILE_ERROR_CODES.INVALID_REQUEST,
    );
  }

  assert.throws(
    () => normalizeBuildSaveRequest({ text: "x".repeat(MAX_BUILD_FILE_BYTES) }),
    ({ code }) => code === BUILD_FILE_ERROR_CODES.FILE_TOO_LARGE,
  );
});

test("writeBuildText syncs a unique sibling and replaces an existing Windows target", async () => {
  await withTempDirectory(async (directory) => {
    const targetPath = path.join(directory, "build.json");
    const openedPaths = [];
    await fs.writeFile(targetPath, "old-build\n", "utf8");
    const store = createBuildFileStore({
      randomId: () => "fixed-unique-id",
      operations: {
        open: async (...arguments_) => {
          openedPaths.push(arguments_[0]);
          return fs.open(...arguments_);
        },
      },
    });

    const result = await store.writeBuildText(targetPath, { text: "new-build" });

    assert.equal(result.bytes, Buffer.byteLength("new-build\n"));
    assert.equal(await fs.readFile(targetPath, "utf8"), "new-build\n");
    assert.equal(path.dirname(openedPaths[0]), directory);
    assert.match(path.basename(openedPaths[0]), /^\.build\.json\..+\.tmp$/);
    assert.deepEqual(await fs.readdir(directory), ["build.json"]);
  });
});

test("an injected write failure preserves the existing destination and cleans the temp file", async () => {
  await withTempDirectory(async (directory) => {
    const targetPath = path.join(directory, "build.json");
    await fs.writeFile(targetPath, "old-build\n", "utf8");
    const store = createBuildFileStore({
      randomId: () => "write-failure",
      operations: {
        open: async (...arguments_) => {
          const handle = await fs.open(...arguments_);
          return {
            writeFile: async () => { throw new Error("injected write failure"); },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      },
    });

    await assert.rejects(
      store.writeBuildText(targetPath, { text: "new-build" }),
      ({ code }) => code === BUILD_FILE_ERROR_CODES.WRITE_FAILED,
    );
    assert.equal(await fs.readFile(targetPath, "utf8"), "old-build\n");
    assert.deepEqual(await fs.readdir(directory), ["build.json"]);
  });
});

test("an injected sync failure preserves the existing destination and cleans the temp file", async () => {
  await withTempDirectory(async (directory) => {
    const targetPath = path.join(directory, "build.json");
    await fs.writeFile(targetPath, "old-build\n", "utf8");
    const store = createBuildFileStore({
      randomId: () => "sync-failure",
      operations: {
        open: async (...arguments_) => {
          const handle = await fs.open(...arguments_);
          return {
            writeFile: (...writeArguments) => handle.writeFile(...writeArguments),
            sync: async () => { throw new Error("injected sync failure"); },
            close: () => handle.close(),
          };
        },
      },
    });

    await assert.rejects(
      store.writeBuildText(targetPath, { text: "new-build" }),
      ({ code }) => code === BUILD_FILE_ERROR_CODES.WRITE_FAILED,
    );
    assert.equal(await fs.readFile(targetPath, "utf8"), "old-build\n");
    assert.deepEqual(await fs.readdir(directory), ["build.json"]);
  });
});

test("an injected replace failure preserves the existing destination and cleans the temp file", async () => {
  await withTempDirectory(async (directory) => {
    const targetPath = path.join(directory, "build.json");
    await fs.writeFile(targetPath, "old-build\n", "utf8");
    const store = createBuildFileStore({
      randomId: () => "replace-failure",
      operations: {
        rename: async () => { throw new Error("injected replace failure"); },
      },
    });

    await assert.rejects(
      store.writeBuildText(targetPath, { text: "new-build" }),
      ({ code }) => code === BUILD_FILE_ERROR_CODES.REPLACE_FAILED,
    );
    assert.equal(await fs.readFile(targetPath, "utf8"), "old-build\n");
    assert.deepEqual(await fs.readdir(directory), ["build.json"]);
  });
});

test("IPC handlers return text and stable cancellation or failure results without stacks", async () => {
  const content = buildText();
  let savedRequest = null;
  const store = {
    readBuildText: async () => content,
    writeBuildText: async (_filePath, request) => {
      savedRequest = request;
      return { bytes: Buffer.byteLength(content) };
    },
  };
  const dialogs = {
    showOpenDialog: async () => ({ canceled: false, filePaths: ["selected.json"] }),
    showSaveDialog: async () => ({ canceled: false, filePath: "selected.json" }),
  };
  const handlers = createBuildIpcHandlers({
    dialogs,
    ensureBuildDir: async () => "builds",
    store,
  });

  assert.deepEqual(await handlers.open(), {
    ok: true,
    canceled: false,
    filePath: "selected.json",
    text: content,
  });
  assert.deepEqual(await handlers.save(null, { text: content }), {
    ok: true,
    canceled: false,
    filePath: "selected.json",
  });
  assert.deepEqual(savedRequest, { text: content, suggestedName: undefined });

  dialogs.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  dialogs.showSaveDialog = async () => ({ canceled: true });
  assert.equal((await handlers.open()).error.code, BUILD_FILE_ERROR_CODES.CANCELED);
  assert.equal((await handlers.save(null, { text: content })).error.code, BUILD_FILE_ERROR_CODES.CANCELED);

  dialogs.showOpenDialog = async () => ({ canceled: false, filePaths: ["selected.json"] });
  store.readBuildText = async () => { throw new Error("secret stack content"); };
  const failed = await handlers.open();
  assert.equal(failed.error.code, BUILD_FILE_ERROR_CODES.READ_FAILED);
  assert.equal(Object.hasOwn(failed.error, "stack"), false);
  assert.equal(JSON.stringify(failed).includes("secret stack content"), false);

  store.readBuildText = async () => {
    throw new BuildFileError(BUILD_FILE_ERROR_CODES.FILE_TOO_LARGE, "Build file exceeds the 5 MiB limit.");
  };
  assert.equal((await handlers.open()).error.code, BUILD_FILE_ERROR_CODES.FILE_TOO_LARGE);

  dialogs.showSaveDialog = async () => ({ canceled: false, filePath: "selected.json" });
  store.writeBuildText = async () => {
    throw new BuildFileError(BUILD_FILE_ERROR_CODES.REPLACE_FAILED, "Safe replacement failed.");
  };
  const replaceFailed = await handlers.save(null, { text: content });
  assert.equal(replaceFailed.error.code, BUILD_FILE_ERROR_CODES.REPLACE_FAILED);
  assert.equal(Object.hasOwn(replaceFailed.error, "stack"), false);
});

test("save IPC rejects malformed and oversized requests before showing a dialog", async () => {
  let dialogCalls = 0;
  const handlers = createBuildIpcHandlers({
    dialogs: {
      showOpenDialog: async () => ({ canceled: true }),
      showSaveDialog: async () => {
        dialogCalls += 1;
        return { canceled: true };
      },
    },
    ensureBuildDir: async () => "builds",
    store: createBuildFileStore(),
  });

  const malformed = await handlers.save(null, { data: {} });
  const oversized = await handlers.save(null, { text: "x".repeat(MAX_BUILD_FILE_BYTES) });

  assert.equal(malformed.error.code, BUILD_FILE_ERROR_CODES.INVALID_REQUEST);
  assert.equal(oversized.error.code, BUILD_FILE_ERROR_CODES.FILE_TOO_LARGE);
  assert.equal(dialogCalls, 0);
});
