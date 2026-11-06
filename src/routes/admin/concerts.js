/*
 * Концерты в админке.
 *
 * Редактировать тут почти нечего — и это намеренно. Даты, площадки
 * и билеты приходят из Bandsintown; править их здесь значило бы
 * завести второй список, который разойдётся с первым в первую же
 * отмену. Поэтому всё, что пришло оттуда, показано как есть и не
 * редактируется, а форма у события одна и короткая: афиша и цена —
 * то, чего в Bandsintown нет.
 *
 * Форма у каждого события своя. Одной общей с номерами строк в
 * именах полей мы уже обжигались: числовой ключ qs считает индексом
 * массива и схлопывает разрывы, и правка уезжала к соседнему
 * концерту.
 */
import { setFlash } from '../../services/auth.js'
import { joinPrice } from '../../services/money.js'
import { syncConcerts, lastSyncedAt } from '../../services/concert-sync.js'
import { isBandsintownConfigured } from '../../services/bandsintown.js'
import { listEvents, getEvent, setEventFields } from '../../repositories/concerts.js'
import { getMediaByIds } from '../../repositories/media.js'
import { renderAdmin, afterWrite, numericId, mediaCard } from './helpers.js'

function asString (value) {
  if (Array.isArray(value)) value = value[0]
  return typeof value === 'string' ? value.trim() : ''
}

function asBoolean (value) {
  if (Array.isArray(value)) value = value.at(-1)
  return value === 'on' || value === 'true' || value === '1' || value === true
}

/** Первый id из `media[poster][]`; пусто — афишу сняли. */
function posterId (body) {
  const raw = body?.media?.poster
  const first = Array.isArray(raw) ? raw[0] : raw
  const id = Number(first)
  return Number.isInteger(id) && id > 0 ? id : null
}

async function concertRoutes (app) {
  app.get('/concerts', async (request, reply) => {
    const events = await listEvents()

    const posters = await getMediaByIds(events.map((event) => event.posterId).filter(Boolean))
    const withPosters = events.map((event) => {
      const media = event.posterId ? posters.get(event.posterId) : null
      return { ...event, poster: media ? mediaCard(media) : null }
    })

    return renderAdmin(request, reply, 'admin/concerts', {
      events: withPosters,
      configured: isBandsintownConfigured(),
      syncedAt: await lastSyncedAt()
    })
  })

  /* Обновить сейчас. Расписание и так обновляется само раз в час,
     но после правки в Bandsintown ждать этот час незачем. */
  app.post('/concerts/refresh', async (request, reply) => {
    if (!isBandsintownConfigured()) {
      setFlash(reply, 'error', request.t('concerts.notConfigured'))
      return reply.redirect('/admin/concerts', 302)
    }

    const result = await syncConcerts({ logger: request.log })
    if (result.ok) {
      setFlash(reply, 'success', request.t('concerts.refreshed', { count: result.fetched }))
    } else {
      setFlash(reply, 'error', request.t('concerts.refreshFailed', { error: result.error }))
    }
    return reply.redirect('/admin/concerts', 302)
  })

  app.post('/concerts/:id', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    if (!await getEvent(id)) return reply.callNotFound()

    /* Пишем ровно три колонки. Остальное принадлежит синхронизации,
       и форма, которая их не показывала, не вправе их тронуть. */
    await setEventFields(id, {
      posterId: posterId(request.body),
      price: joinPrice(asString(request.body?.price), asString(request.body?.price_currency)),
      priceFrom: asBoolean(request.body?.price_from)
    })

    afterWrite()
    setFlash(reply, 'success', request.t('concerts.saved'))
    return reply.redirect('/admin/concerts', 302)
  })
}

export default concertRoutes
