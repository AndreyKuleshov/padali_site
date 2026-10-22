import {
  listPages, getPage, getPageBySlug, createPage, updatePage, deletePage,
  getPageTexts, savePageTexts, HOME_SLUG, RESERVED_SLUGS
} from '../../repositories/pages.js'
import { listBlocks } from '../../repositories/blocks.js'
import { listLocales } from '../../repositories/locales.js'
import { setFlash } from '../../services/auth.js'
import { renderAdmin, afterWrite, numericId, textsFromBody } from './helpers.js'

/*
 * Слаг — это адрес, а не название: он уезжает в ссылку, в письмо и
 * в питч, и переименование ломает всё, куда его уже вписали.
 * Поэтому держим его скучным: латиница, цифры и дефис.
 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SLUG_MAX = 64

/**
 * Разбор и проверка адреса.
 *
 * Имена языков запрещены вместе со служебными словами: адрес из
 * одного отрезка разбирается сперва как язык, и страница «sr»
 * оказалась бы навсегда заслонена переключателем. Ловить это
 * надо здесь, а не объяснять потом, почему страница «пропала».
 *
 * @returns {Promise<{ok: true, slug: string} | {ok: false, key: string, slug: string}>}
 */
async function readSlug (raw, { allowId = null } = {}) {
  const slug = String(raw ?? '').trim().toLowerCase()

  if (!SLUG.test(slug) || slug.length > SLUG_MAX) return { ok: false, key: 'pages.slugInvalid', slug }

  const locales = await listLocales()
  const reserved = RESERVED_SLUGS.has(slug) || locales.some((row) => row.code === slug)
  if (reserved) return { ok: false, key: 'pages.slugReserved', slug }

  const existing = await getPageBySlug(slug)
  if (existing && existing.id !== allowId) return { ok: false, key: 'pages.slugTaken', slug }

  return { ok: true, slug }
}

async function pageRoutes (app) {
  app.get('/pages', async (request, reply) => {
    const pages = await listPages()

    /* Сколько блоков на странице — чтобы пустая была видна сразу:
       страница без блоков открывается, но показывать ей нечего. */
    const withCounts = await Promise.all(pages.map(async (page) => ({
      ...page,
      isHome: page.slug === HOME_SLUG,
      blockCount: (await listBlocks(page.id)).length
    })))

    return renderAdmin(request, reply, 'admin/pages', { pages: withCounts, slugMax: SLUG_MAX })
  })

  /* Заголовок и описание правятся на своём экране, а не строкой в
     списке: на двух языках это четыре поля, и в ряду с кнопками им
     не поместиться. У главной те же поля живут в настройках сайта —
     туда за ними и ходят. */
  app.get('/pages/:id/edit', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const page = await getPage(id)
    if (!page || page.slug === HOME_SLUG) return reply.callNotFound()

    return renderAdmin(request, reply, 'admin/page-form', {
      page,
      pageText: await getPageTexts(id),
      locales: await listLocales(),
      slugMax: SLUG_MAX
    })
  })

  app.post('/pages', async (request, reply) => {
    const check = await readSlug(request.body?.slug)
    if (!check.ok) {
      setFlash(reply, 'error', request.t(check.key, { slug: check.slug }))
      return reply.redirect('/admin/pages', 302)
    }

    /* Новая страница не публикуется сразу: её ещё нечем наполнить,
       а пустой адрес, попавший в карту сайта, — это приглашение
       поисковику на страницу ни с чем. */
    await createPage({ slug: check.slug, isPublished: false })
    afterWrite()
    setFlash(reply, 'success', request.t('pages.added', { slug: check.slug }))
    return reply.redirect('/admin/pages', 302)
  })

  app.post('/pages/:id', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const page = await getPage(id)
    if (!page) return reply.callNotFound()

    const isPublished = String(request.body?.is_published ?? '') === '1'

    /* У главной адрес не правится: она живёт в корне, и слаг ей
       нужен только чтобы её найти в базе. */
    if (page.slug === HOME_SLUG) {
      await updatePage(id, { slug: page.slug, isPublished, position: page.position })
      afterWrite()
      setFlash(reply, 'success', request.t('pages.saved'))
      return reply.redirect('/admin/pages', 302)
    }

    const check = await readSlug(request.body?.slug, { allowId: id })
    if (!check.ok) {
      setFlash(reply, 'error', request.t(check.key, { slug: check.slug }))
      return reply.redirect('/admin/pages', 302)
    }

    await updatePage(id, { slug: check.slug, isPublished, position: page.position })

    /* Тексты пишем только если они пришли. Кнопки «опубликовать» и
       «сохранить адрес» в списке их не шлют, и безусловная запись
       стёрла бы заголовок страницы пустой строкой. */
    if (request.body?.text) {
      const locales = (await listLocales()).map((row) => row.code)
      await savePageTexts(id, textsFromBody(request.body, locales, ['title', 'description']))
    }

    afterWrite()
    setFlash(reply, 'success', request.t('pages.saved'))
    return reply.redirect(request.body?.text ? `/admin/pages/${id}/edit` : '/admin/pages', 302)
  })

  app.post('/pages/:id/delete', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const page = await getPage(id)
    if (!page) return reply.callNotFound()

    // Без главной сайт перестаёт существовать: корень отдаёт 404.
    if (page.slug === HOME_SLUG) {
      setFlash(reply, 'error', request.t('pages.homeLocked'))
      return reply.redirect('/admin/pages', 302)
    }

    await deletePage(id)
    afterWrite()
    setFlash(reply, 'success', request.t('pages.deleted', { slug: page.slug }))
    return reply.redirect('/admin/pages', 302)
  })
}

export default pageRoutes
export { readSlug, SLUG_MAX }
