import { listLocales } from '../../repositories/locales.js'
import { translate, isConfigured } from '../../services/translate.js'

/**
 * Перевод строки на все языки сайта.
 *
 * Ходим к модели с сервера: ключ не должен попадать в браузер.
 * Языки берём из базы, а не из запроса, — список языков сайта
 * решает админка, а не форма.
 */
async function translateRoutes (app) {
  app.post('/translate.json', async (request, reply) => {
    if (!isConfigured()) {
      return reply.code(503).send({
        ok: false, reason: 'not_configured', message: request.t('translate.notConfigured')
      })
    }

    const locales = await listLocales()
    const result = await translate({ text: request.body?.text, locales })

    if (result.ok) return reply.send(result)

    return reply.code(result.reason === 'empty' ? 400 : 502).send({
      ok: false,
      reason: result.reason,
      message: request.t(`translate.${result.reason}`)
    })
  })
}

export default translateRoutes
