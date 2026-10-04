import { db } from './helpers.js'

async function listLocales (conn) {
  return db(conn).all(
    'SELECT code, title, is_default, position FROM locales ORDER BY position, code'
  )
}

async function getDefaultLocale (conn) {
  const row = await db(conn).one(
    'SELECT code FROM locales WHERE is_default ORDER BY position LIMIT 1'
  )
  return row?.code ?? 'en'
}

/** Заводит язык, если его ещё нет. Повторный вызов ничего не меняет. */
async function ensureLocale ({ code, title, isDefault = false, position = 0 }, conn) {
  await db(conn).run(
    'INSERT INTO locales (code, title, is_default, position) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT (code) DO NOTHING',
    [code, title, isDefault, position]
  )
}

export { listLocales, getDefaultLocale, ensureLocale }
