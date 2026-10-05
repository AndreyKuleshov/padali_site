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
  const node = {
    '@type': 'MusicEvent',
    name: `${band.name}${event.venue ? ' — ' + event.venue : ''}`,
    startDate: event.date,
    inLanguage: locale,
    performer: { '@type': 'MusicGroup', name: band.name },
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode'
  }

  if (event.venue) node.location = { '@type': 'Place', name: event.venue }
  if (event.poster?.src) node.image = config.publicUrl + event.poster.src

  /* Цена без валюты — не предложение: schema.org требует код
     валюты, и половинчатое предложение поиск отбрасывает целиком
     вместе с событием. */
  if (amount && currency) {
    node.offers = {
      '@type': 'Offer',
      price: amount,
      priceCurrency: currency,
      availability: 'https://schema.org/InStock',
      ...(event.ticket_url ? { url: event.ticket_url } : {})
    }
  } else if (event.ticket_url) {
    node.offers = { '@type': 'Offer', url: event.ticket_url, availability: 'https://schema.org/InStock' }
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
