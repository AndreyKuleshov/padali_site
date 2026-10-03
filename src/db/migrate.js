import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import config from '../config.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * Соединение с multipleStatements: файл миграции выполняется целиком,
 * чтобы не разбирать SQL на выражения вручную.
 */
async function connect (overrides = {}) {
  return mysql.createConnection({
    ...config.db,
    ...overrides,
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci'
  })
}

/**
 * Ждёт, пока база начнёт принимать соединения.
 * Нужно там, где оркестратор поднимает приложение раньше базы.
 */
async function waitForDatabase ({ attempts = 30, delayMs = 2000, logger = console } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const connection = await connect()
      await connection.end()
      return
    } catch (error) {
      if (attempt === attempts) throw error
      logger.warn?.(`База недоступна (попытка ${attempt}/${attempts}): ${error.code ?? error.message}`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

async function ensureMigrationsTable (connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name       VARCHAR(190) NOT NULL,
      applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

/**
 * Применяет ещё не применённые .sql-файлы по возрастанию имени.
 * Повторный прогон не делает ничего — раннер идемпотентен.
 */
async function migrate ({ logger = console } = {}) {
  const connection = await connect()
  try {
    await ensureMigrationsTable(connection)

    const [appliedRows] = await connection.query('SELECT name FROM migrations')
    const applied = new Set(appliedRows.map((row) => row.name))

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith('.sql'))
      .sort()

    const pending = files.filter((name) => !applied.has(name))
    if (pending.length === 0) {
      logger.info?.('Миграции: всё применено.')
      return []
    }

    for (const name of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
      logger.info?.(`Миграция: ${name}`)
      // DDL в MySQL не транзакционен, поэтому откат невозможен:
      // при ошибке падаем и не отмечаем миграцию применённой.
      await connection.query(sql)
      await connection.query('INSERT INTO migrations (name) VALUES (?)', [name])
    }

    logger.info?.(`Миграции: применено ${pending.length}.`)
    return pending
  } finally {
    await connection.end()
  }
}

export { migrate, waitForDatabase }

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
