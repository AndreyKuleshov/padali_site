import { getPool } from '../db/pool.js'

/**
 * Единая обёртка над пулом и над соединением внутри транзакции.
 * Репозитории принимают необязательный conn и работают одинаково
 * и сами по себе, и внутри transaction().
 */
function db (conn) {
  const target = conn ?? getPool()
  return {
    async all (sql, params = []) {
      const [rows] = await target.execute(sql, params)
      return rows
    },
    async one (sql, params = []) {
      const [rows] = await target.execute(sql, params)
      return rows[0] ?? null
    },
    async run (sql, params = []) {
      const [result] = await target.execute(sql, params)
      return result
    }
  }
}

/** `?, ?, ?` для IN-списка: execute не разворачивает массивы сам. */
function placeholders (count) {
  return Array.from({ length: count }, () => '?').join(', ')
}

/**
 * Строки (id, locale, field, value) → { [id]: { [locale]: { [field]: value } } }
 */
function groupTexts (rows, idKey) {
  const grouped = new Map()
  for (const row of rows) {
    const id = row[idKey]
    if (!grouped.has(id)) grouped.set(id, {})
    const byLocale = grouped.get(id)
    byLocale[row.locale] ??= {}
    byLocale[row.locale][row.field] = row.value
  }
  return grouped
}

/**
 * Полная перезапись переводов сущности: сначала удаляем, потом вставляем
 * непустые. Пустая строка означает «перевода нет» и в базу не попадает —
 * иначе фоллбэк на язык по умолчанию не сработает.
 */
async function replaceTexts (conn, { table, idColumn, id, textsByLocale }) {
  const runner = db(conn)
  await runner.run(`DELETE FROM ${table} WHERE ${idColumn} = ?`, [id])

  const values = []
  const params = []
  for (const [locale, fields] of Object.entries(textsByLocale ?? {})) {
    for (const [field, value] of Object.entries(fields ?? {})) {
      const trimmed = typeof value === 'string' ? value.trim() : ''
      if (trimmed === '') continue
      values.push('(?, ?, ?, ?)')
      params.push(id, locale, field, trimmed)
    }
  }
  if (values.length === 0) return

  await runner.run(
    `INSERT INTO ${table} (${idColumn}, locale, field, value) VALUES ${values.join(', ')}`,
    params
  )
}

/** MySQL возвращает JSON-колонки объектами, но на всякий случай страхуемся. */
function parseJson (value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export { db, placeholders, groupTexts, replaceTexts, parseJson }
