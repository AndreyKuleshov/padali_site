import pg from 'pg'
import config from '../config.js'

/**
 * Числовые типы Postgres приходят строками, чтобы не терять точность
 * на bigint. Нам это не нужно: id и счётчики помещаются в Number.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value))
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value))

let pool = null

function getPool (overrides = {}) {
  if (!pool) {
    pool = new pg.Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      // Приложение живёт в своей схеме внутри общей базы.
      options: `-c search_path=${config.db.schema},public`,
      max: 10,
      idleTimeoutMillis: 30_000,
      ...overrides
    })
  }
  return pool
}

/**
 * Репозитории пишут запросы с `?` — привычно и позволяет собирать
 * IN-списки одним помощником. Драйверу нужны $1, $2, …, поэтому
 * плейсхолдеры нумеруются здесь. Знаки вопроса внутри строковых
 * литералов пропускаются.
 */
function toNumberedPlaceholders (sql) {
  let result = ''
  let index = 0
  let inString = false

  for (let position = 0; position < sql.length; position += 1) {
    const char = sql[position]

    if (char === "'") {
      // Удвоенная кавычка внутри строки — экранированная, не конец литерала.
      if (inString && sql[position + 1] === "'") {
        result += "''"
        position += 1
        continue
      }
      inString = !inString
      result += char
      continue
    }

    if (char === '?' && !inString) {
      index += 1
      result += `$${index}`
      continue
    }

    result += char
  }

  return result
}

async function query (sql, params = []) {
  const result = await getPool().query(toNumberedPlaceholders(sql), params)
  return result.rows
}

/** Выполняет fn в транзакции, передавая соединение. */
async function transaction (fn) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function closePool () {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export { getPool, query, transaction, closePool, toNumberedPlaceholders }
