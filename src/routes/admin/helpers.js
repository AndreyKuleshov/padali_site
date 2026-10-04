import { render } from '../../services/renderer.js'
import { ensureCsrfToken, takeFlash } from '../../services/auth.js'
import { listLocales, getDefaultLocale } from '../../repositories/locales.js'
import { invalidateCache } from '../../services/cache.js'
import { adminTranslator, translatedLocales, localize } from '../../i18n/admin.js'
import { isConfigured } from '../../services/translate.js'

const LANG_COOKIE = 'padali_admin_lang'

const NAV = [
  { href: '/admin', key: 'nav.blocks', match: /^\/admin\/?$|^\/admin\/blocks/ },
  { href: '/admin/galleries', key: 'nav.galleries', match: /^\/admin\/galleries/ },
  { href: '/admin/media', key: 'nav.media', match: /^\/admin\/media/ },
  { href: '/admin/settings', key: 'nav.settings', match: /^\/admin\/settings/ },
  { href: '/admin/users', key: 'nav.users', match: /^\/admin\/users/ },
  { href: '/admin/messages', key: 'nav.messages', match: /^\/admin\/messages/ },
  { href: '/admin/analytics', key: 'nav.analytics', match: /^\/admin\/analytics/ }
]

/**
 * Язык админки берётся из языков сайта — отдельного списка локалей
 * заводить не стали. Выбор запоминается в куке; по умолчанию берётся
 * язык сайта по умолчанию, если интерфейс на него переведён.
 */
async function resolveAdminLocale (request, reply) {
  const siteLocales = (await listLocales()).map((row) => row.code)
  const available = translatedLocales().filter((code) => siteLocales.includes(code))
  const fallback = available.includes(await getDefaultLocale()) ? await getDefaultLocale() : (available[0] ?? 'en')

  const requested = String(request.query?.lang ?? '')
  if (available.includes(requested)) {
    reply.setCookie(LANG_COOKIE, requested, {
      path: '/admin', httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 60 * 60
    })
    request.adminLocale = requested
  } else {
    const saved = request.cookies?.[LANG_COOKIE]
    request.adminLocale = available.includes(saved) ? saved : fallback
  }

  request.adminLocales = available
  request.t = adminTranslator(request.adminLocale)
}

/** Тот же путь с другим языком — для переключателя. */
function languageUrl (currentUrl, code) {
  const [path, search] = currentUrl.split('?')
  const params = new URLSearchParams(search ?? '')
  params.set('lang', code)
  return `${path}?${params.toString()}`
}

/** Общий контекст админских страниц: токен, пользователь, меню, сообщение. */
async function renderAdmin (request, reply, template, data = {}) {
  const locales = data.locales ?? await listLocales()
  const t = request.t ?? adminTranslator('en')
  const currentPath = request.url.split('?')[0]

  const html = render(template, {
    ...data,
    locales,
    t,
    adminLocale: request.adminLocale ?? 'en',
    languages: (request.adminLocales ?? []).map((code) => ({
      code,
      href: languageUrl(request.url, code),
      active: code === request.adminLocale
    })),
    localize: (value) => localize(value, request.adminLocale ?? 'en'),
    csrf: ensureCsrfToken(request, reply),
    // Без ключа к модели кнопок перевода просто нет: пустая
    // кнопка, которая всегда отвечает ошибкой, хуже её отсутствия.
    canTranslate: isConfigured(),
    user: request.adminUser ?? null,
    flash: takeFlash(request, reply),
    nav: NAV.map((item) => ({
      href: item.href,
      label: t(item.key),
      active: item.match.test(currentPath)
    })),
    currentPath
  })
  reply.type('text/html; charset=utf-8')
  return reply.send(html)
}

/**
 * Числовой id из пути или null.
 *
 * Без проверки `Number('abc')` даёт NaN, драйвер отправляет его в
 * Postgres строкой «NaN», и вместо 404 получается 500 с текстом
 * ошибки базы в теле ответа.
 */
function numericId (request, key = 'id') {
  const id = Number(request.params?.[key])
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Любая запись делает кэш публичных страниц недействительным. */
function afterWrite () {
  invalidateCache()
}

export { renderAdmin, afterWrite, resolveAdminLocale, languageUrl, NAV, LANG_COOKIE, numericId }
