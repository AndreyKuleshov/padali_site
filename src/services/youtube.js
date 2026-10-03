/**
 * Ролики с YouTube.
 *
 * Ссылку редактор приносит в любом виде, какой дал плеер или
 * «поделиться», поэтому идентификатор вытаскиваем сами. Наличие
 * ролика проверяем через oEmbed: это единственный открытый ответ
 * YouTube, который отличает «нет такого» от «есть, но встраивать
 * нельзя», и он же приносит название и обложку для превью.
 */
const ID = /^[\w-]{11}$/
const OEMBED = 'https://www.youtube.com/oembed'

/**
 * Идентификатор ролика из ссылки или из него самого.
 * @returns {string|null}
 */
export function parseVideoId (input) {
  const raw = String(input ?? '').trim()
  if (raw === '') return null
  if (ID.test(raw)) return raw

  let url
  try {
    // Ссылку часто копируют без протокола — иначе URL её не примет.
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtu.be') return fromPath(url.pathname, 0)

  if (host !== 'youtube.com' && host !== 'm.youtube.com' &&
      host !== 'music.youtube.com' && host !== 'youtube-nocookie.com') {
    return null
  }

  const watch = url.searchParams.get('v')
  if (watch && ID.test(watch)) return watch

  // /embed/ID, /shorts/ID, /live/ID, /v/ID
  const segments = url.pathname.split('/').filter(Boolean)
  if (['embed', 'shorts', 'live', 'v'].includes(segments[0])) return fromPath(url.pathname, 1)

  return null
}

function fromPath (pathname, index) {
  const segment = pathname.split('/').filter(Boolean)[index]
  return segment && ID.test(segment) ? segment : null
}

/** Адрес обложки — её отдаёт CDN YouTube без запроса к API. */
export function thumbnailFor (id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

/** Страница ролика — нужна для ссылки «смотреть на YouTube». */
export function watchUrl (id) {
  return `https://www.youtube.com/watch?v=${id}`
}

/** Адрес плеера. Домен без кук — зритель не получает их до запуска. */
export function embedUrl (id, { autoplay = false } = {}) {
  const query = autoplay ? '?autoplay=1&rel=0' : '?rel=0'
  return `https://www.youtube-nocookie.com/embed/${id}${query}`
}

/**
 * Существует ли ролик и можно ли его встроить.
 *
 * @returns {Promise<{ok: true, id: string, title: string, author: string, thumbnail: string}
 *                 | {ok: false, reason: 'invalid'|'not_found'|'blocked'|'unreachable'}>}
 */
export async function lookupVideo (input, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const id = parseVideoId(input)
  if (!id) return { ok: false, reason: 'invalid' }

  const url = `${OEMBED}?url=${encodeURIComponent(watchUrl(id))}&format=json`
  const abort = AbortSignal.timeout(timeoutMs)

  let response
  try {
    response = await fetchImpl(url, { signal: abort })
  } catch {
    // Сеть недоступна — это не приговор ролику, и запретить
    // сохранение из-за неё нельзя.
    return { ok: false, reason: 'unreachable' }
  }

  // Несуществующий ролик YouTube отдаёт как 400 «Bad Request»,
  // а не 404: проверено на живом oEmbed.
  if (response.status === 400 || response.status === 404) return { ok: false, reason: 'not_found' }
  // 401 отдаётся на приватные и на закрытые для встраивания.
  if (response.status === 401 || response.status === 403) return { ok: false, reason: 'blocked' }
  if (!response.ok) return { ok: false, reason: 'unreachable' }

  let data
  try {
    data = await response.json()
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  return {
    ok: true,
    id,
    title: String(data.title ?? ''),
    author: String(data.author_name ?? ''),
    thumbnail: String(data.thumbnail_url ?? thumbnailFor(id))
  }
}
