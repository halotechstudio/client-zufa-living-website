import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { one, run, countHits, addHit } from './db.js';
import { config } from './config.js';

const scryptP = promisify(scrypt);
const SESSION_DAYS = 30;

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  return `s1$${salt.toString('hex')}$${(await scryptP(pw, salt, 32)).toString('hex')}`;
}

export async function checkPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = await scryptP(pw, Buffer.from(saltHex, 'hex'), want.length);
  return timingSafeEqual(want, got);
}

// The "admin" account always uses ADMIN_PASSWORD from the environment, so changing that value is how the owner resets it.
// Checked once per server instance.
let adminChecked;
export function ensureAdmin() {
  if (!adminChecked) adminChecked = (async () => {
    if (!config.adminPassword) { console.warn('ADMIN_PASSWORD is not set: nobody can log in until it is.'); return; }
    const admin = await one("SELECT * FROM users WHERE lower(name) = 'admin'", []);
    if (!admin) await run("INSERT INTO users (name, pass_hash, role) VALUES ('admin', $1, 'admin') ON CONFLICT DO NOTHING", [await hashPassword(config.adminPassword)]);
    else if (!(await checkPassword(config.adminPassword, admin.pass_hash)))
      await run("UPDATE users SET pass_hash = $1, role = 'admin', active = TRUE WHERE id = $2", [await hashPassword(config.adminPassword), admin.id]);
  })().catch(e => { adminChecked = null; throw e; });
  return adminChecked;
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  await run(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [token, userId]);
  await run('DELETE FROM sessions WHERE expires_at < now()', []);
  return token;
}

const tokenOf = req => /(?:^|;\s*)zcrm=([^;]+)/.exec(req.headers.cookie || '')?.[1];

export async function sessionUser(req) {
  const t = tokenOf(req);
  if (!t) return null;
  return one(`SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > now() AND u.active`, [t]);
}

export function sessionCookie(req, token, maxAgeSec = SESSION_DAYS * 86400) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
  return `zcrm=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export async function endSession(req) {
  const t = tokenOf(req);
  if (t) await run('DELETE FROM sessions WHERE token = $1', [t]);
}

// Slow down password guessing: max 10 failed attempts per IP per 15 minutes.
export const loginAllowed = async ip => (await countHits(`login:${ip}`, 15)) < 10;
export const loginFailed = ip => addHit(`login:${ip}`);
