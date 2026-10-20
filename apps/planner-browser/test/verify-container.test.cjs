'use strict';
// Fake-driver tests exercise orchestration only. They are NOT Docker verification.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verify, runArguments, localEndpoint, smoke } = require('../deploy/verify-container.cjs');
const sourceNames = ['data/upstream-sources.lock.json','apps/planner-browser/server.cjs','apps/planner-browser/Dockerfile','apps/planner-browser/Dockerfile.dockerignore','apps/planner-desktop/renderer/index.html','apps/planner-desktop/src/interop/ggg-build-v1-contract.json','apps/planner-desktop/electron/runtime-resource-store.cjs','apps/planner-desktop/electron/wegame-import-service.cjs','apps/planner-desktop/data/cache/manifest.json'];
const tree = sourceNames.map(name => `100644 blob ${'c'.repeat(40)}\t${name}`).join('\n');
const sha = 'a'.repeat(40), imageId = 'sha256:' + 'b'.repeat(64);
function fixture(overrides = {}) {
  const calls = [], containers = new Map();
  let next = 1, owner;
  const command = async (program, args, options = {}) => {
    const rawArgs = [...args];
    if (program === 'docker' && args[0] === '--host') args = args.slice(2);
    calls.push({ program, args, rawArgs, options });
    if (overrides.failure?.(program, args)) throw new Error('SECRET diagnostic that must never escape');
    if (program === 'git') {
      if (args[0] === 'rev-parse') return sha;
      if (args[0] === 'ls-tree') return tree;
      if (args[0] === 'archive') return '';
      return overrides.dirty ? '?? private-file' : '';
    }
    if (args[0] === '--version') return '27.0';
    if (args[0] === 'context') return overrides.endpoint || 'unix:///var/run/docker.sock';
    if (args[0] === 'info') return 'linux';
    if (args[0] === 'build') { owner = args.find(value => value.startsWith('org.p2at.local-verification='))?.split('=')[1]; return imageId; }
    if (args[0] === 'image') return JSON.stringify([{ Id: imageId, Config: { User: 'node', Labels: { 'org.opencontainers.image.revision': sha, 'org.p2at.local-verification': owner } } }]);
    if (args[0] === 'create') {
      const id = (next++).toString(16).padStart(64, '0');
      const label = args[args.indexOf('--label') + 1].split('=')[1];
      containers.set(id, { Id: id, Image: imageId, Config: { Labels: { 'org.p2at.local-verification': label } }, State: { Status: 'created', ExitCode: 0 }, failing: args.includes('process.exit(42)'), NetworkSettings: { Ports: { '8787/tcp': [{ HostIp: overrides.hostIp || '127.0.0.1', HostPort: '45678' }] } } });
      return id;
    }
    const id = args.at(-1), container = containers.get(id);
    assert.ok(container, 'operations must address only this fixture owned containers');
    if (args[0] === 'inspect') {
      const copy = structuredClone(container);
      if (overrides.badOwner) copy.Config.Labels['org.p2at.local-verification'] = 'someone-else';
      return JSON.stringify([copy]);
    }
    if (args[0] === 'start') { container.State = container.failing ? { Status: 'exited', ExitCode: 42 } : { Status: 'running', ExitCode: 0, Health: { Status: overrides.health || 'healthy' } }; return id; }
    if (args[0] === 'stop') { container.State.Status = 'exited'; return id; }
    if (args[0] === 'rm') { containers.delete(id); return id; }
    throw new Error('unexpected fake command');
  };
  return { calls, containers, options: { command, environment: {}, wait: async () => {}, smoke: async () => {} } };
}
test('fake rehearsal pins full source image, rejects candidate then restores previous and cleans only owned IDs', async () => {
  const f = fixture(); const result = await verify(f.options);
  assert.equal(result.status, 'PASS'); assert.equal(result.sourceSha, sha); assert.equal(result.imageId, imageId);
  assert.equal(result.cleanup, 'complete'); assert.equal(f.containers.size, 0);
  const creates = f.calls.filter(c => c.args[0] === 'create'); assert.equal(creates.length, 2);
  for (const { args, options } of creates) {
    assert.ok(args.includes('127.0.0.1::8787')); assert.ok(args.includes('--read-only'));
    assert.ok(args.includes('ALL')); assert.ok(args.includes('no-new-privileges:true'));
    for (const flag of ['--memory', '--memory-swap', '--pids-limit', '--cpus', '--tmpfs', '--user']) assert.ok(args.includes(flag));
    assert.ok(args.includes('PLANNER_ACCESS_TOKEN')); assert.match(options.env.PLANNER_ACCESS_TOKEN, /^[a-f0-9]{64}$/);
    assert.ok(!args.join(' ').includes(options.env.PLANNER_ACCESS_TOKEN));
    assert.ok(!JSON.stringify(result).includes(options.env.PLANNER_ACCESS_TOKEN));
    assert.ok(!args.includes('--volume')); assert.ok(!args.includes('--privileged'));
  }
  assert.equal(f.calls.filter(c => c.args[0] === 'start').length, 3);
  assert.ok(result.stages.includes('previous-pinned-image-restored-engine-health-and-smoke-passed'));
});
test('unavailable Docker and remote context are NOT_RUN without builds or container operations', async () => {
  for (const override of [{ failure: (_, args) => args[0] === '--version' }, { endpoint: 'ssh://remote' }]) {
    const f = fixture(override), result = await verify(f.options);
    assert.equal(result.status, 'NOT_RUN'); assert.equal(f.calls.some(c => c.args[0] === 'build'), false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
  const f = fixture(); const result = await verify({ ...f.options, environment: { DOCKER_HOST: 'tcp://127.0.0.1:2375' } });
  assert.equal(result.status, 'NOT_RUN'); assert.equal(f.calls.length, 0);
});
test('dirty source fails closed before image build and no private filenames escape', async () => {
  const f = fixture({ dirty: true }), result = await verify(f.options);
  assert.equal(result.status, 'NOT_RUN'); assert.equal(result.reason, 'CLEAN_COMMITTED_SOURCE_REQUIRED');
  assert.doesNotMatch(JSON.stringify(result), /private-file/); assert.equal(f.calls.some(c => c.args[0] === 'build'), false);
});
test('smoke, candidate start, or restore failure always cleans owned test containers', async () => {
  for (const mode of ['smoke', 'candidate', 'restore']) {
    let starts = 0;
    const f = fixture({ failure: (_, args) => args[0] === 'start' && ++starts === (mode === 'candidate' ? 2 : mode === 'restore' ? 3 : -1) });
    if (mode === 'smoke') f.options.smoke = async () => { throw new Error('SECRET token'); };
    const result = await verify(f.options);
    assert.equal(result.status, 'FAIL'); assert.equal(f.containers.size, 0); assert.equal(result.cleanup, 'complete');
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});
test('ownership mismatch never removes or stops foreign container; cleanup failure explicit', async () => {
  const f = fixture({ badOwner: true }), result = await verify(f.options);
  assert.equal(result.status, 'FAIL'); assert.equal(result.cleanup, 'failed-owned-container-retained');
  assert.equal(f.calls.some(c => ['rm', 'stop'].includes(c.args[0])), false);
});
test('unexpected public port is rejected and owned container cleaned', async () => {
  const f = fixture({ hostIp: '0.0.0.0' }), result = await verify(f.options);
  assert.equal(result.status, 'FAIL'); assert.equal(f.containers.size, 0);
});
test('path and name guards reject remote daemon, arbitrary image, unsafe resource names', () => {
  assert.equal(localEndpoint('unix:///var/run/docker.sock'), true);
  assert.equal(localEndpoint('npipe:////./pipe/docker_engine'), true);
  for (const endpoint of ['tcp://localhost:2375', 'ssh://server', 'npipe:////server/pipe/docker_engine']) assert.equal(localEndpoint(endpoint), false);
  assert.throws(() => runArguments('production', 'previous', imageId));
  assert.throws(() => runArguments('p2at-verify-' + 'f'.repeat(24), '../other', imageId));
  assert.throws(() => runArguments('p2at-verify-' + 'f'.repeat(24), 'previous', 'latest'));
});
test('smoke checks health plus anonymous/origin/login/missing assets without live WeGame requests', async () => {
  const calls = [];
  await smoke(45678, 'test-only-secret', async (port, route, opts) => {
    calls.push({ port, route, opts });
    if (calls.length === 1) return { status: 200, body: '{"ok":true}' };
    if (calls.length === 2) return { status: 401 };
    if (calls.length === 3) return { status: 403 };
    if (calls.length === 4) return { status: 200, headers: { 'set-cookie': ['planner_session=opaque; HttpOnly; SameSite=Strict'] } };
    return { status: 503, body: '{"error":{"code":"RESOURCE_NOT_FOUND"}}' };
  });
  assert.equal(calls.length, 5); assert.ok(calls.every(call => call.port === 45678));
  assert.ok(calls.filter(call => call.route === '/api/wegame').every(call => call.opts.body.url === ''));
});
test('context is exact committed source allowlist, rejects symlinks and never includes unrelated files', () => {
  const { contextPaths } = require('../deploy/verify-container.cjs');
  const extra = ['apps/planner-desktop/renderer/browser-platform.js','apps/planner-desktop/renderer/agent-panel.css', 'apps/planner-desktop/renderer/private/secret.js', 'apps/planner-desktop/renderer/.env', 'apps/planner-desktop/data/cache/private.json', 'docs/private.md'];
  const paths = contextPaths(tree + '\n' + extra.map(name => `100644 blob ${'d'.repeat(40)}\t${name}`).join('\n'));
  assert.ok(paths.includes(extra[0])); assert.ok(paths.includes(extra[1]));
  for (const name of extra.slice(2)) assert.equal(paths.includes(name), false);
  assert.throws(() => contextPaths(tree.replace('100644', '120000')), /SYMLINK/);
  assert.throws(() => contextPaths(''), /MISSING/);
});
test('remote context discovery uses client-only version and never contacts daemon', async () => {
  const f = fixture({ endpoint: 'tcp://remote:2376' });
  const result = await verify(f.options);
  assert.equal(result.status, 'NOT_RUN');
  assert.deepEqual(f.calls.map(call => call.args[0]), ['--version', 'context']);
});
test('Docker receives generated committed archive on stdin rather than working directory', async () => {
  const f = fixture(); assert.equal((await verify(f.options)).status, 'PASS');
  const archive = f.calls.find(call => call.program === 'git' && call.args[0] === 'archive');
  assert.ok(archive.args.includes(sha));
  assert.deepEqual(archive.args.slice(archive.args.indexOf('--') + 1), [...sourceNames].sort());
  const build = f.calls.find(call => call.args[0] === 'build');
  assert.equal(build.args.at(-1), '-');
  assert.equal(build.options.inputFile, archive.args[archive.args.indexOf('--output') + 1]);
  assert.ok(build.args.includes('--builder')); assert.ok(build.args.includes('default'));
});
test('approved endpoint is pinned on every daemon command even if default context changes', async () => {
  const f = fixture();
  f.options.environment = { DOCKER_CONTEXT: 'initial-context' };
  assert.equal((await verify(f.options)).status, 'PASS');
  for (const call of f.calls.filter(call => call.program === 'docker' && !['--version', 'context'].includes(call.args[0]))) {
    assert.deepEqual(call.rawArgs.slice(0, 2), ['--host', 'unix:///var/run/docker.sock']);
    assert.equal(call.options.env.DOCKER_CONTEXT, undefined);
    assert.equal(call.options.env.DOCKER_HOST, undefined);
  }
});
test('engine unhealthy and never healthy both fail and clean up even if HTTP smoke would pass', async () => {
  for (const health of ['unhealthy', 'starting']) {
    const f = fixture({ health }); let smokeCalled = false;
    f.options.smoke = async () => { smokeCalled = true; };
    const result = await verify(f.options);
    assert.equal(result.status, 'FAIL'); assert.equal(f.containers.size, 0);
    assert.equal(smokeCalled, false);
  }
});
