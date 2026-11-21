import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
export const APP_ID = 'kirby-lan-netplay';
export const VERSION = '1.4.0';
export const PROJECT_ID = createHash('sha256').update(ROOT).digest('hex');
export const ROM_NAME = 'kirby-amazing-mirror-cn.gba';

export function configFromEnv(env = process.env) {
  return {
    publicMode: env.PUBLIC_MODE, publicOrigin: env.PUBLIC_ORIGIN,
    accessPassword: env.ACCESS_PASSWORD, accessPasswordFile: env.ACCESS_PASSWORD_FILE,
    maxConnections: env.MAX_CONNECTIONS, maxTcpPerIp: env.MAX_TCP_PER_IP, maxWsPerIp: env.MAX_WS_PER_IP,
    wsReadTimeoutMs: env.WS_READ_TIMEOUT_MS, inputDelayFrames: env.INPUT_DELAY_FRAMES,
  };
}

function integer(value, fallback, min, max, name) {
  if (value === undefined || value === '') return fallback;
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number < min || number > max) throw Error(name + ' 配置无效');
  return number;
}

export async function loadConfig(input = {}) {
  const mode = input.publicMode;
  if (![undefined, '', false, true, 'false', 'true'].includes(mode)) throw Error('PUBLIC_MODE 必须是 true 或 false');
  const publicMode = mode === true || mode === 'true';
  let publicOrigin, publicHost;
  if (publicMode) {
    try {
      const value = input.publicOrigin;
      if (typeof value !== 'string' || !/^https:\/\/[^/?#@*\\\s]+$/.test(value)) throw Error();
      const url = new URL(value);
      if (value !== url.origin) throw Error();
      publicOrigin = url.origin; publicHost = url.host;
    } catch { throw Error('PUBLIC_ORIGIN 必须是精确 HTTPS origin（不含路径）'); }
  }
  let password = input.accessPassword || '';
  if (input.accessPasswordFile) {
    if (password) throw Error('ACCESS_PASSWORD 和 ACCESS_PASSWORD_FILE 只能配置一个');
    let file;
    try {
      file = await open(path.resolve(input.accessPasswordFile), 'r');
      const buffer = Buffer.alloc(1025);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 1024) throw Error();
      password = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)).replace(/\r?\n$/, '');
      if (!password) throw Error();
    } catch { throw Error('无法读取 ACCESS_PASSWORD_FILE 中的有效密码'); }
    finally { await file?.close(); }
  }
  if (typeof password !== 'string' || !password.isWellFormed() || (password && Buffer.byteLength(JSON.stringify({ password })) > 1024)) throw Error('ACCESS_PASSWORD 配置无效');
  if (publicMode && ([...password].length < 16 || !password.trim())) throw Error('公网模式要求 ACCESS_PASSWORD 至少 16 个字符');
  return {
    publicMode, publicOrigin, publicHost,
    passwordHash: password ? createHash('sha256').update(password).digest() : null,
    maxConnections: integer(input.maxConnections, 160, 1, 2048, 'MAX_CONNECTIONS'),
    maxTcpPerIp: integer(input.maxTcpPerIp, 20, 1, 2048, 'MAX_TCP_PER_IP'),
    maxWsPerIp: integer(input.maxWsPerIp, 20, 1, 80, 'MAX_WS_PER_IP'),
    inputDelayFrames: integer(input.inputDelayFrames, publicMode ? 6 : 3, 1, 12, 'INPUT_DELAY_FRAMES'),
    wsReadTimeoutMs: integer(input.wsReadTimeoutMs, 5000, 25, 30000, 'WS_READ_TIMEOUT_MS'),
  };
}
