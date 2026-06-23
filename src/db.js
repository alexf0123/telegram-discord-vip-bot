import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_PATH || './data/database.sqlite';

export function ensureDataDir() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDataDir();
export const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  telegram_username TEXT,
  discord_id TEXT,
  link_code TEXT,
  link_code_expires_at INTEGER,
  active INTEGER DEFAULT 0,
  activated_at INTEGER,
  expires_at INTEGER,
  last_payment_payload TEXT,
  last_payment_charge_id TEXT,
  last_notified_expired_at INTEGER
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  telegram_username TEXT,
  amount INTEGER,
  currency TEXT,
  payload TEXT,
  telegram_payment_charge_id TEXT,
  provider_payment_charge_id TEXT,
  paid_at INTEGER,
  expires_at INTEGER
);
`);

export function upsertTelegramUser(telegramId, username = '') {
  db.prepare(`
    INSERT INTO users (telegram_id, telegram_username)
    VALUES (?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET telegram_username = excluded.telegram_username
  `).run(String(telegramId), username || '');
}

export function createLinkCode(telegramId) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare(`
    INSERT INTO users (telegram_id, link_code, link_code_expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      link_code = excluded.link_code,
      link_code_expires_at = excluded.link_code_expires_at
  `).run(String(telegramId), code, expires);
  return code;
}

export function connectDiscord(code, discordId) {
  const row = db.prepare('SELECT * FROM users WHERE link_code = ?').get(code);
  if (!row) return { ok: false, reason: 'Codice non valido.' };
  if (!row.link_code_expires_at || Number(row.link_code_expires_at) < Date.now()) {
    return { ok: false, reason: 'Codice scaduto. Generane uno nuovo su Telegram.' };
  }
  db.prepare('UPDATE users SET discord_id = ?, link_code = NULL, link_code_expires_at = NULL WHERE telegram_id = ?')
    .run(String(discordId), row.telegram_id);
  return { ok: true, telegramId: row.telegram_id };
}

export function activateVip(telegramId, username, durationDays, payment) {
  const now = Date.now();
  const current = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  const base = current?.expires_at && Number(current.expires_at) > now ? Number(current.expires_at) : now;
  const expires = base + Number(durationDays) * 24 * 60 * 60 * 1000;

  const totalAmount = payment?.total_amount || 0;
  const currency = payment?.currency || 'XTR';
  const payload = payment?.invoice_payload || '';
  const telegramCharge = payment?.telegram_payment_charge_id || '';
  const providerCharge = payment?.provider_payment_charge_id || '';

  db.prepare(`
    INSERT INTO users (telegram_id, telegram_username, active, activated_at, expires_at, last_payment_payload, last_payment_charge_id, last_notified_expired_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, NULL)
    ON CONFLICT(telegram_id) DO UPDATE SET
      telegram_username = excluded.telegram_username,
      active = 1,
      activated_at = excluded.activated_at,
      expires_at = excluded.expires_at,
      last_payment_payload = excluded.last_payment_payload,
      last_payment_charge_id = excluded.last_payment_charge_id,
      last_notified_expired_at = NULL
  `).run(String(telegramId), username || '', now, expires, payload, telegramCharge);

  db.prepare(`
    INSERT INTO payments (telegram_id, telegram_username, amount, currency, payload, telegram_payment_charge_id, provider_payment_charge_id, paid_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(String(telegramId), username || '', totalAmount, currency, payload, telegramCharge, providerCharge, now, expires);

  return expires;
}

export function getSubByTelegram(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
}

export function getSubByDiscord(discordId) {
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(String(discordId));
}

export function allLinkedSubs() {
  return db.prepare('SELECT * FROM users WHERE discord_id IS NOT NULL').all();
}

export function activeVipSubs() {
  return db.prepare('SELECT * FROM users WHERE active = 1 AND expires_at > ? ORDER BY expires_at ASC').all(Date.now());
}

export function expiredVipSubs() {
  return db.prepare(`
    SELECT * FROM users
    WHERE discord_id IS NOT NULL
      AND expires_at IS NOT NULL
      AND expires_at <= ?
      AND last_notified_expired_at IS NULL
    ORDER BY expires_at ASC
  `).all(Date.now());
}

export function deactivateExpiredVip(telegramId) {
  db.prepare('UPDATE users SET active = 0, last_notified_expired_at = ? WHERE telegram_id = ?')
    .run(Date.now(), String(telegramId));
}

export function expireOldSubs() {
  db.prepare('UPDATE users SET active = 0 WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?').run(Date.now());
}
