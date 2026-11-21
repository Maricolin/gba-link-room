import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_SECONDS = 12 * 60 * 60;
const MAX_SESSIONS = 256;
const MAX_TRACKED_IPS = 2048;
export const peerIp = socket => (socket.remoteAddress || '-').replace(/^::ffff:/, '');

// Rolling token buckets with a bounded number of address keys (direct peers only).
function rateGate(ipBurst, globalBurst, windowMs) {
  const ips = new Map();
  const global = { tokens: globalBurst, time: 0 };
  let nextSweep = 0;
  function refill(bucket, burst, now) {
    bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, now - bucket.time) * burst / windowMs);
    bucket.time = now;
  }
  return ip => {
    const now = Date.now();
    refill(global, globalBurst, now);
    if (global.tokens < 1) return false;
    if (now >= nextSweep) {
      for (const [key, bucket] of ips) if (now - bucket.time >= 2 * windowMs) ips.delete(key);
      nextSweep = now + windowMs;
    }
    let bucket = ips.get(ip);
    if (!bucket) {
      if (ips.size >= MAX_TRACKED_IPS) return false;
      bucket = { tokens: ipBurst, time: now };
      ips.set(ip, bucket);
    }
    refill(bucket, ipBurst, now);
    if (bucket.tokens < 1) return false;
    bucket.tokens--; global.tokens--;
    return true;
  };
}

export function createSecurity(config) {
  const sessions = new Map();
  const required = !!config.passwordHash;
  const romByIp = rateGate(20, 40, 60000);
  const romBySession = rateGate(10, 40, 60000);
  const cookieName = config.publicMode ? '__Host-kirby_session' : 'kirby_session';
  function isActive(token) {
    const deadline = sessions.get(token);
    if (deadline === undefined) return false;
    if (deadline > Date.now()) return true;
    sessions.delete(token);
    return false;
  }
  return {
    required, isActive,
    httpAttempt: rateGate(150, 700, 10000),
    tcpAttempt: rateGate(100, 500, 10000),
    wsAttempt: rateGate(30, 150, 10000),
    loginAttempt: rateGate(5, 40, 60000),
    roomAttempt: rateGate(10, 60, 30000),
    romAttempt: (ip, token) => romByIp(ip) && romBySession(token || ip),
    hostAllowed(req) { return !config.publicMode || (typeof req.headers.host === 'string' && req.headers.host.toLowerCase() === config.publicHost); },
    originAllowed(req) {
      const { origin, host } = req.headers;
      if (config.publicMode) return req.headersDistinct.origin?.length === 1 && origin === config.publicOrigin;
      if (origin === undefined) return true;
      if (req.headersDistinct.origin?.length !== 1 || typeof host !== 'string' || !/^[a-z\d.:[\]-]+$/i.test(host)) return false;
      try { return ['http:', 'https:'].some(protocol => origin === new URL(protocol + '//' + host).origin); }
      catch { return false; }
    },
    session(req) {
      if (!required || typeof req.headers.cookie !== 'string') return null;
      let value = null;
      for (const part of req.headers.cookie.split(';')) {
        const match = part.trim().match(/^([^=]+)=(.*)$/);
        if (match?.[1] !== cookieName) continue;
        if (value !== null || !/^[\w-]{43}$/.test(match[2])) return null;
        value = match[2];
      }
      return value && isActive(value) ? value : null;
    },
    checkPassword(password) {
      return timingSafeEqual(config.passwordHash, createHash('sha256').update(password).digest());
    },
    issue() {
      for (const token of sessions.keys()) isActive(token);
      if (sessions.size >= MAX_SESSIONS) return null;
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, Date.now() + SESSION_SECONDS * 1000);
      return token;
    },
    revoke: token => sessions.delete(token),
    cookie(token) {
      return cookieName + '=' + (token || '') + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (token ? SESSION_SECONDS : 0) + (config.publicMode ? '; Secure' : '');
    },
    headers: {
      'Content-Security-Policy': ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self'", "connect-src 'self'" + (config.publicMode ? ' ' + config.publicOrigin.replace(/^https:/, 'wss:') : ' ws: wss:'), "style-src 'self' 'unsafe-inline'", "font-src 'self'", "img-src 'self' data:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  };
}
