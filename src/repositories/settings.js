import { db, parseJson } from './helpers.js'

/** Все настройки одним запросом: { key: value }. */
async function getAllSettings (conn) {
  const rows = await db(conn).all('SELECT `key`, value_json FROM settings')
  const settings = {}
  for (const row of rows) settings[row.key] = parseJson(row.value_json, null)
  return settings
}

async function getSetting (key, fallback = null, conn) {
  const row = await db(conn).one('SELECT value_json FROM settings WHERE `key` = ?', [key])
  return row ? parseJson(row.value_json, fallback) : fallback
}

async function setSetting (key, value, conn) {
  await db(conn).run(
    'INSERT INTO settings (`key`, value_json) VALUES (?, CAST(? AS JSON)) ' +
    'ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)',
    [key, JSON.stringify(value ?? null)]
  )
}

export { getAllSettings, getSetting, setSetting }
