import { createHash } from 'node:crypto'
import { composePage } from '../services/page-composer.js'
import { render } from '../services/renderer.js'
import { listLocales, getDefaultLocale } from '../repositories/locales.js'
import { getSetting } from '../repositories/settings.js'
import { cacheKey, getCached, setCached } from '../services/cache.js'
import { getMedia } from '../repositories/media.js'
import { pictureSources } from '../services/media-processor.js'
import config from '../config.js'
import { recordView, recordClicks } from '../repositories/analytics.js'
import {
  visitorHash, isBot, referrerHost, normalizePath, parseClicks, clamp
} from '../services/analytics.js'

function etagOf (html) {
  return `"${createHash('sha1').update(html).digest('base64url')}"`
}

/** og:image хранится как id файла в настройках. */
async function resolveOgImage () {
  const mediaId = Number(await getSetting('og_image_id', null))
  if (!Number.isInteger(mediaId) || mediaId <= 0) return null
  const media = await getMedia(mediaId)
  return media ? pictureSources(media).src : null
}

async function renderLocalisedPage (slug, locale) {
  const key = cacheKey(['page', slug, locale])
  const cached = getCached(key)
  if (cached) return cached

  const page = await composePage({ slug, locale })
  if (!page) return null

  const html = render('layout', { ...page, ogImage: await resolveOgImage() })
  return setCached(key, { html, etag: etagOf(html) })
}

function sendHtml (request, reply, rendered) {
  reply.header('ETag', rendered.etag)
  reply.header('Cache-Control', 'public, max-age=0, must-revalidate')
  if (request.headers['if-none-match'] === rendered.etag) {
    return reply.code(304).send()
  }
  return reply.type('text/html; charset=utf-8').send(rendered.html)
}

async function notFound (request, reply) {
  const defaultLocale = await getDefaultLocale()
  reply.code(404).type('text/html; charset=utf-8')
  return reply.send(render('not-found', { locale: defaultLocale, homeUrl: '/' }))
}

async function publicRoutes (app) {
  app.setNotFoundHandler(notFound)

  app.get('/healthz', async () => ({ status: 'ok' }))

  /**
   * Приём событий от счётчика. Отвечаем 204 всегда: маячок не читает
   * ответ, а посетитель не должен ничего заметить, даже если запись
   * не удалась. Боты и мусор отбрасываются молча.
   */
  app.post('/_a', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    reply.code(204)

    try {
      if (isBot(request.headers['user-agent'])) return reply.send()

      const body = request.body ?? {}
      const path = normalizePath(body.path)
      if (!path) return reply.send()

      if (body.type === 'view') {
        await recordView({
          path,
          locale: typeof body.locale === 'string' ? body.locale.slice(0, 8) : null,
          visitorHash: visitorHash(request),
          referrerHost: referrerHost(body.referrer),
          viewport: Math.round(clamp(body.w, 200, 10000, 1024)),
          isMobile: Math.round(clamp(body.w, 200, 10000, 1024)) <= 640
        })
      } else if (body.type === 'clicks') {
        await recordClicks(parseClicks(body.clicks, path))
      }
    } catch (error) {
      request.log.warn({ err: error }, 'Событие статистики не записано')
    }

    return reply.send()
  })

  app.get('/robots.txt', async (request, reply) => {
    reply.type('text/plain; charset=utf-8')
    return `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${config.publicUrl}/sitemap.xml\n`
  })

  app.get('/sitemap.xml', async (request, reply) => {
    const locales = await listLocales()
    const defaultLocale = await getDefaultLocale()
    const urls = locales.map((locale) => {
      const path = locale.code === defaultLocale ? '/' : `/${locale.code}`
      return `  <url><loc>${config.publicUrl}${path}</loc></url>`
    })
    reply.type('application/xml; charset=utf-8')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
  })

  app.get('/', async (request, reply) => {
    const locale = await getDefaultLocale()
    const rendered = await renderLocalisedPage('home', locale)
    if (!rendered) return notFound(request, reply)
    return sendHtml(request, reply, rendered)
  })

  // Второй язык живёт в своём префиксе; язык по умолчанию — только в корне.
  app.get('/:locale', async (request, reply) => {
    const { locale } = request.params
    if (!/^[a-z]{2}(-[a-z]{2})?$/i.test(locale)) return notFound(request, reply)

    const locales = await listLocales()
    const known = locales.find((row) => row.code === locale.toLowerCase())
    if (!known) return notFound(request, reply)

    const defaultLocale = await getDefaultLocale()
    if (known.code === defaultLocale) return reply.redirect('/', 301)

    const rendered = await renderLocalisedPage('home', known.code)
    if (!rendered) return notFound(request, reply)
    return sendHtml(request, reply, rendered)
  })
}

export default publicRoutes
export { renderLocalisedPage }
