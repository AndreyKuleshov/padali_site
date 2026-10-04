import { db, placeholders, groupTexts, replaceTexts } from './helpers.js'
import { getDefaultLocale } from './locales.js'

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

/**
 * Название и цена по альбомам:
 * Map<gallery_id, Map<media_id, {title, price}>>.
 *
 * Отдельным запросом, а не внутри itemsForGalleries: там состав —
 * плоский список id, на который опирается и композитор страницы,
 * и тесты, и менять его форму ради полей, нужных одному блоку,
 * невыгодно.
 */
async function itemFieldsForGalleries (ids, conn) {
  if (ids.length === 0) return new Map()
  const runner = db(conn)
  const list = placeholders(ids.length)

  const [prices, texts] = await Promise.all([
    runner.all(
      `SELECT gallery_id, media_id, price FROM gallery_items ` +
      `WHERE gallery_id IN (${list}) AND price <> ''`,
      ids
    ),
    runner.all(
      'SELECT gallery_id, media_id, locale, field, value FROM gallery_item_texts ' +
      `WHERE gallery_id IN (${list})`,
      ids
    )
  ])

  const grouped = new Map()
  const slot = (galleryId, mediaId) => {
    if (!grouped.has(galleryId)) grouped.set(galleryId, new Map())
    const album = grouped.get(galleryId)
    if (!album.has(mediaId)) album.set(mediaId, { price: '', title: {} })
    return album.get(mediaId)
  }

  for (const row of prices) slot(row.gallery_id, row.media_id).price = row.price
  for (const row of texts) {
    const item = slot(row.gallery_id, row.media_id)
    item[row.field] ??= {}
    item[row.field][row.locale] = row.value
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
async function setGalleryItems (galleryId, items, conn) {
  const runner = db(conn)
  await runner.run('DELETE FROM gallery_items WHERE gallery_id = ?', [galleryId])

  /* Принимаем и голые id, и пары с ценой. Иначе цену пришлось бы
     дописывать вторым запросом после DELETE, и любой вызов без
     неё молча затирал бы цены всего альбома. */
  const seen = new Set()
  const unique = []
  for (const item of items) {
    const isPair = item !== null && typeof item === 'object'
    const mediaId = Number(isPair ? item.mediaId : item)
    if (!mediaId || seen.has(mediaId)) continue
    seen.add(mediaId)
    unique.push({
      mediaId,
      // Название — объект по языкам; строка допускается ради
      // вызовов, которым язык не важен (сид, тесты).
      title: isPair ? item.title : undefined,
      price: String(isPair ? item.price ?? '' : '').trim().slice(0, 64)
    })
  }
  if (unique.length === 0) return

  const values = unique.map(() => '(?, ?, ?, ?)').join(', ')
  const params = unique.flatMap((item, index) => [galleryId, item.mediaId, index, item.price])
  await runner.run(
    `INSERT INTO gallery_items (gallery_id, media_id, position, price) VALUES ${values}`,
    params
  )

  for (const item of unique) {
    if (item.title === undefined) continue
    await writeItemTexts(conn, galleryId, item.mediaId, item.title)
  }
  await runner.run('UPDATE galleries SET updated_at = now() WHERE id = ?', [galleryId])
}

/**
 * Дописать фотографии в конец альбома.
 *
 * Не setGalleryItems: тот переписывает состав целиком и снёс бы
 * проставленные цены. Повторы пропускаем — ключ таблицы их всё
 * равно не примет.
 *
 * @returns {Promise<number>} сколько добавилось
 */
async function appendGalleryItems (galleryId, mediaIds, conn) {
  const runner = db(conn)
  const existing = new Set(
    (await runner.all('SELECT media_id FROM gallery_items WHERE gallery_id = ?', [galleryId]))
      .map((row) => row.media_id)
  )

  const fresh = []
  for (const value of mediaIds) {
    const mediaId = Number(value)
    if (!mediaId || existing.has(mediaId)) continue
    existing.add(mediaId)
    fresh.push(mediaId)
  }
  if (fresh.length === 0) return 0

  const last = await runner.one(
    'SELECT COALESCE(MAX(position), -1) AS maxposition FROM gallery_items WHERE gallery_id = ?',
    [galleryId]
  )
  const start = Number(last.maxposition) + 1

  await runner.run(
    'INSERT INTO gallery_items (gallery_id, media_id, position) VALUES ' +
      fresh.map(() => '(?, ?, ?)').join(', '),
    fresh.flatMap((mediaId, index) => [galleryId, mediaId, start + index])
  )
  await runner.run('UPDATE galleries SET updated_at = now() WHERE id = ?', [galleryId])
  return fresh.length
}

/**
 * Убрать снимки из альбома. Сами файлы остаются в медиатеке:
 * их могли вставить в другой блок, да и перезагружать их потом
 * заново — лишняя работа.
 *
 * @returns {Promise<number>} сколько убралось
 */
async function removeGalleryItems (galleryId, mediaIds, conn) {
  const ids = mediaIds.map(Number).filter(Boolean)
  if (ids.length === 0) return 0

  const runner = db(conn)
  const result = await runner.run(
    `DELETE FROM gallery_items WHERE gallery_id = ? AND media_id IN (${placeholders(ids.length)})`,
    [galleryId, ...ids]
  )
  /* Дыры в позициях не чиним: порядок задан самими числами, а
     перенумерация ради красоты переписала бы весь альбом. */
  if (result.rowCount > 0) await runner.run('UPDATE galleries SET updated_at = now() WHERE id = ?', [galleryId])
  return result.rowCount ?? 0
}

/**
 * Название и цена у уже лежащих в альбоме снимков.
 *
 * Только UPDATE: состав альбома эта правка не меняет, а чужой
 * media_id просто ни во что не попадёт.
 *
 * @param {Record<string|number, {title?: string, price?: string}>} fields
 */
async function setGalleryItemFields (galleryId, fields, conn) {
  const runner = db(conn)
  let changed = 0

  for (const [key, value] of Object.entries(fields ?? {})) {
    const mediaId = Number(key)
    if (!mediaId) continue

    const result = await runner.run(
      'UPDATE gallery_items SET price = ? WHERE gallery_id = ? AND media_id = ?',
      [String(value?.price ?? '').trim().slice(0, 64), galleryId, mediaId]
    )
    // Чужой media_id ни во что не попал — тексты ему тоже не пишем.
    if ((result.rowCount ?? 0) === 0) continue

    changed += 1
    await writeItemTexts(conn, galleryId, mediaId, value?.title)
  }

  if (changed > 0) await runner.run('UPDATE galleries SET updated_at = now() WHERE id = ?', [galleryId])
  return changed
}

/**
 * Название товара по языкам. Принимает и строку — тогда она
 * ложится в язык по умолчанию: так зовут сид и тесты, которым
 * перевод не нужен.
 */
async function writeItemTexts (conn, galleryId, mediaId, title) {
  const runner = db(conn)
  await runner.run(
    "DELETE FROM gallery_item_texts WHERE gallery_id = ? AND media_id = ? AND field = 'title'",
    [galleryId, mediaId]
  )
  if (title === undefined || title === null || title === '') return

  let byLocale = title
  if (typeof title === 'string') {
    // Через getDefaultLocale: свой запрос давал третий ответ на
    // тот же вопрос — при отсутствии дефолтного брал первый по
    // позиции, а не 'en'.
    byLocale = { [await getDefaultLocale(conn)]: title }
  }

  const values = []
  const params = []
  for (const [locale, value] of Object.entries(byLocale)) {
    const text = String(value ?? '').trim().slice(0, 160)
    if (text === '') continue
    values.push('(?, ?, ?, ?, ?)')
    params.push(galleryId, mediaId, locale, 'title', text)
  }
  if (values.length === 0) return

  await runner.run(
    'INSERT INTO gallery_item_texts (gallery_id, media_id, locale, field, value) ' +
    `VALUES ${values.join(', ')}`,
    params
  )
}

export {
  listGalleries, getGallery, getGalleryBySlug, createGallery, renameGallery, deleteGallery,
  textsForGalleries, getGalleryTexts, saveGalleryTexts,
  itemsForGalleries, itemFieldsForGalleries, getGalleryItems, setGalleryItems, appendGalleryItems, removeGalleryItems, setGalleryItemFields
}
