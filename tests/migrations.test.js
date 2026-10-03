import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { migrate } from '../src/db/migrate.js'
import { query, closePool } from '../src/db/pool.js'
import config from '../src/config.js'

const silent = { info () {}, warn () {} }

after(async () => { await closePool() })

test('миграции применяются и повторный прогон ничего не делает', async () => {
  await migrate({ logger: silent })
  const second = await migrate({ logger: silent })
  assert.deepEqual(second, [], 'во второй раз применять нечего')
})

test('схема содержит все нужные таблицы', async () => {
  await migrate({ logger: silent })
  const rows = await query(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
    [config.db.database]
  )
  const tables = new Set(rows.map((row) => row.name))

  for (const expected of [
    'locales', 'settings', 'media', 'media_texts', 'galleries', 'gallery_texts',
    'gallery_items', 'pages', 'page_texts', 'blocks', 'block_texts', 'block_media',
    'admin_users', 'sessions', 'migrations'
  ]) {
    assert.ok(tables.has(expected), `нет таблицы ${expected}`)
  }
})

test('тексты и медиа блока удаляются вместе с блоком', async () => {
  await migrate({ logger: silent })
  const rows = await query(
    'SELECT delete_rule AS deleteRule FROM information_schema.referential_constraints ' +
    'WHERE constraint_schema = ? AND constraint_name = ?',
    [config.db.database, 'fk_block_texts_block']
  )
  assert.equal(rows[0].deleteRule, 'CASCADE')
})

test('используемую картинку база удалить не даст', async () => {
  await migrate({ logger: silent })
  const rows = await query(
    'SELECT delete_rule AS deleteRule FROM information_schema.referential_constraints ' +
    'WHERE constraint_schema = ? AND constraint_name IN (?, ?)',
    [config.db.database, 'fk_block_media_media', 'fk_gallery_items_media']
  )
  assert.equal(rows.length, 2)
  for (const row of rows) assert.equal(row.deleteRule, 'RESTRICT')
})
