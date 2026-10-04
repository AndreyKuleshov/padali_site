import { db, groupTexts, replaceTexts } from './helpers.js'

/**
 * Страница сайта пока одна. Слаг назван здесь, чтобы «home» не
 * пришлось искать строкой по шести файлам, когда страниц станет две.
 */
const HOME_SLUG = 'home'

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

/** Есть ли вообще страницы — по этому признаку решают, сидировать ли базу. */
async function countPages (conn) {
  const row = await db(conn).one('SELECT COUNT(*) AS total FROM pages')
  return Number(row.total)
}

export { getPageBySlug, createPage, getPageTexts, savePageTexts, countPages, HOME_SLUG }
