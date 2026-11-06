/**
 * Разметка страницы для поисковиков: кто играет и где.
 *
 * Без неё концерт не попадает в блок «События» Google, а на запрос
 * «padali novi sad» поиск не знает, что это музыкальная группа, —
 * жанр и состав живут только в тексте страницы.
 *
 * Берём ровно то, что уже выведено на страницу: ни одного поля,
 * которого посетитель не видит. Описание, которого нет в разметке,
 * поисковику обещать нельзя.
 */
import config from '../config.js'
import { splitPrice } from './money.js'

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
    performer: { '@type': 'MusicGroup', name: band.name },
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
 * @param {object} view — то же, что уходит в шаблон страницы
 * @param {string} today — «ГГГГ-ММ-ДД», та же отсечка, что и у блока
 * @returns {object|null}
 */
function buildJsonLd (view, today = new Date().toISOString().slice(0, 10)) {
  const name = view?.meta?.title
  if (!name) return null

  const band = {
    '@type': 'MusicGroup',
    name,
    /* Адрес группы — всегда главная, а не та страница, где
       разметка оказалась: лендинг релиза группой не является. */
    url: config.publicUrl + (view.h?.localeUrl?.(view.locale, view.defaultLocale) ?? '/')
  }
  if (view.meta.description) band.description = view.meta.description
  if (view.ogImage) band.image = config.publicUrl + view.ogImage

  /* sameAs — те же ссылки, что стоят в шапке и в подвале: по ним
     поиск сшивает профили в один объект. */
  const social = (view.settings?.social ?? []).map((row) => row.url).filter(Boolean)
  if (social.length > 0) band.sameAs = social

  const events = (view.blocks ?? [])
    .filter((block) => block.type === 'concert')
    .flatMap((block) => upcoming(block.settings?.events ?? [], today))
    .map((event) => eventNode(event, { name }, view.locale))

  return { '@context': 'https://schema.org', '@graph': [band, ...events] }
}

export { buildJsonLd }
