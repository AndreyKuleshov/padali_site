import { db, placeholders, groupTexts, replaceTexts, parseJson } from './helpers.js'

function hydrate (row) {
  return {
    id: row.id,
    pageId: row.page_id,
    type: row.type,
    position: row.position,
    isVisible: row.is_visible === 1,
    anchor: row.anchor,
    settings: parseJson(row.settings, {})
  }
}

async function listBlocks (pageId, { visibleOnly = false } = {}, conn) {
  const rows = await db(conn).all(
    'SELECT id, page_id, type, position, is_visible, anchor, settings FROM blocks ' +
    `WHERE page_id = ?${visibleOnly ? ' AND is_visible = 1' : ''} ` +
    'ORDER BY position, id',
    [pageId]
  )
  return rows.map(hydrate)
}

async function getBlock (id, conn) {
  const row = await db(conn).one(
    'SELECT id, page_id, type, position, is_visible, anchor, settings FROM blocks WHERE id = ?',
    [id]
  )
  return row ? hydrate(row) : null
}

/** Новый блок встаёт в конец страницы. */
async function createBlock ({ pageId, type, settings = {}, anchor = null, isVisible = true }, conn) {
  const runner = db(conn)
  const last = await runner.one(
    'SELECT COALESCE(MAX(position), -1) AS maxPosition FROM blocks WHERE page_id = ?',
    [pageId]
  )
  const result = await runner.run(
    'INSERT INTO blocks (page_id, type, position, is_visible, anchor, settings) ' +
    'VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))',
    [pageId, type, Number(last.maxPosition) + 1, isVisible ? 1 : 0, anchor, JSON.stringify(settings)]
  )
  return result.insertId
}

async function updateBlock (id, { settings, anchor, isVisible }, conn) {
  await db(conn).run(
    'UPDATE blocks SET settings = CAST(? AS JSON), anchor = ?, is_visible = ? WHERE id = ?',
    [JSON.stringify(settings ?? {}), anchor || null, isVisible ? 1 : 0, id]
  )
}

async function setBlockVisibility (id, isVisible, conn) {
  await db(conn).run('UPDATE blocks SET is_visible = ? WHERE id = ?', [isVisible ? 1 : 0, id])
}

async function deleteBlock (id, conn) {
  await db(conn).run('DELETE FROM blocks WHERE id = ?', [id])
}

/** Порядок задаётся массивом id; чужие для страницы id игнорируются. */
async function reorderBlocks (pageId, orderedIds, conn) {
  const runner = db(conn)
  for (const [index, id] of orderedIds.entries()) {
    await runner.run(
      'UPDATE blocks SET position = ? WHERE id = ? AND page_id = ?',
      [index, id, pageId]
    )
  }
}

/** → Map<blockId, { [locale]: { [field]: value } }> */
async function textsForBlocks (blockIds, conn) {
  if (blockIds.length === 0) return new Map()
  const rows = await db(conn).all(
    `SELECT block_id, locale, field, value FROM block_texts WHERE block_id IN (${placeholders(blockIds.length)})`,
    blockIds
  )
  return groupTexts(rows, 'block_id')
}

async function getBlockTexts (blockId, conn) {
  return (await textsForBlocks([blockId], conn)).get(blockId) ?? {}
}

async function saveBlockTexts (blockId, textsByLocale, conn) {
  await replaceTexts(conn, {
    table: 'block_texts', idColumn: 'block_id', id: blockId, textsByLocale
  })
}

/** → Map<blockId, { [field]: mediaId[] }> с сохранением порядка. */
async function mediaForBlocks (blockIds, conn) {
  if (blockIds.length === 0) return new Map()
  const rows = await db(conn).all(
    'SELECT block_id, field, position, media_id FROM block_media ' +
    `WHERE block_id IN (${placeholders(blockIds.length)}) ORDER BY field, position`,
    blockIds
  )
  const grouped = new Map()
  for (const row of rows) {
    if (!grouped.has(row.block_id)) grouped.set(row.block_id, {})
    const byField = grouped.get(row.block_id)
    byField[row.field] ??= []
    byField[row.field].push(row.media_id)
  }
  return grouped
}

async function getBlockMedia (blockId, conn) {
  return (await mediaForBlocks([blockId], conn)).get(blockId) ?? {}
}

/** Полная перезапись связей блока с картинками. */
async function saveBlockMedia (blockId, mediaByField, conn) {
  const runner = db(conn)
  await runner.run('DELETE FROM block_media WHERE block_id = ?', [blockId])

  const values = []
  const params = []
  for (const [field, ids] of Object.entries(mediaByField ?? {})) {
    const list = Array.isArray(ids) ? ids : [ids]
    list.filter(Boolean).forEach((mediaId, index) => {
      values.push('(?, ?, ?, ?)')
      params.push(blockId, field, index, Number(mediaId))
    })
  }
  if (values.length === 0) return

  await runner.run(
    `INSERT INTO block_media (block_id, field, position, media_id) VALUES ${values.join(', ')}`,
    params
  )
}

export {
  listBlocks, getBlock, createBlock, updateBlock, setBlockVisibility,
  deleteBlock, reorderBlocks,
  textsForBlocks, getBlockTexts, saveBlockTexts,
  mediaForBlocks, getBlockMedia, saveBlockMedia
}
