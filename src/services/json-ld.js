/**
 * Разметка страницы для поисковиков и агентов: кто играет, где и что выпустил.
 *
 * Без неё концерт не попадает в блок «События» Google, а на запрос
 * «padali novi sad» поиск не знает, что это музыкальная группа, —
 * жанр и состав живут только в тексте страницы.
 *
 * Берём ровно то, что уже выведено на страницу: ни одного поля,
 * которого посетитель не видит. Описание, которого нет в разметке,
 * поисковику обещать нельзя.
 *
 * Узлы связаны через `@id`, а не повторены: иначе на лендинге
 * выходила вторая группа с тем же именем, и сшивать их поисковику
 * приходилось по догадке.
 */
import config from '../config.js'
import { splitPrice } from './money.js'
import { parseSpotify } from './spotify.js'
import { localeUrl } from './renderer.js'

/** Дата концерта в прошлом событию не нужна — она уже не событие. */
function upcoming (events, today) {
  return events.filter((event) => event.date && event.date >= today)
}

function eventNode (event, band, locale) {
  const { amount, currency } = splitPrice(event.price ?? '')
  const place = [event.venueName, event.venueCity].filter(Boolean).join(', ')
  const node = {
    '@type': 'MusicEvent',
    name: `${band.name}${place ? ' — ' + place : ''}`,
    /* Со временем, когда оно объявлено: час концерта поиск
       показывает рядом с датой, а выдумывать его нельзя — у
       события бывает объявлен только день. */
    startDate: event.showTime ? event.startsAt : event.date,
    inLanguage: locale,
    performer: { '@id': band['@id'] },
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode'
  }

  if (event.venueName) {
    node.location = { '@type': 'Place', name: event.venueName }
    /* Адрес кладём разобранным: строкой поиск его не связывает с
       картой, и событие показывается без места. */
    const address = {
      '@type': 'PostalAddress',
      ...(event.venueAddress ? { streetAddress: event.venueAddress } : {}),
      ...(event.venueCity ? { addressLocality: event.venueCity } : {}),
      ...(event.venueCountry ? { addressCountry: event.venueCountry } : {})
    }
    if (Object.keys(address).length > 1) node.location.address = address
  }

  /* Описание берём то же, что стоит на странице: переведённое, а
     нет перевода — исходное. Обещать поисковику текст, которого
     посетитель не увидит, нельзя. */
  if (event.description) node.description = event.description
  if (event.eventUrl) node.url = event.eventUrl
  if (event.poster?.src) node.image = config.publicUrl + event.poster.src

  /* Распродано — это состояние предложения, а не отсутствие
     события: поиск тогда так и пишет, вместо того чтобы вести на
     закрытую продажу. */
  const availability = event.soldOut
    ? 'https://schema.org/SoldOut'
    : 'https://schema.org/InStock'

  /* Цена без валюты — не предложение: schema.org требует код
     валюты, и половинчатое предложение поиск отбрасывает целиком
     вместе с событием. */
  if (amount && currency) {
    node.offers = {
      '@type': 'Offer',
      price: amount,
      priceCurrency: currency,
      availability,
      ...(event.ticketUrl ? { url: event.ticketUrl } : {})
    }
  } else if (event.ticketUrl) {
    node.offers = { '@type': 'Offer', url: event.ticketUrl, availability }
  }

  return node
}

/**
 * Запись: лендинг релиза и блок релиза на главной.
 *
 * Трек или альбом — об этом говорит сама ссылка на Spotify
 * (`/track/` или `/album/`), и гадать не приходится. Нет ссылки —
 * считаем записью: лендинг этой группы продаёт сингл, а
 * объявить альбом альбомом можно только зная, что он альбом.
 *
 * Все площадки идут в `sameAs`: это одна и та же запись в разных
 * витринах, и поиск сшивает их в одну именно так.
 */
