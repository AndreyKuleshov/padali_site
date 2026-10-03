import { db, placeholders, groupTexts, replaceTexts, jsonValue } from './helpers.js'

function hydrate (row) {
  return {
    id: row.id,
    path: row.path,
    mime: row.mime,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    hash: row.hash,
    originalName: row.original_name,
    derivatives: jsonValue(row.derivatives, []),
    managedKey: row.managed_key,
    createdAt: row.created_at
  }
}

const COLUMNS =
  'id, path, mime, width, height, bytes, hash, original_name, derivatives, managed_key, created_at'

async function findMediaByHash (hash, conn) {
  const row = await db(conn).one(`SELECT ${COLUMNS} FROM media WHERE hash = ?`, [hash])
  return row ? hydrate(row) : null
}

async function getMedia (id, conn) {
  const row = await db(conn).one(`SELECT ${COLUMNS} FROM media WHERE id = ?`, [id])
  return row ? hydrate(row) : null
}

async function getMediaByIds (ids, conn) {
  if (ids.length === 0) return new Map()
  const rows = await db(conn).all(
    `SELECT ${COLUMNS} FROM media WHERE id IN (${placeholders(ids.length)})`,
    ids
  )
  return new Map(rows.map((row) => [row.id, hydrate(row)]))
}

async function listMedia ({ limit = 200, offset = 0 } = {}, conn) {
  // LIMIT/OFFSET не биндятся в подготовленных выражениях — приводим к целым сами.
  const take = Math.min(Math.max(Number.parseInt(limit, 10) || 0, 1), 500)
  const skip = Math.max(Number.parseInt(offset, 10) || 0, 0)
  const rows = await db(conn).all(
    `SELECT ${COLUMNS} FROM media ORDER BY created_at DESC, id DESC LIMIT ${take} OFFSET ${skip}`
  )
  return rows.map(hydrate)
}

async function countMedia (conn) {
  const row = await db(conn).one('SELECT COUNT(*) AS total FROM media')
  return Number(row.total)
}

async function insertMedia (record, conn) {
  return db(conn).insert(
    'INSERT INTO media (path, mime, width, height, bytes, hash, original_name, derivatives, managed_key) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?) RETURNING id',
    [
      record.path, record.mime, record.width, record.height, record.bytes,
      record.hash, record.originalName, JSON.stringify(record.derivatives ?? []),
      record.managedKey ?? null
    ]
  )
}

/** Запись, которой управляет репозиторий: ключ = имя файла в seed-assets. */
async function getMediaByManagedKey (key, conn) {
  const row = await db(conn).one(`SELECT ${COLUMNS} FROM media WHERE managed_key = ?`, [key])
  return row ? hydrate(row) : null
}

/**
 * Заменяет содержимое записи, сохраняя её идентификатор: все ссылки
 * из блоков и альбомов продолжают работать и показывают новый файл.
 */
async function updateMediaFile (id, record, conn) {
  await db(conn).run(
    'UPDATE media SET path = ?, mime = ?, width = ?, height = ?, bytes = ?, ' +
    'hash = ?, original_name = ?, derivatives = ?::jsonb WHERE id = ?',
    [
      record.path, record.mime, record.width, record.height, record.bytes,
      record.hash, record.originalName, JSON.stringify(record.derivatives ?? []), id
    ]
  )
}

async function textsForMedia (ids, conn) {
  if (ids.length === 0) return new Map()
  const rows = await db(conn).all(
    `SELECT media_id, locale, field, value FROM media_texts WHERE media_id IN (${placeholders(ids.length)})`,
    ids
  )
  return groupTexts(rows, 'media_id')
}

async function getMediaTexts (id, conn) {
  return (await textsForMedia([id], conn)).get(id) ?? {}
}

async function saveMediaTexts (id, textsByLocale, conn) {
  await replaceTexts(conn, {
    table: 'media_texts', idColumn: 'media_id', id, textsByLocale
  })
}

/**
 * Где используется файл. Удалять можно только то, на что никто не ссылается:
 * в схеме стоит RESTRICT, но понятную ошибку лучше отдать до запроса в базу.
 */
async function mediaUsage (id, conn) {
  const runner = db(conn)
  const inBlocks = await runner.all(
    'SELECT DISTINCT b.id, b.type FROM block_media bm JOIN blocks b ON b.id = bm.block_id WHERE bm.media_id = ?',
    [id]
  )
  const inGalleries = await runner.all(
    'SELECT DISTINCT g.id, g.slug FROM gallery_items gi JOIN galleries g ON g.id = gi.gallery_id WHERE gi.media_id = ?',
    [id]
  )
  return { blocks: inBlocks, galleries: inGalleries, isUsed: inBlocks.length + inGalleries.length > 0 }
}

/** Количество использований сразу для списка файлов — для медиатеки. */
async function usageCounts (ids, conn) {
  if (ids.length === 0) return new Map()
  const list = placeholders(ids.length)
  const rows = await db(conn).all(
    `SELECT media_id, SUM(uses) AS uses FROM (
       SELECT media_id, COUNT(*) AS uses FROM block_media   WHERE media_id IN (${list}) GROUP BY media_id
       UNION ALL
       SELECT media_id, COUNT(*) AS uses FROM gallery_items WHERE media_id IN (${list}) GROUP BY media_id
     ) AS combined GROUP BY media_id`,
    [...ids, ...ids]
  )
  return new Map(rows.map((row) => [row.media_id, Number(row.uses)]))
}

async function deleteMedia (id, conn) {
  await db(conn).run('DELETE FROM media WHERE id = ?', [id])
}

export {
  findMediaByHash, getMedia, getMediaByIds, getMediaByManagedKey,
  listMedia, countMedia, insertMedia, updateMediaFile,
  textsForMedia, getMediaTexts, saveMediaTexts,
  mediaUsage, usageCounts, deleteMedia
}
