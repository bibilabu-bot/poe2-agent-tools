'use strict';

// Local-only disposable rehearsal. No production containers, volumes, cloud or game assets.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const ROOT = path.resolve(__dirname, '../../..');
const LABEL = 'org.p2at.local-verification';
const ORIGIN = 'http://127.0.0.1:8787';
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const CONTAINER = /^[a-f0-9]{64}$/;

function command(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: ROOT, windowsHide: true, shell: false, env: options.env || process.env, stdio: [options.inputFile ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = '', size = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('COMMAND_TIMEOUT')); }, options.timeout || 30000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) { child.kill(); finish(new Error('COMMAND_OUTPUT_LIMIT')); }
      else stdout += chunk;
    });
    // Never retain Docker stderr: daemon errors can include configuration or secrets.
    child.stderr.resume();
    if (options.inputFile) {
      const input = fs.createReadStream(options.inputFile);
      input.on('error', () => { child.kill(); finish(new Error('CONTEXT_READ_FAILED')); });
      child.stdin.on('error', () => { input.destroy(); });
      child.once('close', () => input.destroy());
      input.pipe(child.stdin);
    }
    child.on('error', () => finish(new Error('COMMAND_UNAVAILABLE')));
    child.on('close', code => finish(code === 0 ? null : new Error('COMMAND_FAILED'), stdout.trim()));
  });
}

