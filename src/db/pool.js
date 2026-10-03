import mysql from 'mysql2/promise'
import config from '../config.js'

let pool = null

/** Ленивое создание пула: тесты могут подменить конфигурацию до первого вызова. */
function getPool (overrides = {}) {
  if (!pool) {
    pool = mysql.createPool({
      ...config.db,
      ...overrides,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4_unicode_ci',
      timezone: 'Z',
      // Даты отдаём строками: иначе mysql2 сдвигает DATE на часовой пояс.
      dateStrings: ['DATE'],
      namedPlaceholders: false
    })
  }
  return pool
}

async function query (sql, params = []) {
  const [rows] = await getPool().execute(sql, params)
  return rows
}

/** Первая строка результата или null. */
async function queryOne (sql, params = []) {
  const rows = await query(sql, params)
  return rows[0] ?? null
}

/**
 * Выполняет fn в транзакции, передавая соединение.
 * Коммитит при успехе, откатывает при исключении.
 */
async function transaction (fn) {
  const connection = await getPool().getConnection()
  try {
    await connection.beginTransaction()
    const result = await fn(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function closePool () {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export { getPool, query, queryOne, transaction, closePool }
