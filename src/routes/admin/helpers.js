import { render } from '../../services/renderer.js'
import { ensureCsrfToken, takeFlash } from '../../services/auth.js'
import { listLocales, getDefaultLocale } from '../../repositories/locales.js'
import { invalidateCache } from '../../services/cache.js'
import { adminTranslator, translatedLocales, localize } from '../../i18n/admin.js'
import { isConfigured } from '../../services/translate.js'
import { thumbnailUrl } from '../../services/media-processor.js'
import { asString } from '../../services/block-form.js'

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
/** Потолок INTEGER в Postgres: выше — «out of range» и пятисотка. */
const MAX_ID = 2147483647

function numericId (request, key = 'id') {
  const id = Number(request.params?.[key])
  return Number.isInteger(id) && id > 0 && id <= MAX_ID ? id : null
}

/**
 * Страница списка: что спросить у базы и что отдать шаблону.
 *
 * Арифметика одна и та же у медиатеки и писем, а ошибиться в ней
 * легко — `Math.ceil(0 / 50)` даёт ноль, и пагинатор исчезает
 * вместе с первой страницей.
 */
function pageSlice (request, perPage) {
  const pageNumber = Math.max(Number.parseInt(request.query?.page ?? '1', 10) || 1, 1)
  return {
    pageNumber,
    // Отдельным объектом: репозиторию незачем видеть остальное.
    range: { limit: perPage, offset: (pageNumber - 1) * perPage },
    pager: (total) => ({
      total,
      pageNumber,
      pageCount: Math.max(Math.ceil(total / perPage), 1)
    })
  }
}

/**
 * Список id из формы: «3,7,7,12» или массив полей с тем же именем.
 *
 * Порядок сохраняем — им задаётся и порядок блоков, и порядок
 * снимков в альбоме. Повторы убираем: qs отдаёт массив как есть,
 * а дважды добавленный снимок сломал бы запись состава.
 */
function idList (raw) {
  const values = Array.isArray(raw) ? raw : String(raw ?? '').split(',')
  const ids = values
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0)
  return [...new Set(ids)]
}

/**
 * Ключ строки товара в форме: `price[m7]`, `item[m7][title]`.
 *
 * Буква обязательна. qs разбирает «price[7]» как индекс массива и
 * схлопывает разрывы: удалили седьмой снимок — и цена восьмого
 * уезжает на его место.
 *
 * Те же ключи собирают gallery-form.eta и public/js/admin.js —
 * менять соглашение придётся сразу во всех трёх.
 */
function itemKey (mediaId) {
  return `m${mediaId}`
}

/** Обратно: `{ m7: … }` → `{ 7: … }`. */
function stripItemKeys (fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    const id = Number(String(key).replace(/^m/, ''))
    if (id) out[id] = value
  }
  return out
}

/**
 * Карточка файла для окон выбора: ровно то, что читает браузер.
 *
 * Собиралась в шести местах, и копии уже разошлись — где-то с
 * размерами, где-то с ценой. Добавочные поля передавайте вторым
 * доводом, общая часть должна оставаться общей.
 */
function mediaCard (media, extra) {
  return {
    id: media.id,
    thumb: thumbnailUrl(media),
    name: media.originalName,
    ...extra
  }
}

/**
 * Переводимые поля из формы: `{ en: {title, description}, … }`.
 *
 * Три маршрута собирали это вручную, причём двумя разными
 * идиомами — `String(...).trim()` и `asString`, — а вторая умеет
 * то, чего не умеет первая: форма может прислать массив.
 */
function textsFromBody (body, locales, keys) {
  const byLocale = {}
  for (const locale of locales) {
    byLocale[locale] = Object.fromEntries(
      keys.map((key) => [key, asString(body?.text?.[locale]?.[key])])
    )
  }
  return byLocale
}

/** Любая запись делает кэш публичных страниц недействительным. */
function afterWrite () {
  invalidateCache()
}

export {
  renderAdmin, afterWrite, resolveAdminLocale, languageUrl,
  numericId, pageSlice, itemKey, stripItemKeys, idList,
  mediaCard, textsFromBody
}