// Derive context from committed Git objects, never checkout or ignored files.
function contextPaths(tree) {
  const exact = new Set([
    'data/upstream-sources.lock.json', 'apps/planner-browser/server.cjs',
    'apps/planner-browser/Dockerfile', 'apps/planner-browser/Dockerfile.dockerignore',
    'apps/planner-desktop/renderer/index.html',
    'apps/planner-desktop/src/interop/ggg-build-v1-contract.json',
    'apps/planner-desktop/electron/runtime-resource-store.cjs',
    'apps/planner-desktop/electron/wegame-import-service.cjs',
    'apps/planner-desktop/data/cache/manifest.json',
  ]);
  const selected = [];
  for (const line of tree.split('\n')) {
    if (!line) continue;
    const match = /^(\d{6}) blob [a-f0-9]{40}\t(.+)$/.exec(line);
    if (!match) continue;
    const [, mode, name] = match;
    const allowed = exact.has(name) || /^apps\/planner-desktop\/renderer\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(name)
      || /^apps\/planner-desktop\/src\/interop\/[a-zA-Z0-9_.-]+\.js$/.test(name);
    if (!allowed) continue;
    if (!['100644', '100755'].includes(mode)) throw new Error('SYMLINK_CONTEXT_REJECTED');
    selected.push(name);
  }
  if ([...exact].some(name => !selected.includes(name))) throw new Error('CONTEXT_SOURCE_MISSING');
  return selected.sort();
}
function localEndpoint(endpoint) {
  return /^unix:\/\/\/[^\r\n]+$/.test(endpoint) || /^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_.-]+$/.test(endpoint);
}
function runArguments(owner, name, image, failing = false) {
  if (!/^p2at-verify-[a-f0-9]{24}$/.test(owner) || !['previous', 'candidate'].includes(name) || !IMAGE.test(image)) throw new Error('INVALID_SCOPE');
  const args = ['create', '--name', `${owner}-${name}`, '--label', `${LABEL}=${owner}`,
    '--user', 'node', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--memory', '256m', '--memory-swap', '256m', '--pids-limit', '64', '--cpus', '1',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m', '--publish', '127.0.0.1::8787',
    '--env', 'PLANNER_ACCESS_TOKEN', '--env', 'PLANNER_CONTAINER_MODE=1', '--env', `PLANNER_ORIGIN=${ORIGIN}`,
    image];
  if (failing) args.push('node', '-e', 'process.exit(42)');
  return args;
}
function request(port, route, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: body ? 'POST' : 'GET',
      headers: { host: '127.0.0.1:8787', ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...options.headers } }, res => {
      let text = '', size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 65536) res.destroy(new Error('RESPONSE_LIMIT')); else text += chunk; });
      res.on('error', () => reject(new Error('HTTP_FAILED')));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.setTimeout(2000, () => req.destroy());
    req.on('error', () => reject(new Error('HTTP_FAILED')));
    if (body) req.write(body);
    req.end();
  });
}
async function smoke(port, token, send = request) {
  const health = await send(port, '/health');
  if (health.status !== 200 || JSON.parse(health.body).ok !== true) throw new Error('HEALTH_FAILED');
  const anonymous = await send(port, '/api/wegame', { body: { url: '' }, headers: { origin: ORIGIN } });
  if (anonymous.status !== 401) throw new Error('ANONYMOUS_GUARD_FAILED');
  const foreign = await send(port, '/api/login', { body: { token }, headers: { origin: 'http://127.0.0.1:1' } });
  if (foreign.status !== 403) throw new Error('ORIGIN_GUARD_FAILED');
  const login = await send(port, '/api/login', { body: { token }, headers: { origin: ORIGIN } });
  const cookieHeader = login.headers['set-cookie']?.[0];
  if (login.status !== 200 || !cookieHeader || !cookieHeader.includes('HttpOnly') || !cookieHeader.includes('SameSite=Strict')) throw new Error('LOGIN_FAILED');
  const absent = await send(port, '/api/wegame', { body: { url: '' }, headers: { origin: ORIGIN, cookie: cookieHeader.split(';')[0] } });
  if (absent.status !== 503 || JSON.parse(absent.body).error?.code !== 'RESOURCE_NOT_FOUND') throw new Error('ASSET_ABSENCE_FAILED');
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verify(options = {}) {
  const execute = options.command || command;
  let endpoint = null;
  const docker = (args, extra = {}) => {
    const commandEnv = { ...environment, ...extra.env };
    if (endpoint) { delete commandEnv.DOCKER_CONTEXT; delete commandEnv.DOCKER_HOST; }
    return execute('docker', endpoint ? ['--host', endpoint, ...args] : args, { ...extra, env: commandEnv });
  };
  const wait = options.wait || pause;
  const checkSmoke = options.smoke || smoke;
  const environment = options.environment || process.env;
  const result = { status: 'NOT_RUN', reason: null, stages: [], sourceSha: null, imageId: null, rollbackScope: 'failed invocation to previous pinned image; no database or alternate-version rollback', cleanup: 'not-needed' };
  const owner = `p2at-verify-${crypto.randomBytes(12).toString('hex')}`;
  result.runId = owner;
  const token = crypto.randomBytes(32).toString('hex');
  const owned = new Set();
  const env = { ...environment, PLANNER_ACCESS_TOKEN: token };
  let stage = 'docker-availability', temporaryDirectory = null, archive = null;
  async function inspect(id) {
    if (!CONTAINER.test(id) || !owned.has(id)) throw new Error('OUT_OF_SCOPE');
    const rows = JSON.parse(await docker(['inspect', '--type', 'container', id]));
    const value = rows[0];
    if (rows.length !== 1 || value.Id !== id || value.Config?.Labels?.[LABEL] !== owner || value.Image !== result.imageId) throw new Error('OWNERSHIP_MISMATCH');
    return value;
  }
  async function create(name, failing) {
    const id = await docker(runArguments(owner, name, result.imageId, failing), { env });
    if (!CONTAINER.test(id)) throw new Error('INVALID_CONTAINER_ID');
    owned.add(id);
    await inspect(id);
    await docker(['start', id]);
    return id;
  }
  async function remove(id) {
    await inspect(id);
    await docker(['rm', '--force', id]);
    owned.delete(id);
  }
  async function healthy(id) {
    const value = await inspect(id);
    const bindings = value.NetworkSettings?.Ports?.['8787/tcp'];
    if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || !/^\d+$/.test(bindings[0].HostPort)) throw new Error('UNSAFE_BINDING');
    const port = Number(bindings[0].HostPort);
    if (port < 1 || port > 65535) throw new Error('UNSAFE_BINDING');
    // The Dockerfile probes every 30s. Bound waiting to 90s, including startup.
    for (let i = 0; i < 90; i++) {
      const state = (await inspect(id)).State;
      if (state?.Status !== 'running' || !state.Health || state.Health.Status === 'unhealthy') throw new Error('ENGINE_HEALTH_FAILED');
      if (state.Health.Status === 'healthy') { await checkSmoke(port, token); return; }
      await wait(1000);
    }
    throw new Error('ENGINE_HEALTH_TIMEOUT');
  }
  try {
    if (environment.DOCKER_HOST || environment.DOCKER_TLS_VERIFY || environment.DOCKER_CERT_PATH || environment.BUILDKIT_HOST || environment.BUILDX_BUILDER) { result.reason = 'DOCKER_ENDPOINT_OVERRIDE_NOT_ALLOWED'; return result; }
    try { await docker(['--version']); }
    catch { result.reason = 'DOCKER_UNAVAILABLE'; return result; }
    const discoveredEndpoint = await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    if (!localEndpoint(discoveredEndpoint)) { result.reason = 'NONLOCAL_DOCKER_CONTEXT'; return result; }
    endpoint = discoveredEndpoint;
    if (await docker(['info', '--format', '{{.OSType}}']) !== 'linux') { result.reason = 'LINUX_CONTAINERS_REQUIRED'; return result; }
    result.stages.push('local-docker-ready');
    stage = 'source-validation';
    const sha = await execute('git', ['rev-parse', 'HEAD']);
    if (!/^[a-f0-9]{40}$/.test(sha) || await execute('git', ['status', '--porcelain', '--untracked-files=all'])) { result.reason = 'CLEAN_COMMITTED_SOURCE_REQUIRED'; return result; }
    result.sourceSha = sha;
    const paths = contextPaths(await execute('git', ['ls-tree', '-r', '--full-tree', sha]));
    temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2at-container-'));
    archive = path.join(temporaryDirectory, 'source.tar');
    await execute('git', ['archive', '--format=tar', '--output', archive, sha, '--', ...paths]);
    result.stages.push('committed-allowlist-context-created');
    stage = 'build';
    const built = await docker(['build', '--builder', 'default', '--quiet', '--label', `org.opencontainers.image.revision=${sha}`, '--label', `${LABEL}=${owner}`, '--file', 'apps/planner-browser/Dockerfile', '-'], { timeout: 600000, inputFile: archive });
    if (!IMAGE.test(built)) throw new Error('INVALID_IMAGE_ID');
    const image = JSON.parse(await docker(['image', 'inspect', built]));
    if (image.length !== 1 || image[0].Id !== built || image[0].Config?.Labels?.['org.opencontainers.image.revision'] !== sha || image[0].Config?.User !== 'node' || image[0].Config?.Labels?.[LABEL] !== owner) throw new Error('IMAGE_PROVENANCE_FAILED');
    result.imageId = built;
    if (await execute('git', ['rev-parse', 'HEAD']) !== sha || await execute('git', ['status', '--porcelain', '--untracked-files=all'])) throw new Error('SOURCE_CHANGED_DURING_BUILD');
    result.stages.push('image-built-and-pinned');
    stage = 'previous-smoke';
    const previous = await create('previous', false);
    await healthy(previous); result.stages.push('previous-engine-health-http-auth-origin-and-no-assets-passed');
    stage = 'candidate-failure';
    await inspect(previous); await docker(['stop', '--time', '5', previous]);
    const candidate = await create('candidate', true);
    let failed = false;
    for (let i = 0; i < 30; i++) {
      const state = (await inspect(candidate)).State;
      if (state?.Status === 'exited' && state.ExitCode === 42) { failed = true; break; }
      await wait(100);
    }
    if (!failed) throw new Error('CANDIDATE_DID_NOT_FAIL_AS_EXPECTED');
    result.stages.push('deliberate-candidate-exit-42-confirmed');
    await remove(candidate);
    stage = 'restore-previous';
    await inspect(previous); await docker(['start', previous]);
    await healthy(previous); result.stages.push('previous-pinned-image-restored-engine-health-and-smoke-passed');
    result.status = 'PASS'; result.reason = null;
  } catch {
    result.status = result.stages.includes('local-docker-ready') ? 'FAIL' : 'NOT_RUN';
    result.reason = `${stage.toUpperCase().replaceAll('-', '_')}_FAILED`;
  } finally {
    if (owned.size) {
      result.cleanup = 'complete';
      for (const id of [...owned]) {
        try { await remove(id); }
        catch { result.cleanup = 'failed-owned-container-retained'; result.status = 'FAIL'; result.reason = 'CLEANUP_FAILED'; }
      }
    }
    if (owned.size) result.retainedContainerIds = [...owned];
    if (temporaryDirectory) {
      try {
        // Remove only the known generated file then its empty owned directory.
        await fsp.unlink(archive).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await fsp.rmdir(temporaryDirectory);
      } catch { result.status = 'FAIL'; result.reason = 'TEMPORARY_CONTEXT_CLEANUP_FAILED'; }
    }
  }
  return result;
}
if (require.main === module) {
  verify().then(result => { console.log(JSON.stringify(result)); process.exitCode = result.status === 'PASS' ? 0 : 1; }).catch(() => {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'HARNESS_FAILED' })); process.exitCode = 1;
  });
}
module.exports = { verify, runArguments, localEndpoint, contextPaths, smoke };
