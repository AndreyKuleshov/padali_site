import { transaction } from '../../db/pool.js'
import {
  listMedia, countMedia, getMedia, getMediaTexts, saveMediaTexts,
  mediaUsage, usageCounts, deleteMedia, textsForMedia
} from '../../repositories/media.js'
import { listLocales } from '../../repositories/locales.js'
import { processUpload, deleteFiles, thumbnailUrl, UploadError } from '../../services/media-processor.js'
import { verifyCsrf, setFlash } from '../../services/auth.js'
import { renderAdmin, afterWrite } from './helpers.js'

const PER_PAGE = 60

async function mediaRoutes (app) {
  app.get('/media', async (request, reply) => {
    const pageNumber = Math.max(Number.parseInt(request.query?.page ?? '1', 10) || 1, 1)
    const [items, total, locales] = await Promise.all([
      listMedia({ limit: PER_PAGE, offset: (pageNumber - 1) * PER_PAGE }),
      countMedia(),
      listLocales()
    ])

    const ids = items.map((item) => item.id)
    const [uses, texts] = await Promise.all([usageCounts(ids), textsForMedia(ids)])

    return renderAdmin(request, reply, 'admin/media', {
      items: items.map((item) => ({
        ...item,
        thumb: thumbnailUrl(item),
        uses: uses.get(item.id) ?? 0,
        texts: texts.get(item.id) ?? {}
      })),
      total,
      pageNumber,
      pageCount: Math.max(Math.ceil(total / PER_PAGE), 1),
      locales
    })
  })

  /**
   * Приём multipart-загрузки.
   *
   * CSRF проверяется здесь, а не в общем хуке: тело — поток частей,
   * и токен становится известен только когда до него дочитали.
   * В разметке скрытое поле стоит перед файлом, поэтому к первой
   * же части с файлом токен уже разобран.
   *
   * @returns {Promise<{uploaded: Array, errors: string[]}>}
   */
  async function consumeUpload (request) {
    let csrfField = null
    const uploaded = []
    const errors = []

    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === '_csrf') csrfField = String(part.value)
        continue
      }

      if (!csrfField) throw new Error(request.t('common.csrfExpired'))
      request.body = { _csrf: csrfField }
      if (!verifyCsrf(request)) throw new Error(request.t('common.csrfExpired'))

      const buffer = await part.toBuffer()
      try {
        const { media, deduplicated } = await processUpload({
          buffer,
          originalName: part.filename ?? 'upload',
          mime: part.mimetype
        })
        uploaded.push({ media, name: media.originalName, deduplicated })
      } catch (error) {
        if (error instanceof UploadError) errors.push(`${part.filename}: ${error.message}`)
        else throw error
      }
    }

    return { uploaded, errors }
  }

  app.post('/media/upload', async (request, reply) => {
    let uploaded = []
    let errors = []

    try {
      ({ uploaded, errors } = await consumeUpload(request))
    } catch (error) {
      request.log.error(error, 'Ошибка загрузки файла')
      setFlash(reply, 'error', error.message)
      return reply.redirect('/admin/media', 302)
    }

    afterWrite()
    const duplicates = uploaded.filter((item) => item.deduplicated).length
    const added = uploaded.length - duplicates
    const parts = []
    if (added > 0) parts.push(request.t('media.uploaded', { count: added }))
    if (duplicates > 0) parts.push(request.t('media.duplicates', { count: duplicates }))
    if (errors.length > 0) parts.push(request.t('media.failed', { details: errors.join('; ') }))

    setFlash(reply, errors.length > 0 ? 'error' : 'success', parts.join(', ') || request.t('media.noFiles'))
    return reply.redirect('/admin/media', 302)
  })

  /**
   * Та же загрузка, но ответом — JSON с готовыми картинками.
   *
   * Нужна формам блоков и настройкам: иначе, чтобы поменять
   * логотип, пришлось бы уходить на страницу медиатеки, грузить
   * файл там и возвращаться за ним в выбор — и терять по дороге
   * незаписанные правки формы.
   */
  app.post('/media/upload.json', async (request, reply) => {
    let uploaded = []
    let errors = []

    try {
      ({ uploaded, errors } = await consumeUpload(request))
    } catch (error) {
      request.log.error(error, 'Ошибка загрузки файла')
      return reply.code(400).send({ items: [], errors: [error.message] })
    }

    afterWrite()
    return reply.send({
      items: uploaded.map(({ media }) => ({
        id: media.id, name: media.originalName, thumb: thumbnailUrl(media)
      })),
      errors
    })
  })

  /** Сохранение alt и подписи на всех языках. */
  app.post('/media/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const media = await getMedia(id)
    if (!media) return reply.callNotFound()

    const locales = (await listLocales()).map((row) => row.code)
    const textsByLocale = {}
    for (const locale of locales) {
      textsByLocale[locale] = {
        alt: String(request.body?.text?.[locale]?.alt ?? '').trim(),
        caption: String(request.body?.text?.[locale]?.caption ?? '').trim()
      }
    }

    await saveMediaTexts(id, textsByLocale)
    afterWrite()
    setFlash(reply, 'success', request.t('media.textsSaved'))
    return reply.redirect('/admin/media', 302)
  })

  /** Удаление запрещено, пока файл где-то используется. */
  app.post('/media/:id/delete', async (request, reply) => {
    const id = Number(request.params.id)
    const media = await getMedia(id)
    if (!media) return reply.callNotFound()

    const usage = await mediaUsage(id)
    if (usage.isUsed) {
      const where = [
        usage.blocks.length > 0 ? request.t('media.inBlocks', { count: usage.blocks.length }) : null,
        usage.galleries.length > 0 ? request.t('media.inAlbums', { count: usage.galleries.length }) : null
      ].filter(Boolean).join(', ')
      setFlash(reply, 'error', request.t('media.stillUsed', { where }))
      return reply.redirect('/admin/media', 302)
    }

    // Запись удаляем в транзакции, файлы — после успешного коммита:
    // осиротевшая запись хуже осиротевшего файла.
    await transaction(async (conn) => { await deleteMedia(id, conn) })
    await deleteFiles(media)

    afterWrite()
    setFlash(reply, 'success', request.t('media.deleted'))
    return reply.redirect('/admin/media', 302)
  })

  app.get('/media/:id/texts.json', async (request) => {
    const id = Number(request.params.id)
    return getMediaTexts(id)
  })
}

export default mediaRoutes
