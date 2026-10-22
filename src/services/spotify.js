/**
 * Ссылки на Spotify.
 *
 * Разбор отдельно от шаблона по той же причине, что у YouTube:
 * форматов адреса несколько, и знать о них должен один файл, а не
 * каждое место, где ссылку показывают.
 *
 * Проверять существование записи запросом нельзя: открытого ответа
 * у Spotify нет, oEmbed закрыт ключом. Поэтому ограничиваемся
 * разбором — он отличает «это не Spotify» от «это трек», а дальше
 * плеер говорит сам за себя.
 */

/* Идентификатор Spotify — 22 знака base62. Длину не проверяем
   числом: у подкастов она та же, а у чужих ссылок бывает другая,
   и жёсткое «ровно 22» отсекло бы их молча. */
const ID = /^[A-Za-z0-9]{10,40}$/

/* Что умеет встраиваться. Артист и подкаст сюда же: лендинг
   релиза ими не пользуется, но запрещать их незачем — плеер
   отрисует, а редактор сам знает, что вставляет. */
const KINDS = new Set(['track', 'album', 'playlist', 'artist', 'episode', 'show'])

/**
 * Разбор ссылки или URI.
 *
 * @returns {{kind: string, id: string} | null}
 */
export function parseSpotify (input) {
  const raw = String(input ?? '').trim()
  if (raw === '') return null

  /* spotify:track:ID — то, что даёт «Copy Spotify URI». Редакторы
     приносят и его, а на URL он не похож совсем. */
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/.exec(raw)
  if (uri) return KINDS.has(uri[1]) && ID.test(uri[2]) ? { kind: uri[1], id: uri[2] } : null

  let url
  try {
    // Ссылку часто копируют без протокола — иначе URL её не примет.
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '')
  if (host !== 'open.spotify.com' && host !== 'play.spotify.com') return null

  /* Ссылка из приложения бывает с языковым префиксом:
     /intl-sr/track/ID. Отбрасываем всё, что стоит до вида записи. */
  const segments = url.pathname.split('/').filter(Boolean)
  const at = segments.findIndex((segment) => KINDS.has(segment))
  if (at === -1) return null

  const kind = segments[at]
  const id = segments[at + 1]
  return id && ID.test(id) ? { kind, id } : null
}

/**
 * Адрес плеера.
 *
 * Высоту задаёт не адрес, а вёрстка: у компактного плеера она 152,
 * у обычного 352, и выбирать это должен шаблон, который знает,
 * сколько места есть.
 */
export function embedUrl (input) {
  const parsed = parseSpotify(input)
  /* theme=0 — тёмный вид плеера. По умолчанию Spotify красит рамку
     под обложку, и на чёрной странице это выходит синим пятном
     поперёк вёрстки. */
  return parsed ? `https://open.spotify.com/embed/${parsed.kind}/${parsed.id}?theme=0` : null
}

/** Страница записи — для ссылки «открыть в Spotify». */
export function listenUrl (input) {
  const parsed = parseSpotify(input)
  return parsed ? `https://open.spotify.com/${parsed.kind}/${parsed.id}` : null
}
