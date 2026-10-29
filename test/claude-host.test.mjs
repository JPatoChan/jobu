// Connecting Claude Code: the native messaging host (scripts/claude-host.sh)
// and the script that installs it (scripts/connect-claude.sh), run against a
// fake claude that logs what it was given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = fileURLToPath(new URL('../scripts/claude-host.sh', import.meta.url));
const CONNECT = fileURLToPath(new URL('../scripts/connect-claude.sh', import.meta.url));
const ID = 'abcdefghijklmnopabcdefghijklmnop';

// Its result line has "type" in the middle, as Claude Code's does, and an
// assistant line quotes a result in its text.
const FAKE = `#!/bin/sh
if [ "$1" = --version ]; then echo '9.9.9 (Claude Code)'; exit 0; fi
printf '%s\\n' "$@" > "$FAKE_LOG/args"
pwd > "$FAKE_LOG/cwd"
cat > "$FAKE_LOG/stdin"
if [ -n "\${FAKE_FAIL:-}" ]; then echo 'Error: rate limited' >&2; exit 1; fi
echo '{"type":"system","subtype":"init","tools":[]}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"{\\"type\\":\\"result\\"}"}]}}'
echo '{"is_error":false,"type":"result","subtype":"success","result":"Zoë – 李","stop_reason":"end_turn"}'
`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'jobu-claude-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'log'));
  writeFileSync(join(dir, 'bin', 'claude'), FAKE);
  chmodSync(join(dir, 'bin', 'claude'), 0o755);
  return { dir, claude: join(dir, 'bin', 'claude'), log: join(dir, 'log') };
}