function releaseNode (block, band, locale, pageUrl, today) {
  const title = block.text?.title
  if (!title) return null

  const settings = block.settings ?? {}
  const kind = parseSpotify(settings.spotify_url)?.kind
  const node = {
    '@type': kind === 'album' || kind === 'playlist' ? 'MusicAlbum' : 'MusicRecording',
    name: title,
    url: pageUrl,
    inLanguage: locale
  }

  /* Исполнитель — ссылка на ту же группу, а не имя из строки
     «by»: там стоит подпись для глаза («by PADALI», «PADALI feat.
     кто-то»), и взятая как имя она заводила исполнителя «by
     PADALI» — второго артиста, которого не существует. */
  node.byArtist = { '@id': band['@id'] }

  const cover = block.first?.('cover')
  if (cover?.src) node.image = config.publicUrl + cover.src
  if (block.text?.note) node.description = block.text.note

  const links = [
    settings.spotify_url,
    ...(Array.isArray(settings.platforms) ? settings.platforms.map((row) => row.url) : [])
  ].filter(Boolean)
  if (links.length > 0) node.sameAs = [...new Set(links)]

  /* Дата выхода — только у вышедшего. У невышедшего она стоит на
     странице отсчётом «до выхода», и назвать её датой публикации
     значит сказать, что запись уже слушают. */
  if (settings.release_date && settings.release_date <= today) {
    node.datePublished = settings.release_date
  }

  /* Кнопка «купить» — предложение без цены: цену лендинг не
     объявляет, а выдумать её нельзя. */
  if (settings.show_buy && settings.buy_url) {
    node.offers = {
      '@type': 'Offer',
      url: settings.buy_url,
      availability: 'https://schema.org/InStock'
    }
  }

  return node
}

/**
 * @param {object} view — то же, что уходит в шаблон страницы
 * @param {string} today — «ГГГГ-ММ-ДД», та же отсечка, что и у блока
 * @returns {object|null}
 */
function buildJsonLd (view, today = new Date().toISOString().slice(0, 10)) {
  /* Имя группы — имя сайта, а не заголовок страницы: иначе на
     лендинге «POČETAK — PADALI» выходила группа с таким именем. */
  const name = view?.siteName || view?.meta?.title
  if (!name) return null

  /* Группа одна на весь сайт, поэтому её адрес и `@id` — главная
     на языке по умолчанию, а не та страница и не тот язык, где
     разметка оказалась: иначе у сербской версии выходила своя
     отдельная группа с тем же именем. */
  const homeUrl = config.publicUrl + localeUrl(view.defaultLocale, view.defaultLocale)
  const pageUrl = config.publicUrl + localeUrl(view.locale, view.defaultLocale, view.path)

  const band = {
    '@type': 'MusicGroup',
    /* Адрес группы — всегда главная, а не та страница, где
       разметка оказалась: лендинг релиза группой не является. */
    '@id': homeUrl + '#band',
    name,
    url: homeUrl
  }
  if (view.meta?.description) band.description = view.meta.description
  if (view.ogImage) band.image = config.publicUrl + view.ogImage

  /* sameAs — те же ссылки, что стоят в шапке и в подвале: по ним
     поиск сшивает профили в один объект. */
  const social = (view.settings?.social ?? []).map((row) => row.url).filter(Boolean)
  if (social.length > 0) band.sameAs = social

  const graph = [band]

  /* Имя сайта в выдаче Google берёт из узла WebSite, и объявлять
     его полагается на главной: на внутренней странице тот же узел
     заводит второй сайт внутри сайта. */
  if (!view.path) {
    graph.push({
      '@type': 'WebSite',
      '@id': homeUrl + '#website',
      name,
      url: homeUrl,
      inLanguage: view.locale,
      publisher: { '@id': band['@id'] }
    })
  }

  const blocks = view.blocks ?? []

  for (const block of blocks) {
    if (block.type !== 'landing' && block.type !== 'release') continue
    const node = releaseNode(block, band, view.locale, pageUrl, today)
    if (node) graph.push(node)
  }

  for (const block of blocks) {
    if (block.type !== 'concert') continue
    for (const event of upcoming(block.settings?.events ?? [], today)) {
      graph.push(eventNode(event, band, view.locale))
    }
  }

  return { '@context': 'https://schema.org', '@graph': graph }
}

export { buildJsonLd }
