import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import config from '../config.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Имя схемы приходит из конфигурации, но в SQL попадает только проверенное. */
function safeSchema (name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Недопустимое имя схемы: «${name}». Разрешены строчные латинские буквы, цифры и подчёркивание.`)
  }
  return name
}

async function connect () {
  const client = new pg.Client({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password
  })
  await client.connect()
  return client
}

/**
 * Ждёт, пока база начнёт принимать соединения.
 * Нужно там, где оркестратор поднимает приложение раньше базы.
 */
async function waitForDatabase ({ attempts = 30, delayMs = 2000, logger = console } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const client = await connect()
      await client.end()
      return
    } catch (error) {
      if (attempt === attempts) throw error
      logger.warn?.(`База недоступна (попытка ${attempt}/${attempts}): ${error.code ?? error.message}`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

async function ensureSchema (client, schema) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
  await client.query(`SET search_path TO ${schema}, public`)
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name       VARCHAR(190) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

/**
 * Применяет ещё не применённые .sql-файлы по возрастанию имени.
 * Повторный прогон не делает ничего — раннер идемпотентен.
 */
async function migrate ({ logger = console } = {}) {
  const schema = safeSchema(config.db.schema)
  const client = await connect()

  try {
    await ensureSchema(client, schema)

    const applied = new Set(
      (await client.query('SELECT name FROM migrations')).rows.map((row) => row.name)
    )
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort()
    const pending = files.filter((name) => !applied.has(name))

    if (pending.length === 0) {
      logger.info?.('Миграции: всё применено.')
      return []
    }

    for (const name of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
      logger.info?.(`Миграция: ${name}`)
      // В Postgres DDL транзакционен: неудачная миграция откатывается целиком.
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }

    logger.info?.(`Миграции: применено ${pending.length}.`)
    return pending
  } finally {
    await client.end()
  }
}

export { migrate, waitForDatabase, safeSchema }

// Запуск из CLI: npm run migrate
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  waitForDatabase()
    .then(() => migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
