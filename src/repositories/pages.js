import { db, groupTexts, replaceTexts } from './helpers.js'

/**
 * Главная. Слаг назван здесь, а не строкой по шести файлам: у неё
 * особое положение — она живёт в корне, а не по своему адресу.
 */
const HOME_SLUG = 'home'

/**
 * Слаги, которые страница занять не может.
 *
 * Адрес из одного отрезка разбирается так: сперва язык, потом
 * страница. Страница с именем языка была бы недостижима — её
 * перехватил бы переключатель, и редактор чинил бы «пропавшую
 * страницу», которой на деле некуда было деться. Поэтому имена
 * языков запрещаем на входе, а не разбираемся потом.
 */
const RESERVED_SLUGS = new Set([HOME_SLUG, 'admin', 'uploads', 'sitemap.xml', 'robots.txt'])

async function getPageBySlug (slug, conn) {
  return db(conn).one(
    'SELECT id, slug, is_published, position FROM pages WHERE slug = ?',
    [slug]
  )
}

async function createPage ({ slug, isPublished = true, position = 0 }, conn) {
  return db(conn).insert(
    'INSERT INTO pages (slug, is_published, position) VALUES (?, ?, ?) RETURNING id',
    [slug, isPublished, position]
  )
}

/** → { [locale]: { [field]: value } } */
async function getPageTexts (pageId, conn) {
  const rows = await db(conn).all(
    'SELECT page_id, locale, field, value FROM page_texts WHERE page_id = ?',
    [pageId]
  )
  return groupTexts(rows, 'page_id').get(pageId) ?? {}
}

async function savePageTexts (pageId, textsByLocale, conn) {
  await replaceTexts(conn, {
    table: 'page_texts', idColumn: 'page_id', id: pageId, textsByLocale
  })
}

/** Все страницы, главная первой: она в списке админки главнее прочих. */
async function listPages (conn) {
  return db(conn).all(
    'SELECT id, slug, is_published, position FROM pages ' +
    'ORDER BY (slug = ?) DESC, position, slug',
    [HOME_SLUG]
  )
}

async function getPage (id, conn) {
  return db(conn).one(
    'SELECT id, slug, is_published, position FROM pages WHERE id = ?',
    [id]
  )
}

/** Слаг главной не меняется: её адрес — корень, и слаг там ни при чём. */
async function updatePage (id, { slug, isPublished, position }, conn) {
  return db(conn).run(
    'UPDATE pages SET slug = ?, is_published = ?, position = ?, updated_at = now() WHERE id = ?',
    [slug, isPublished, position, id]
  )
}

/** Блоки страницы уходят вместе с ней: за это отвечает внешний ключ. */
async function deletePage (id, conn) {
  return db(conn).run('DELETE FROM pages WHERE id = ?', [id])
}

/** Есть ли вообще страницы — по этому признаку решают, сидировать ли базу. */
async function countPages (conn) {
  const row = await db(conn).one('SELECT COUNT(*) AS total FROM pages')
  return Number(row.total)
}

export {
  getPageBySlug, getPage, listPages, createPage, updatePage, deletePage,
  getPageTexts, savePageTexts, countPages, HOME_SLUG, RESERVED_SLUGS
}
