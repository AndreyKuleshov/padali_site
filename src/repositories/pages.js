import { db, groupTexts, replaceTexts } from './helpers.js'

async function getPageBySlug (slug, conn) {
  return db(conn).one(
    'SELECT id, slug, is_published, position FROM pages WHERE slug = ?',
    [slug]
  )
}

async function createPage ({ slug, isPublished = true, position = 0 }, conn) {
  const result = await db(conn).run(
    'INSERT INTO pages (slug, is_published, position) VALUES (?, ?, ?)',
    [slug, isPublished ? 1 : 0, position]
  )
  return result.insertId
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

export { getPageBySlug, createPage, getPageTexts, savePageTexts }
