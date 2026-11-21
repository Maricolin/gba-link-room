import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.platform === 'linux' && process.getuid?.() === 0;

test('deployment shell orchestrates prepare, repeat, readiness and failure without a real Docker daemon', { skip: !enabled }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'gba-shell-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'project with spaces'), bin = path.join(temporary, 'bin');
  await mkdir(path.join(root, 'deploy'), { recursive: true }); await mkdir(bin);
  await mkdir(path.join(root, 'config')); await mkdir(path.join(root, 'data', 'roms'), { recursive: true });
  await copyFile(path.join(projectRoot, 'deploy', 'deploy.sh'), path.join(root, 'deploy', 'deploy.sh'));
  await writeFile(path.join(root, 'deploy', 'compose.yml'), 'test fixture; mock does not parse YAML');
  await writeFile(path.join(root, 'config', 'games.json'), JSON.stringify({ version: 1, defaultGameId: 'demo', games: [{ id: 'demo', title: '测试', rom: 'demo.gba', players: [1], defaultPlayers: 1, link: 'none', compatibility: 'untested' }] }));
  await writeFile(path.join(root, 'data', 'roms', 'demo.gba'), 'synthetic ROM');
  const docker = '#!' + process.execPath + '\n' + String.raw`
const fs=require("node:fs"),cp=require("node:child_process"),path=require("node:path");
const a=process.argv.slice(2),root=process.env.DEPLOY_TEST_ROOT;
fs.appendFileSync(process.env.DEPLOY_TEST_LOG,JSON.stringify(a)+"\n");
if(a[0]==="context"){console.log("unix:///var/run/docker.sock");process.exit(0)}
if(a[0]==="info"){console.log(process.env.DEPLOY_TEST_SECURITY||"[]");process.exit(0)}
if(a[0]==="pull")process.exit(0);
if(a[0]==="run"){
 const helper=process.env.DEPLOY_TEST_HELPER;
 const args=[helper,"--project",root,"--state",path.join(root,"deploy"),"--rom-source",fs.existsSync(path.join(root,"data","roms"))?path.join(root,"data","roms"):path.join(root,"deploy","roms")];
 const i=a.indexOf("--domain");if(i!==-1)args.push("--domain",a[i+1]);
 const child=cp.spawnSync(process.execPath,args,{stdio:"inherit"});process.exit(child.status??1);
}
if(a[0]==="compose"){
 if(a.includes("--help")){console.log("--wait --wait-timeout");process.exit(0)}
 if(a.includes("up")&&process.env.DEPLOY_TEST_FAIL==="up")process.exit(42);
 process.exit(0);
}
process.exit(99);
`;
  await writeFile(path.join(bin, 'docker'), docker, { mode: 0o755 });
  await writeFile(path.join(bin, 'curl'), '#!/bin/sh\nprintf ' + "'" + '{"ok":true}' + "'" + '\n', { mode: 0o755 });
  const log = path.join(temporary, 'calls.jsonl');
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, DOCKER_HOST: '', DOCKER_CONTEXT: '', SITE_DOMAIN: 'hostile.example.com', DEPLOY_TEST_ROOT: root, DEPLOY_TEST_LOG: log, DEPLOY_TEST_HELPER: path.join(projectRoot, 'scripts', 'deploy-prepare.mjs') };
  const run = (args = [], extra = {}) => spawnSync('bash', [path.join(root, 'deploy', 'deploy.sh'), ...args], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000 });
  let result = run(['--domain', 'play.example.com', '--prepare-only']); assert.equal(result.status, 0, result.stderr);
  let calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse); assert.ok(!calls.some(a => a.includes('build')));
  const password = await readFile(path.join(root, 'deploy', 'secrets', 'access-password.txt'));
  await rm(path.join(root, 'data'), { recursive: true });
  result = run(); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /https:\/\/play.example.com/);
  assert.deepEqual(await readFile(path.join(root, 'deploy', 'secrets', 'access-password.txt')), password);
  calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(a => a.includes('--wait') && a.includes('--force-recreate')));
  result = run([], { DEPLOY_TEST_FAIL: 'up' }); assert.equal(result.status, 42); assert.doesNotMatch(result.stdout, /部署流程完成/);
  result = run([], { DEPLOY_TEST_SECURITY: '["name=rootless"]' }); assert.notEqual(result.status, 0); assert.match(result.stderr, /rootless/);
  result = run(['--timeout', '0']); assert.notEqual(result.status, 0);
});
