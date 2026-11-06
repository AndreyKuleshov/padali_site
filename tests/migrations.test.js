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
    [config.db.schema]
  )
  const tables = new Set(rows.map((row) => row.name))

  for (const expected of [
    'locales', 'settings', 'media', 'media_texts', 'galleries', 'gallery_texts',
    'gallery_items', 'pages', 'page_texts', 'blocks', 'block_texts', 'block_media',
    'concert_events', 'concert_event_texts',
    'admin_users', 'sessions', 'migrations'
  ]) {
    assert.ok(tables.has(expected), `нет таблицы ${expected}`)
  }
})

test('тексты и медиа блока удаляются вместе с блоком', async () => {
  await migrate({ logger: silent })
  const rows = await query(
    'SELECT delete_rule AS "deleteRule" FROM information_schema.referential_constraints ' +
    'WHERE constraint_schema = ? AND constraint_name = ?',
    [config.db.schema, 'fk_block_texts_block']
  )
  assert.equal(rows[0].deleteRule, 'CASCADE')
})

/* Концерт стал списком (миграция 011). Сегодня этот список уже
   убран миграцией 012 — концерты приходят из Bandsintown, — но
   база, отстающая на две миграции, проходит через обе по очереди,
   и первая обязана отработать прежде второй. */
test('старый концерт переезжает в первое событие списка', async () => {
  const { query } = await import('../src/db/pool.js')
  const { createPage } = await import('../src/repositories/pages.js')
  const { createBlock, saveBlockTexts, saveBlockMedia, getBlock } = await import('../src/repositories/blocks.js')
  const { processUpload } = await import('../src/services/media-processor.js')
  const { makeImage } = await import('./helpers.js')

  const pageId = await createPage({ slug: 'migration-011' })
  const { media } = await processUpload({
    buffer: await makeImage({ width: 400, height: 500, seed: 91 }),
    originalName: 'poster.png', mime: 'image/png'
  })

  // Блок в прежнем виде: поля события лежат прямо на блоке.
  const id = await createBlock({
    pageId, type: 'concert', anchor: 'concert',
    settings: { date: '2026-10-16', tickets: 'link', ticket_url: 'https://tickets.example/x', price: '1000 RSD' }
  })
  await saveBlockTexts(id, { en: { venue: 'Novi Sad', note: 'С гостями', heading: 'Concert' } })
  await saveBlockMedia(id, { poster: [media.id] })

  // Та же команда, что в миграции.
  await query(
    "UPDATE blocks SET settings = (settings - 'date' - 'tickets' - 'ticket_url' - 'price')" +
    " || jsonb_build_object('events', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(" +
    "   'date', settings ->> 'date'," +
    "   'tickets', COALESCE(settings ->> 'tickets', 'link')," +
    "   'ticket_url', COALESCE(settings ->> 'ticket_url', '')," +
    "   'price', COALESCE(settings ->> 'price', '')" +
    " )))) WHERE type = 'concert' AND settings -> 'events' IS NULL"
  )
  await query(
    "UPDATE block_texts SET field = 'events.0.' || field" +
    " WHERE field IN ('venue', 'note', 'tag', 'ticket_label')" +
    " AND block_id IN (SELECT id FROM blocks WHERE type = 'concert')"
  )
  await query(
    "UPDATE block_media SET field = 'events.0.poster' WHERE field = 'poster'" +
    " AND block_id IN (SELECT id FROM blocks WHERE type = 'concert')"
  )

  const moved = await getBlock(id)
  assert.equal(moved.settings.events.length, 1)
  assert.equal(moved.settings.events[0].date, '2026-10-16')
  assert.equal(moved.settings.events[0].price, '1000 RSD')
  assert.equal(moved.settings.events[0].ticket_url, 'https://tickets.example/x')
  assert.equal(moved.settings.date, undefined, 'старые ключи убраны')

  const texts = await query('SELECT field FROM block_texts WHERE block_id = ? ORDER BY field', [id])
  assert.deepEqual(texts.map((row) => row.field), ['events.0.note', 'events.0.venue', 'heading'],
    'заголовок остаётся у блока, остальное переезжает в событие')

  const posters = await query('SELECT field FROM block_media WHERE block_id = ?', [id])
  assert.deepEqual(posters.map((row) => row.field), ['events.0.poster'])
})

