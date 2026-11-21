import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../src/server/config.mjs';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, readdir, symlink, stat } from 'node:fs/promises';
import { prepare, validDomain, parseEnv } from '../scripts/deploy-prepare.mjs';

async function fixture(t) {
  const temp = process.platform === 'win32' ? path.join(ROOT, '.tools', 'tmp') : os.tmpdir();
  await mkdir(temp, { recursive: true });
  const root = await mkdtemp(path.join(temp, 'gba-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project with spaces'), state = path.join(project, 'deploy'), romSource = path.join(project, 'data', 'roms');
  await mkdir(state, { recursive: true }); await mkdir(romSource, { recursive: true }); await mkdir(path.join(project, 'config'));
  const manifest = { version: 1, defaultGameId: 'demo', games: [{ id: 'demo', title: '测试', rom: 'demo.gba', players: [1], defaultPlayers: 1, link: 'none', compatibility: 'untested' }] };
  await writeFile(path.join(project, 'config', 'games.json'), JSON.stringify(manifest));
  await writeFile(path.join(romSource, 'demo.gba'), Buffer.from([1, 2, 3, 4]));
  return { project, state, romSource, domain: 'play.example.com', setSecretOwner: false, manifest };
}
test('deployment initializes valid private files and repeat runs preserve custom configuration and ROM bytes', async t => {
  const f = await fixture(t); const first = await prepare(f); assert.equal(first.copiedRoms, 1);
  const secret = await readFile(first.passwordFile, 'utf8'); assert.match(secret, /^[a-f0-9]{64}\n$/);
  const envPath = path.join(f.state, '.env'); const env = (await readFile(envPath, 'utf8')).replace('INPUT_DELAY_FRAMES=6', 'INPUT_DELAY_FRAMES=8'); await writeFile(envPath, env);
  await writeFile(path.join(f.romSource, 'demo.gba'), 'changed upstream');
  const second = await prepare({ ...f, domain: undefined }); assert.equal(second.copiedRoms, 0);
  assert.equal(await readFile(first.passwordFile, 'utf8'), secret); assert.equal(await readFile(envPath, 'utf8'), env);
  assert.deepEqual(await readFile(path.join(f.state, 'roms', 'demo.gba')), Buffer.from([1, 2, 3, 4]));
  assert.ok(!(await readdir(f.state)).some(name => name.startsWith('.prepare-')));
  if (process.platform !== 'win32') assert.equal((await stat(first.passwordFile)).mode & 0o777, 0o600);
});
test('deployment rejects missing ROMs before writing active configuration or secrets', async t => {
  const f = await fixture(t); await rm(path.join(f.romSource, 'demo.gba'));
  await assert.rejects(prepare(f), /ENOENT/);
  await assert.rejects(access(path.join(f.state, '.env'))); await assert.rejects(access(path.join(f.state, 'secrets', 'access-password.txt')));
  assert.ok(!(await readdir(f.state)).some(name => name.startsWith('.prepare-')));
});
test('deployment honors an existing custom catalog and disabled games', async t => {
  const f = await fixture(t); f.manifest.games.push({ ...f.manifest.games[0], id: 'same-rom' }, { id: 'disabled', enabled: false });
  await writeFile(path.join(f.state, 'games.json'), JSON.stringify(f.manifest, null, 2));
  const original = await readFile(path.join(f.state, 'games.json'));
  await writeFile(path.join(f.project, 'config', 'games.json'), 'invalid upstream catalog');
  assert.equal((await prepare(f)).games, 2); assert.deepEqual(await readFile(path.join(f.state, 'games.json')), original);
});
test('deployment fails on domain conflict and invalid existing secret without replacing content', async t => {
  const f = await fixture(t); const first = await prepare(f);
  await assert.rejects(prepare({ ...f, domain: 'other.example.com' }), /域名与已有/);
  await writeFile(first.passwordFile, 'short\n'); await assert.rejects(prepare(f), /至少 16/);
  assert.equal(await readFile(first.passwordFile, 'utf8'), 'short\n');
  await writeFile(first.passwordFile, Buffer.from([255, 254, 253])); await assert.rejects(prepare(f), /encoded data|encoding/i);
});
test('deployment rejects shell syntax, duplicate settings, invalid domains and path escapes', async t => {
  for (const value of ['https://play.example.com', 'Play.example.com', '127.0.0.1', 'a..com', '-a.example', 'play.example.com:443', 'play.example.com/']) assert.equal(validDomain(value), false);
  assert.equal(validDomain('play.example.com'), true);
  for (const value of ['SITE_DOMAIN=$(id)', 'SITE_DOMAIN=a.com\nSITE_DOMAIN=b.com', 'UNKNOWN=1', 'SITE_DOMAIN="a.com"']) assert.throws(() => parseEnv(value));
  const f = await fixture(t); f.manifest.games[0].rom = '../outside.gba'; await writeFile(path.join(f.project, 'config', 'games.json'), JSON.stringify(f.manifest));
  await assert.rejects(prepare(f), /不安全/); await assert.rejects(access(path.join(f.state, '.env')));
});
test('deployment refuses existing symlink state entries', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); const target = path.join(f.project, 'external.env'); await writeFile(target, 'SITE_DOMAIN=play.example.com\n');
  await symlink(target, path.join(f.state, '.env')); await assert.rejects(prepare(f), /拒绝符号链接/);
  assert.equal(await readFile(target, 'utf8'), 'SITE_DOMAIN=play.example.com\n');
});
