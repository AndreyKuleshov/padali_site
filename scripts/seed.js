#!/usr/bin/env node
import { migrate, waitForDatabase } from '../src/db/migrate.js'
import { ensureSeeded } from '../src/services/seed.js'
import { bootstrapAdminUser } from '../src/services/auth.js'
import { closePool } from '../src/db/pool.js'

try {
  await waitForDatabase()
  await migrate()
  const seeded = await ensureSeeded()
  await bootstrapAdminUser()
  console.log(seeded ? 'Готово: контент перенесён.' : 'База уже наполнена — ничего не делал.')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await closePool()
}
