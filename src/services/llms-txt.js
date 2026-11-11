/**
 * Короткая сводка сайта для агентов — `/llms.txt`.
 *
 * Зачем она, если есть разметка для поиска: разметка расставлена
 * по страницам, и чтобы собрать из неё ответ «кто это и когда
 * играет», страницы надо сперва найти и обойти. Сводка отдаёт то
 * же самое одним файлом простым текстом — так его берёт и модель,
 * у которой на страницу бюджета в разы меньше, чем у поисковика.
 *
 * Собирается из тех же данных, что и страницы, а не пишется
 * руками: написанный руками файл расходится с сайтом на первой же
 * правке, и расхождение это никто не заметит — сводку читают не
 * люди. Отсюда же правило разметки: ни одного утверждения, которого
 * нет на самих страницах.
 */
import config from '../config.js'
import { composePage } from './page-composer.js'
import { listLocales, getDefaultLocale } from '../repositories/locales.js'
import { listPages, HOME_SLUG } from '../repositories/pages.js'
import { localeUrl } from './renderer.js'

/** Полный адрес страницы на нужном языке. */
function pageUrl (locale, defaultLocale, slug) {
  return config.publicUrl + localeUrl(locale, defaultLocale, slug === HOME_SLUG ? '' : slug)
}

/** «2026-12-04» и «20:00» → «2026-12-04 20:00». Час — только объявленный. */
function when (event) {
  return event.time ? `${event.date} ${event.time}` : event.date
}

function concertLine (event) {
  const place = [event.venueName, event.venueCity, event.venueCountry].filter(Boolean).join(', ')
  const parts = [when(event), place].filter(Boolean)

  /* Состояние продажи — теми же словами, что на странице:
     «распродано» важнее цены, а бесплатный вход важнее обоих. */
  if (event.soldOut) parts.push('sold out')
  else if (event.isFree) parts.push('free entry')
  else if (event.price) parts.push(event.priceFrom ? `from ${event.price}` : event.price)

  if (event.ticketUrl) parts.push(`tickets: ${event.ticketUrl}`)
  else if (event.eventUrl) parts.push(event.eventUrl)
  return `- ${parts.join(' — ')}`
}

/** Площадки релиза: лендинг и блок релиза устроены одинаково. */
function releaseLines (block, locale, defaultLocale, slug) {
  const title = block.text?.title
  if (!title) return []

  const links = [
    ...(block.settings?.spotify_url ? [`Spotify: ${block.settings.spotify_url}`] : []),
    ...(Array.isArray(block.settings?.platforms)
      ? block.settings.platforms.filter((row) => row.url).map((row) => `${row.label || row.icon}: ${row.url}`)
      : [])
  ]
  const head = `- ${title} — ${pageUrl(locale, defaultLocale, slug)}`
  return links.length > 0 ? [head, ...links.map((link) => `  - ${link}`)] : [head]
}

/**
 * @param {string} today — «ГГГГ-ММ-ДД», та же отсечка, что и у страниц
 * @returns {Promise<string>}
 */
async function buildLlmsTxt (today) {
  const defaultLocale = await getDefaultLocale()
  const locales = await listLocales()
  const published = (await listPages()).filter((page) => page.is_published)

  /* Страницы собираем тем же сборщиком, что и сайт: сводка должна
     рассказывать о том, что на них сейчас стоит, а не о том, что
     было, когда её писали. */
  const composed = []
  for (const row of published) {
    const page = await composePage({ slug: row.slug, locale: defaultLocale, today })
    if (page) composed.push({ slug: row.slug, page })
  }

  const home = composed.find((entry) => entry.slug === HOME_SLUG)?.page
  const name = home?.siteName || 'PADALI'
  const lines = [`# ${name}`, '']

  if (home?.meta?.description) lines.push(`> ${home.meta.description}`, '')

  lines.push('## Pages', '')
  for (const { slug, page } of composed) {
    const url = pageUrl(defaultLocale, defaultLocale, slug)
    const title = page.meta?.title || url
    lines.push(page.meta?.description
      ? `- [${title}](${url}): ${page.meta.description}`
      : `- [${title}](${url})`)
  }
  lines.push('')

  /* Концерты — главное, ради чего сюда приходит агент: «когда они
     играют» спрашивают чаще всего, а ответ меняется каждую неделю.
     Берём те же будущие события, что показывает страница. */
  const concerts = composed.flatMap(({ page }) => page.blocks
    .filter((block) => block.type === 'concert')
    .flatMap((block) => block.settings?.events ?? []))
  if (concerts.length > 0) {
    lines.push('## Upcoming concerts', '')
    for (const event of concerts) lines.push(concertLine(event))
    lines.push('')
  }

  const releases = composed.flatMap(({ slug, page }) => page.blocks
    .filter((block) => block.type === 'landing' || block.type === 'release')
    .flatMap((block) => releaseLines(block, defaultLocale, defaultLocale, slug)))
  if (releases.length > 0) {
    lines.push('## Music', '')
    lines.push(...releases)
    lines.push('')
  }

  const social = (home?.settings?.social ?? []).filter((row) => row.url)
  if (social.length > 0) {
    lines.push('## Elsewhere', '')
    for (const row of social) lines.push(`- ${row.label || row.icon}: ${row.url}`)
    lines.push('')
  }

  /* Второй язык — не копия: тексты переведены, и агенту, который
     отвечает по-сербски, нужна именно сербская страница. */
  if (locales.length > 1) {
    lines.push('## Languages', '')
    for (const locale of locales) {
      lines.push(`- ${locale.title || locale.code}: ${pageUrl(locale.code, defaultLocale, HOME_SLUG)}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export { buildLlmsTxt }
