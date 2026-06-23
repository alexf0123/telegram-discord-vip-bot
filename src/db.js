import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = process.env.DATABASE_PATH || './data/database.sqlite';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS vip_users (
  telegram_id TEXT PRIMARY KEY,
  telegram_username TEXT,
  discord_id TEXT,
  active INTEGER DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT,
  payload TEXT,
  amount INTEGER,
  currency TEXT,
  raw_json TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
`);

export function upsertTelegramUser(telegramId, username = '') {
  db.prepare(`INSERT INTO vip_users (telegram_id, telegram_username, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET telegram_username=excluded.telegram_username, updated_at=excluded.updated_at`).run(String(telegramId), username || '', Date.now());
}

export function createLinkCode(telegramId) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare('INSERT INTO link_codes (code, telegram_id, expires_at, used) VALUES (?, ?, ?, 0)').run(code, String(telegramId), expires);
  return code;
}

export function connectDiscord(code, discordId) {
  const row = db.prepare('SELECT * FROM link_codes WHERE code=?').get(String(code).trim().toUpperCase());
  if (!row) return { ok: false, reason: 'Codice non valido.' };
  if (row.used) return { ok: false, reason: 'Codice già usato.' };
  if (Number(row.expires_at) < Date.now()) return { ok: false, reason: 'Codice scaduto. Generane uno nuovo su Telegram.' };
  db.prepare('UPDATE link_codes SET used=1 WHERE code=?').run(row.code);
  db.prepare(`INSERT INTO vip_users (telegram_id, discord_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET discord_id=excluded.discord_id, updated_at=excluded.updated_at`).run(row.telegram_id, String(discordId), Date.now());
  return { ok: true, telegramId: row.telegram_id };
}

export function activateVip(telegramId, username, days = 30, payment = null) {
  const current = db.prepare('SELECT expires_at FROM vip_users WHERE telegram_id=?').get(String(telegramId));
  const base = current?.expires_at && Number(current.expires_at) > Date.now() ? Number(current.expires_at) : Date.now();
  const expires = base + Number(days) * 24 * 60 * 60 * 1000;
  db.prepare(`INSERT INTO vip_users (telegram_id, telegram_username, active, expires_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET telegram_username=excluded.telegram_username, active=1, expires_at=excluded.expires_at, updated_at=excluded.updated_at`).run(String(telegramId), username || '', expires, Date.now());
  if (payment) db.prepare('INSERT INTO payment_events (telegram_id, payload, amount, currency, raw_json) VALUES (?, ?, ?, ?, ?)')
    .run(String(telegramId), payment.payload || '', payment.total_amount || 0, payment.currency || '', JSON.stringify(payment));
  return expires;
}

export function getSubByTelegram(telegramId) {
  return db.prepare('SELECT * FROM vip_users WHERE telegram_id=?').get(String(telegramId));
}

export function getSubByDiscord(discordId) {
  return db.prepare('SELECT * FROM vip_users WHERE discord_id=?').get(String(discordId));
}

export function allLinkedSubs() {
  return db.prepare('SELECT * FROM vip_users WHERE discord_id IS NOT NULL').all();
}

export function expireOldSubs() {
  db.prepare('UPDATE vip_users SET active=0, updated_at=? WHERE active=1 AND expires_at IS NOT NULL AND expires_at < ?').run(Date.now(), Date.now());
}
