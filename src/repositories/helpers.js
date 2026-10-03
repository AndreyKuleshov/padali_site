import { getPool, toNumberedPlaceholders } from '../db/pool.js'

/**
 * Единая обёртка над пулом и над соединением внутри транзакции.
 * Репозитории принимают необязательный conn и работают одинаково
 * и сами по себе, и внутри transaction().
 */
function db (conn) {
  const target = conn ?? getPool()
  const run = async (sql, params = []) => target.query(toNumberedPlaceholders(sql), params)

  return {
    async all (sql, params = []) {
      return (await run(sql, params)).rows
    },
    async one (sql, params = []) {
      return (await run(sql, params)).rows[0] ?? null
    },
    async run (sql, params = []) {
      const result = await run(sql, params)
      return { rowCount: result.rowCount, rows: result.rows }
    },
    /** Идентификатор вставленной строки: INSERT ... RETURNING id. */
    async insert (sql, params = []) {
      const result = await run(sql, params)
      return result.rows[0]?.id ?? null
    }
  }
}

/** `?, ?, ?` для IN-списка: нумерацию плейсхолдеров делает пул. */
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

/**
 * Значение колонки jsonb. Драйвер разбирает её сам: объекты, массивы,
 * числа, строки и булевы приходят готовыми. Разбирать повторно нельзя —
 * строка вроде «padali.band» корректным JSON не является и потерялась бы.
 */
function jsonValue (value, fallback) {
  return value ?? fallback
}

export { db, placeholders, groupTexts, replaceTexts, jsonValue }
