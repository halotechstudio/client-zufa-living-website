import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

const SESSION_DAYS = 30;

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `s1$${salt.toString('hex')}$${scryptSync(pw, salt, 32).toString('hex')}`;
}

export function checkPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = scryptSync(pw, Buffer.from(saltHex, 'hex'), want.length);
  return timingSafeEqual(want, got);
}

// The "admin" account always uses ADMIN_PASSWORD from the environment, so changing
// that value (and restarting) is how the owner resets it.
export function ensureAdmin() {
  if (!config.adminPassword) {
    console.warn('⚠  ADMIN_PASSWORD is not set — nobody can log in until it is.');
    return;
  }
  const admin = db.prepare("SELECT * FROM users WHERE name = 'admin'").get();
  if (!admin) {
    db.prepare("INSERT INTO users (name, pass_hash, role) VALUES ('admin', ?, 'admin')").run(hashPassword(config.adminPassword));
  } else if (!checkPassword(config.adminPassword, admin.pass_hash)) {
    db.prepare("UPDATE users SET pass_hash = ?, role = 'admin', active = 1 WHERE id = ?").run(hashPassword(config.adminPassword), admin.id);
  }
}

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return token;
}

export function sessionUser(req) {
  const m = /(?:^|;\s*)zcrm=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  return db.prepare(`SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`).get(m[1], Date.now()) || null;
}

export function sessionCookie(req, token, maxAgeSec = SESSION_DAYS * 86400) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  return `zcrm=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function endSession(req) {
  const m = /(?:^|;\s*)zcrm=([^;]+)/.exec(req.headers.cookie || '');
  if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
}

// Slow down password guessing: max 10 failed attempts per IP per 15 minutes.
const fails = new Map();
export function loginAllowed(ip) {
  const f = fails.get(ip);
  if (!f || f.until < Date.now()) return true;
  return f.n < 10;
}
export function loginFailed(ip) {
  const f = fails.get(ip);
  if (!f || f.until < Date.now()) fails.set(ip, { n: 1, until: Date.now() + 15 * 60e3 });
  else f.n++;
}
