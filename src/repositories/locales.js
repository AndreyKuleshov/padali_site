import { db } from './helpers.js'

async function listLocales (conn) {
  return db(conn).all(
    'SELECT code, title, is_default, position FROM locales ORDER BY position, code'
  )
}

async function getDefaultLocale (conn) {
  const row = await db(conn).one(
    'SELECT code FROM locales WHERE is_default = 1 ORDER BY position LIMIT 1'
  )
  return row?.code ?? 'en'
}

async function localeExists (code, conn) {
  const row = await db(conn).one('SELECT code FROM locales WHERE code = ?', [code])
  return row != null
}

export { listLocales, getDefaultLocale, localeExists }
