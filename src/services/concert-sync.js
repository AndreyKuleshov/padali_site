/**
 * Синхронизация концертов с Bandsintown.
 *
 * Что делает один заход: забирает предстоящие события, переписывает
 * ими колонки источника, убирает то, чего в ответе больше нет, и
 * заказывает перевод описания — только у новых и у изменившихся.
 *
 * Чего НЕ делает: не трогает афишу и цену. Их ставит редактор, и
 * заход раз в час стирал бы его работу — поэтому синхронизация про
 * эти колонки не знает вовсе (см. `upsertEvent`).
 *
 * Не удалась — ничего не меняется: на странице остаётся последняя
 * удачная копия из базы. Отказ чужой службы не касается посетителя.
 */
import config from '../config.js'
import { transaction } from '../db/pool.js'
import {
  eventsByBitId, upsertEvent, deleteEventsExcept,
  textsForEvents, replaceEventTexts
} from '../repositories/concerts.js'
import { listLocales } from '../repositories/locales.js'
import { getSetting, setSetting } from '../repositories/settings.js'
import { fetchEvents, isBandsintownConfigured } from './bandsintown.js'
import { translate } from './translate.js'
import { invalidateCache } from './cache.js'

/** Когда синхронизация удалась в последний раз. */
const SYNCED_AT = 'bandsintown_synced_at'

/*
 * Два захода разом не нужны и вредны: оба увидят одинаковое «надо
 * перевести» и дважды заплатят за перевод. Защёлка на процесс —
 * процесс у нас один.
 */
let running = false

/**
 * Описания, которым нужен перевод.
 *
 * Переводим новое и изменившееся, а ещё то, у чего перевода просто
 * нет: первый заход после добавления языка или после неудачи модели
 * должен его дозаказать. Пустое описание не переводим — переводить
 * нечего, и модель на пустой строке отвечает отказом.
 */
function needTranslation (events, before, textsByEvent) {
  return events.filter((event) => {
    if (event.description === '') return false
    const previous = before.get(event.bitId)
    if (!previous) return true
    if (previous.description !== event.description) return true
    const texts = textsByEvent.get(event.id)
    return !texts || Object.keys(texts).length === 0
  })
}

/**
 * Один заход.
 *
 * @returns {Promise<{ok: boolean, fetched?: number, removed?: number,
 *                    translated?: number, error?: string}>}
 */
export async function syncConcerts ({
  fetchImpl = fetch,
  settings = config.bandsintown,
  translateImpl = translate,
  translateSettings = config.openai,
  logger = console
} = {}) {
  if (!isBandsintownConfigured(settings)) return { ok: false, error: 'не настроено' }
  if (running) return { ok: false, error: 'уже идёт' }
  running = true

  try {
    const result = await fetchEvents({ fetchImpl, settings })
    if (!result.ok) {
      logger.warn?.(`Bandsintown: расписание не обновилось (${result.error}). На сайте остаётся прежнее.`)
      return { ok: false, error: result.error }
    }

    const { events } = result
    const locales = await listLocales()

    /* Запись и чистка — одной транзакцией: между «записали новые» и
       «убрали старые» страница не должна увидеть ни пустого
       расписания, ни двух версий одного концерта. */
    const { before, stored, removed } = await transaction(async (conn) => {
      const before = await eventsByBitId(conn)
      const stored = []
      for (const event of events) {
        stored.push({ ...event, id: await upsertEvent(event, conn) })
      }
      const removed = await deleteEventsExcept(events.map((event) => event.bitId), conn)
      return { before, stored, removed }
    })

    /* Перевод — вне транзакции: это запрос к чужой модели на
       десятки секунд, и держать на нём открытую транзакцию нельзя. */
    const texts = await textsForEvents(stored.map((event) => event.id))
    const pending = needTranslation(stored, before, texts)

    let translated = 0
    for (const event of pending) {
      const answer = await translateImpl(
        { text: event.description, locales }, { settings: translateSettings }
      )
      if (!answer.ok) {
        /* Не перевелось — описание всё равно показывается: на языке
           оригинала оно понятнее, чем пустое место. Следующий заход
           попробует снова, потому что строк перевода так и нет. */
        logger.warn?.(`Bandsintown: описание концерта ${event.bitId} не перевелось (${answer.reason}).`)
        continue
      }
      const byLocale = {}
      for (const [code, value] of Object.entries(answer.translations)) {
        byLocale[code] = { description: value }
      }
      await replaceEventTexts(event.id, byLocale)
      translated += 1
    }

    await setSetting(SYNCED_AT, new Date().toISOString())

    /* Кэш страниц держит отрисованный HTML и сам по себе не
       протухает: без сброса новый концерт появился бы только после
       правки в админке. */
    invalidateCache()

    logger.info?.(
      `Bandsintown: концертов ${stored.length}` +
      (removed > 0 ? `, убрано ${removed}` : '') +
      (translated > 0 ? `, переведено описаний ${translated}` : '') + '.'
    )
    return { ok: true, fetched: stored.length, removed, translated }
  } catch (error) {
    logger.warn?.(`Bandsintown: синхронизация не удалась (${error?.message ?? error}).`)
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    running = false
  }
}

/** Когда расписание обновлялось в последний раз; null — ни разу. */
export async function lastSyncedAt () {
  const value = await getSetting(SYNCED_AT, null)
  return typeof value === 'string' ? value : null
}

export { SYNCED_AT }
