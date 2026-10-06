import { createHash } from 'node:crypto'
import { composePage } from '../services/page-composer.js'
import { render } from '../services/renderer.js'
import { listLocales, getDefaultLocale } from '../repositories/locales.js'
import { getSetting } from '../repositories/settings.js'
import { cacheKey, getCached, setCached } from '../services/cache.js'
import { getMedia } from '../repositories/media.js'
import { HOME_SLUG } from '../repositories/pages.js'
import { pictureSources } from '../services/media-processor.js'
import config from '../config.js'
import { recordView, recordClicks, isMobileWidth } from '../repositories/analytics.js'
import {
  visitorHash, isBot, referrerHost, normalizePath, parseClicks, clamp
} from '../services/analytics.js'
import { createMessage, markMailed } from '../repositories/messages.js'
import { sendMessage } from '../services/mail.js'
import { checkContact } from '../services/contact-check.js'
import { verifyTurnstile } from '../services/turnstile.js'
import { siteTranslator } from '../i18n/site.js'
import { buildJsonLd } from '../services/json-ld.js'

/** Сегодня по часам сервера, «ГГГГ-ММ-ДД». */
function today () {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

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
  /* День в ключе: страница зависит от даты — прошедшие концерты с
     неё уходят, — а кэш сбрасывается только записью из админки и
     срока жизни не имеет. Без этого отсечка не сработала бы ни
     разу до следующей правки. */
  const key = cacheKey(['page', slug, locale, today()])
  const cached = getCached(key)
  if (cached) return cached

  const page = await composePage({ slug, locale })
  if (!page) return null

  const view = { ...page, ogImage: await resolveOgImage() }
  const html = render('layout', { ...view, jsonLd: buildJsonLd(view) })
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
  return reply.send(render('not-found', {
    locale: defaultLocale, homeUrl: '/', s: siteTranslator(defaultLocale)
  }))
}

async function publicRoutes (app) {
  app.setNotFoundHandler(notFound)

  app.get('/healthz', async () => ({ status: 'ok' }))

  /** Строка из формы: обрезаем до длины колонки, лишнее не храним. */
  function trim (value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : ''
  }

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
        const width = Math.round(clamp(body.w, 200, 10000, 1024))
        await recordView({
          path,
          locale: typeof body.locale === 'string' ? body.locale.slice(0, 8) : null,
          visitorHash: visitorHash(request),
          referrerHost: referrerHost(body.referrer),
          viewport: width,
          isMobile: isMobileWidth(width)
        })
      } else if (body.type === 'clicks') {
        await recordClicks(parseClicks(body.clicks, path))
      }
    } catch (error) {
      request.log.warn({ err: error }, 'Событие статистики не записано')
    }

    return reply.send()
  })

  /**
   * Сообщение из формы связи или заказ мерча.
   *
   * Сначала запись в базу, потом попытка письма: SMTP отвечает не
   * всегда, а написанное человеком терять нельзя. Ответ один и тот
   * же — принято; неотправленное письмо видно в админке.
   */
  app.post('/send', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }
  }, async (request, reply) => {
    const body = request.body ?? {}

    /* Обычно форму отправляет скрипт и ждёт JSON. Но у формы есть
       action и method, и без скрипта браузер приходит сюда сам —
       показать ему голый JSON нельзя, поэтому отвечаем переходом
       обратно к форме.

       Отличаем по типу тела, а не по Accept: наш скрипт шлёт JSON,
       но заголовок Accept не ставит, и проверка на него сломала бы
       живую форму. Тип тела говорит о том, КАК запрос составлен, и
       соврать тут нечему. */
    const wantsPage = String(request.headers['content-type'] ?? '').includes('urlencoded')
    /* Куда вернуть: только на свой же язык и только если он
       известен. Строка из формы в адрес перехода напрямую не
       попадает — иначе это открытый перенаправитель. */
    const asked = trim(body.locale, 8)
    const known = (await listLocales()).some((locale) => locale.code === asked)
    const backTo = (known && asked !== await getDefaultLocale() ? `/${asked}` : '/') + '#contact'

    /* Поле-приманка: человек его не видит и не заполняет, а робот
       заполняет всё подряд. Отвечаем как при успехе, иначе он
       подберёт форму ответа и попробует снова. */
    if (String(body.website ?? '') !== '') {
      return wantsPage ? reply.redirect(backTo, 303) : reply.send({ ok: true })
    }

    /* Капча — до записи в базу: пропущенный робот стоит нам строки
       в таблице и письма. Отсутствие токена это не «сеть моргнула»,
       а запрос мимо формы, и он отклоняется; а вот молчание самого
       Cloudflare пропускаем — политика та же, что у проверки
       контактов: потерять настоящее письмо хуже. */
    const captcha = await verifyTurnstile(body['cf-turnstile-response'], {
      ip: request.headers['cf-connecting-ip'] || request.ip
    })
    if (!captcha.ok) {
      request.log.warn({ reason: captcha.reason }, 'Отправка не прошла капчу')
      return wantsPage
        ? reply.redirect(backTo, 303)
        : reply.code(400).send({ ok: false, reason: 'captcha' })
    }
    if (captcha.reason === 'unreachable') {
      request.log.warn('Капча недоступна — сообщение принято без неё')
    }

    const kind = body.kind === 'order' ? 'order' : 'contact'
    const message = {
      kind,
      contact: trim(body.contact, 256),
      city: trim(body.city, 128),
      item: trim(body.item, 256),
      body: trim(body.message, 4000),
      locale: trim(body.locale, 8) || null
    }

    // Письмо без текста бесполезно так же, как заказ без связи.
    if (kind === 'contact' && message.body === '') {
      return reply.code(400).send({ ok: false, reason: 'empty' })
    }

    /* Адрес проверяем здесь ещё раз: проверке из браузера верить
       нельзя, а неверный адрес превращает и заказ, и письмо в
       тупик — ответить будет некуда. */
    const checked = await checkContact(trim(body.contact_kind, 16), message.contact)
    if (!checked.ok) return reply.code(400).send({ ok: false, reason: 'contact' })
    message.contact = checked.contact

    let id
    try {
      id = await createMessage(message)
    } catch (error) {
      request.log.error({ err: error }, 'Сообщение не записано')
      return reply.code(500).send({ ok: false, reason: 'failed' })
    }

    const sent = await sendMessage(message)
    try {
      await markMailed(id, sent.ok ? null : sent.error)
    } catch (error) {
      request.log.warn({ err: error }, 'Отметка об отправке не записана')
    }
    if (!sent.ok) request.log.warn({ id, error: sent.error }, 'Письмо не ушло, сообщение осталось в базе')

    return wantsPage ? reply.redirect(backTo, 303) : reply.send({ ok: true })
  })

  /**
   * Проверка контакта покупателя до отправки заказа.
   *
   * Отдельным запросом, чтобы человек узнал об опечатке у поля, а
   * не после «отправлено». Тот же вызов повторяется при приёме
   * заказа: проверке из браузера верить нельзя.
   */
  app.post('/check-contact', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } }
  }, async (request, reply) => {
    const result = await checkContact(request.body?.kind, request.body?.value)
    return reply.send({ ok: result.ok })
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
    const rendered = await renderLocalisedPage(HOME_SLUG, locale)
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

    const rendered = await renderLocalisedPage(HOME_SLUG, known.code)
    if (!rendered) return notFound(request, reply)
    return sendHtml(request, reply, rendered)
  })
}

export default publicRoutes
export {  }