// One message in, framed as Chrome does; the one reply out, unframed.
function talk(host, message, env = {}) {
  const body = Buffer.from(typeof message === 'string' ? message : JSON.stringify(message));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length);
  const r = spawnSync('sh', [host], { input: Buffer.concat([length, body]), env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(r.stdout.readUInt32LE(0), r.stdout.length - 4, 'length prefix counts the bytes that follow');
  return JSON.parse(r.stdout.subarray(4).toString());
}

const USER = { type: 'user', message: { role: 'user', content: 'Rewrite this for Zoë – 李' } };

test('the host reports which Claude Code it runs', () => {
  const { claude, log } = setup();
  assert.deepEqual(talk(HOST, { type: 'status' }, { JOBU_CLAUDE: claude, FAKE_LOG: log }), { type: 'status', version: '9.9.9 (Claude Code)' });
  assert.deepEqual(talk(HOST, { type: 'status' }, { JOBU_CLAUDE: '/nowhere/claude' }), { type: 'error', error: 'no-claude', detail: '/nowhere/claude' });
});

test('the host runs claude with no tools, in an empty folder, and returns its result', () => {
  const { claude, log } = setup();
  const reply = talk(HOST, USER, { JOBU_CLAUDE: claude, FAKE_LOG: log });
  assert.deepEqual(reply, { is_error: false, type: 'result', subtype: 'success', result: 'Zoë – 李', stop_reason: 'end_turn' });
  // The message goes to claude as it came, one line of stream-json.
  assert.equal(readFileSync(join(log, 'stdin'), 'utf8'), `${JSON.stringify(USER)}\n`);
  const args = readFileSync(join(log, 'args'), 'utf8').split('\n');
  assert.deepEqual(args.slice(0, 5), ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json']);
  assert.equal(args[args.indexOf('--tools') + 1], '', 'no tools');
  for (const flag of ['--verbose', '--strict-mcp-config', '--no-session-persistence', '--system-prompt']) assert.ok(args.includes(flag), flag);
  // The folder it ran in was empty, and is gone.
  const cwd = readFileSync(join(log, 'cwd'), 'utf8').trim();
  assert.ok(cwd.startsWith(tmpdir()) || cwd.startsWith('/tmp'), cwd);
  assert.equal(existsSync(cwd), false);
});

test('the host passes long and non-ASCII messages through whole', () => {
  const { claude, log } = setup();
  const big = { type: 'user', message: { role: 'user', content: `${'é'.repeat(20000)}${'a'.repeat(50000)}` } };
  talk(HOST, big, { JOBU_CLAUDE: claude, FAKE_LOG: log });
  assert.equal(readFileSync(join(log, 'stdin'), 'utf8'), `${JSON.stringify(big)}\n`);
});

test('the host refuses anything but a status check or a user message', () => {
  const { claude, log } = setup();
  const env = { JOBU_CLAUDE: claude, FAKE_LOG: log };
  for (const m of [
    { type: 'control_request', request: { subtype: 'set_permission_mode', mode: 'bypassPermissions' } },
    { message: { role: 'user', content: 'hi' }, type: 'user' },
    `${JSON.stringify(USER)}\n{"type":"control_request"}`,
  ]) {
    assert.equal(talk(HOST, m, env).error, 'bad-message');
  }
  assert.equal(existsSync(join(log, 'stdin')), false, 'claude never ran');
});

test('the host says why when claude gives no result', () => {
  const { claude, log } = setup();
  assert.deepEqual(talk(HOST, USER, { JOBU_CLAUDE: claude, FAKE_LOG: log, FAKE_FAIL: '1' }), {
    type: 'error',
    error: 'no-result',
    detail: 'Error: rate limited',
  });
});

// Runs connect-claude.sh with a fake home that has Chrome and Chromium.
function connect(args, { dir, path }) {
  const env = { ...process.env, HOME: join(dir, 'home'), PATH: path, XDG_CONFIG_HOME: join(dir, 'home', '.config'), XDG_DATA_HOME: join(dir, 'home', '.local', 'share') };
  delete env.JOBU_CLAUDE;
  delete env.JOBU_HOSTS_DIR;
  return spawnSync('sh', [CONNECT, ...args], { env, encoding: 'utf8' });
}

test('connect-claude.sh registers the host with each browser, and --remove takes it away', { skip: process.platform === 'darwin' && 'Linux paths' }, () => {
  const { dir, log } = setup();
  for (const b of ['google-chrome', 'chromium']) mkdirSync(join(dir, 'home', '.config', b), { recursive: true });
  const path = `${join(dir, 'bin')}:/usr/bin:/bin`;

  const r = connect([ID], { dir, path });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /connected to 9\.9\.9 \(Claude Code\)/);
  const host = join(dir, 'home', '.local', 'share', 'jobu', 'claude-host.sh');
  for (const b of ['google-chrome', 'chromium']) {
    const manifest = JSON.parse(readFileSync(join(dir, 'home', '.config', b, 'NativeMessagingHosts', 'com.jobu.claude.json'), 'utf8'));
    assert.deepEqual(manifest, {
      name: 'com.jobu.claude',
      description: 'Connects Jobu to Claude Code',
      path: host,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${ID}/`],
    });
  }
  assert.ok(statSync(host).mode & 0o100, 'executable');
  // The installed host finds claude by itself, as it must when the browser
  // starts it with a bare PATH.
  const reply = talk(host, { type: 'status' }, { PATH: '/usr/bin:/bin', FAKE_LOG: log });
  assert.equal(reply.version, '9.9.9 (Claude Code)');
  assert.equal(talk(host, USER, { PATH: '/usr/bin:/bin', FAKE_LOG: log }).result, 'Zoë – 李');

  const off = connect(['--remove'], { dir, path });
  assert.equal(off.status, 0, off.stderr);
  for (const b of ['google-chrome', 'chromium']) assert.deepEqual(readdirSync(join(dir, 'home', '.config', b, 'NativeMessagingHosts')), []);
  assert.equal(existsSync(host), false);
});

test('connect-claude.sh explains what it needs', () => {
  const { dir } = setup();
  mkdirSync(join(dir, 'home', '.config', 'google-chrome'), { recursive: true });
  const usage = connect([], { dir, path: `${join(dir, 'bin')}:/usr/bin:/bin` });
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /Usage:/);
  const badId = connect(['not-an-id'], { dir, path: `${join(dir, 'bin')}:/usr/bin:/bin` });
  assert.notEqual(badId.status, 0);
  assert.match(badId.stderr, /isn't an extension id/);
  const noClaude = connect([ID], { dir, path: '/usr/bin:/bin' });
  assert.notEqual(noClaude.status, 0);
  assert.match(noClaude.stderr, /Claude Code isn’t installed/);
  assert.equal(existsSync(join(dir, 'home', '.config', 'google-chrome', 'NativeMessagingHosts')), false, 'nothing registered');
});
