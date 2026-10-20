const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const { validateManifest, verifyFiles, readBuildFile, buildFilename } = require('../renderer/browser-platform.js');
const bytes = Buffer.from('fixture only');
const descriptor = { kind: 'data', name: 'tree-pre.json', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const file = (content = bytes, name = descriptor.name) => ({ name, size: content.length, arrayBuffer: async () => Uint8Array.from(content).buffer });
test('local selection verifies bytes before creating resource mapping; optional portraits can be absent', async () => {
  const manifest = validateManifest({ resources: [descriptor, { ...descriptor, kind: 'portrait', name: 'background-warrior.webp' }] });
  const result = await verifyFiles([file()], manifest, webcrypto);
  assert.equal(result.size, 1);
  assert.equal(await result.get('poe2://data/tree-pre.json').text(), bytes.toString());
});
test('missing, duplicate, wrong-size and same-size wrong-hash resources are rejected', async () => {
  const manifest = validateManifest({ resources: [descriptor] });
  await assert.rejects(verifyFiles([], manifest, webcrypto), /缺少资源/);
  await assert.rejects(verifyFiles([file(), file()], manifest, webcrypto), /同名/);
  await assert.rejects(verifyFiles([file(Buffer.from('short'))], manifest, webcrypto), /大小/);
  await assert.rejects(verifyFiles([file(Buffer.alloc(bytes.length))], manifest, webcrypto), /哈希/);
});
test('metadata does not accept paths, duplicate identities, malformed hashes or oversized resource reads', () => {
  for (const patch of [{ name: '../tree.json' }, { sha256: 'no' }, { bytes: 100000000 }, { kind: 'remote' }]) {
    assert.throws(() => validateManifest({ resources: [{ ...descriptor, ...patch }] }));
  }
  assert.throws(() => validateManifest({ resources: [descriptor, descriptor] }), /重复/);
});
test('Build file reads enforce UTF-8 and 5 MiB before decode; filenames stay native .build', async () => {
  assert.equal(await readBuildFile(file(Buffer.from('{"test":1}'))), '{"test":1}');
  await assert.rejects(readBuildFile({ size: 5242881, arrayBuffer: () => { throw new Error('must not read'); } }), /5 MiB/);
  await assert.rejects(readBuildFile(file(Buffer.from([0xff]))));
  assert.equal(buildFilename('../Warrior.json'), '.._Warrior.build');
});
test('browser disables standalone agent switch and all hidden unsupported controls after planner enables inputs', () => {
  const { disableUnsupportedControls } = require('../renderer/browser-platform.js');
  const agent = { id: 'switchToAgent', dataset: {}, style: {}, disabled: false };
  const settings = { id: '', dataset: { page: 'settings' }, style: {}, disabled: false };
  const hiddenControl = { disabled: false };
  disableUnsupportedControls({ querySelectorAll: selector => {
    if (selector.includes('#switchToAgent')) return [agent, settings];
    return [hiddenControl];
  } });
  assert.equal(agent.disabled, true);
  assert.equal(agent.textContent, '智能体\n暂未启用');
  assert.equal(settings.disabled, true);
  assert.equal(settings.textContent, '模型设置\n暂未启用');
  assert.equal(hiddenControl.disabled, true);
});
test('missing server mapping receives actionable local instructions without echoing server details', () => {
  const { serviceErrorMessage } = require('../renderer/browser-platform.js');
  const failure = { error: { code: 'RESOURCE_NOT_FOUND', message: 'SECRET server path and token' } };
  const message = serviceErrorMessage(503, failure, '/api/wegame');
  assert.match(message, /PLANNER_OFFICIAL_TREE/);
  assert.match(message, /official-data\.json/);
  assert.match(message, /当前 Build 未改变/);
  assert.doesNotMatch(message, /SECRET/);
  for (const [status, payload, path] of [[500, failure, '/api/wegame'], [503, failure, '/api/login'], [503, { error: { code: 'UNKNOWN', message: 'SECRET' } }, '/api/wegame']]) {
    const generic = serviceErrorMessage(status, payload, path);
    assert.doesNotMatch(generic, /SECRET|PLANNER_OFFICIAL_TREE/);
  }
});
