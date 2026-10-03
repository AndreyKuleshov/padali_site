import { db, placeholders, groupTexts, replaceTexts } from './helpers.js'

async function listGalleries (conn) {
  return db(conn).all(
    'SELECT g.id, g.slug, g.updated_at, COUNT(gi.media_id) AS item_count ' +
    'FROM galleries g LEFT JOIN gallery_items gi ON gi.gallery_id = g.id ' +
    'GROUP BY g.id, g.slug, g.updated_at ORDER BY g.slug'
  )
}

async function getGallery (id, conn) {
  return db(conn).one('SELECT id, slug FROM galleries WHERE id = ?', [id])
}

async function getGalleryBySlug (slug, conn) {
  return db(conn).one('SELECT id, slug FROM galleries WHERE slug = ?', [slug])
}

async function createGallery (slug, conn) {
  return db(conn).insert('INSERT INTO galleries (slug) VALUES (?) RETURNING id', [slug])
}

async function renameGallery (id, slug, conn) {
  await db(conn).run('UPDATE galleries SET slug = ? WHERE id = ?', [slug, id])
}

async function deleteGallery (id, conn) {
  await db(conn).run('DELETE FROM galleries WHERE id = ?', [id])
}

async function textsForGalleries (ids, conn) {
  if (ids.length === 0) return new Map()
  const rows = await db(conn).all(
    `SELECT gallery_id, locale, field, value FROM gallery_texts WHERE gallery_id IN (${placeholders(ids.length)})`,
    ids
  )
  return groupTexts(rows, 'gallery_id')
}

async function getGalleryTexts (id, conn) {
  return (await textsForGalleries([id], conn)).get(id) ?? {}
}

async function saveGalleryTexts (id, textsByLocale, conn) {
  await replaceTexts(conn, {
    table: 'gallery_texts', idColumn: 'gallery_id', id, textsByLocale
  })
}

/** → Map<galleryId, mediaId[]> в порядке показа. */
async function itemsForGalleries (ids, conn) {
  if (ids.length === 0) return new Map()
  const rows = await db(conn).all(
    `SELECT gallery_id, media_id FROM gallery_items WHERE gallery_id IN (${placeholders(ids.length)}) ` +
    'ORDER BY gallery_id, position, media_id',
    ids
  )
  const grouped = new Map()
  for (const row of rows) {
    if (!grouped.has(row.gallery_id)) grouped.set(row.gallery_id, [])
    grouped.get(row.gallery_id).push(row.media_id)
  }
  return grouped
}

async function getGalleryItems (id, conn) {
  return (await itemsForGalleries([id], conn)).get(id) ?? []
}

/**
 * Полная перезапись состава альбома. Порядок — порядок элементов массива.
 * Повторы отбрасываются: ключ таблицы (gallery_id, media_id).
 */
async function setGalleryItems (galleryId, mediaIds, conn) {
  const runner = db(conn)
  await runner.run('DELETE FROM gallery_items WHERE gallery_id = ?', [galleryId])

  const unique = [...new Set(mediaIds.map(Number).filter(Boolean))]
  if (unique.length === 0) return

  const values = unique.map(() => '(?, ?, ?)').join(', ')
  const params = unique.flatMap((mediaId, index) => [galleryId, mediaId, index])
  await runner.run(
    `INSERT INTO gallery_items (gallery_id, media_id, position) VALUES ${values}`,
    params
  )
  await runner.run('UPDATE galleries SET updated_at = now() WHERE id = ?', [galleryId])
}

export {
  listGalleries, getGallery, getGalleryBySlug, createGallery, renameGallery, deleteGallery,
  textsForGalleries, getGalleryTexts, saveGalleryTexts,
  itemsForGalleries, getGalleryItems, setGalleryItems
}