test('используемую картинку база удалить не даст', async () => {
  await migrate({ logger: silent })
  const rows = await query(
    'SELECT delete_rule AS "deleteRule" FROM information_schema.referential_constraints ' +
    'WHERE constraint_schema = ? AND constraint_name IN (?, ?)',
    [config.db.schema, 'fk_block_media_media', 'fk_gallery_items_media']
  )
  assert.equal(rows.length, 2)
  for (const row of rows) assert.equal(row.deleteRule, 'RESTRICT')
})


/* Концерты уехали из блока в свою таблицу (миграция 012). Правила
   удаления у неё те же, что у остальных: перевод уходит с
   событием, а афишу база не даст удалить, пока она где-то стоит. */
test('у таблицы концертов те же правила удаления, что у прочих', async () => {
  await migrate({ logger: silent })
  const rows = await query(
    'SELECT constraint_name AS name, delete_rule AS "deleteRule" ' +
    'FROM information_schema.referential_constraints ' +
    'WHERE constraint_schema = ? AND constraint_name IN (?, ?)',
    [config.db.schema, 'fk_concert_event_texts_event', 'fk_concert_events_poster']
  )
  const rules = Object.fromEntries(rows.map((row) => [row.name, row.deleteRule]))

  assert.equal(rules.fk_concert_event_texts_event, 'CASCADE', 'перевод уходит с событием')
  assert.equal(rules.fk_concert_events_poster, 'RESTRICT', 'афишу не удалить, пока она стоит у концерта')
})

/* Прежние концерты, заведённые руками, миграция убирает. Показать
   их больше негде — у блока не осталось полей под них, — а афиша,
   оставшаяся в block_media, навсегда числилась бы занятой и не
   удалялась бы из медиатеки. */
test('ручные концерты и их афиши миграция убирает', async () => {
  const { createPage } = await import('../src/repositories/pages.js')
  const { createBlock, saveBlockTexts, saveBlockMedia, getBlock } = await import('../src/repositories/blocks.js')
  const { processUpload } = await import('../src/services/media-processor.js')
  const { makeImage } = await import('./helpers.js')

  await migrate({ logger: silent })
  const pageId = await createPage({ slug: 'migration-012' })
  const { media } = await processUpload({
    buffer: await makeImage({ width: 400, height: 500, seed: 92 }),
    originalName: 'poster-old.png', mime: 'image/png'
  })

  const id = await createBlock({
    pageId, type: 'concert', anchor: 'concert',
    settings: { events: [{ date: '2026-10-16', price: '1000 RSD' }] }
  })
  await saveBlockTexts(id, { en: { 'events.0.venue': 'Novi Sad', heading: 'Concert' } })
  await saveBlockMedia(id, { 'events.0.poster': [media.id] })

  // Те же команды, что в миграции.
  await query("DELETE FROM block_media WHERE field LIKE 'events.%'" +
    " AND block_id IN (SELECT id FROM blocks WHERE type = 'concert')")
  await query("DELETE FROM block_texts WHERE field LIKE 'events.%'" +
    " AND block_id IN (SELECT id FROM blocks WHERE type = 'concert')")
  await query("UPDATE blocks SET settings = settings - 'events' WHERE type = 'concert'")

  const cleaned = await getBlock(id)
  assert.equal(cleaned.settings.events, undefined, 'список событий убран из блока')

  const texts = await query('SELECT field FROM block_texts WHERE block_id = ? ORDER BY field', [id])
  assert.deepEqual(texts.map((row) => row.field), ['heading'],
    'заголовок блока остаётся, поля событий уходят')

  const posters = await query('SELECT field FROM block_media WHERE block_id = ?', [id])
  assert.deepEqual(posters, [], 'афиша отвязана — медиатека снова даст её удалить')
})
