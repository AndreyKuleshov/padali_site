import { transaction } from '../../db/pool.js'
import { getBlockType, listBlockTypes, hasBlockType, defaultSettings } from '../../blocks/index.js'
import { getPageBySlug } from '../../repositories/pages.js'
import {
  listBlocks, getBlock, createBlock, updateBlock, setBlockVisibility,
  deleteBlock, reorderBlocks, getBlockTexts, textsForBlocks,
  getBlockMedia, saveBlockMedia, saveBlockTexts
} from '../../repositories/blocks.js'
import { getMediaByIds, listMedia } from '../../repositories/media.js'
import { listGalleries } from '../../repositories/galleries.js'
import { listLocales } from '../../repositories/locales.js'
import { parseBlockForm } from '../../services/block-form.js'
import { thumbnailUrl } from '../../services/media-processor.js'
import { setFlash } from '../../services/auth.js'
import { renderAdmin, afterWrite } from './helpers.js'

const HOME = 'home'

async function blockRoutes (app) {
  /* ─── Список блоков главной ─────────────────────────────── */
  app.get('/', async (request, reply) => {
    const page = await getPageBySlug(HOME)
    const blocks = page ? await listBlocks(page.id) : []
    const locales = await listLocales()

    // Подпись блока в списке — заголовок на языке по умолчанию.
    // Тексты всех блоков берём одним запросом, а не по запросу на блок.
    const defaultLocale = locales.find((row) => row.is_default)?.code ?? locales[0]?.code
    const textsByBlock = await textsForBlocks(blocks.map((block) => block.id))
    const summaries = blocks.map((block) => {
      const byLocale = textsByBlock.get(block.id)?.[defaultLocale] ?? {}
      return {
        ...block,
        descriptor: getBlockType(block.type),
        label: byLocale.heading || byLocale.title || byLocale.tagline || byLocale.nav_label || ''
      }
    })

    return renderAdmin(request, reply, 'admin/dashboard', {
      page,
      blocks: summaries,
      blockTypes: listBlockTypes(),
      locales
    })
  })

  /* ─── Создание ──────────────────────────────────────────── */
  app.post('/blocks', async (request, reply) => {
    const type = String(request.body?.type ?? '')
    if (!hasBlockType(type)) {
      setFlash(reply, 'error', `Неизвестный тип блока «${type}».`)
      return reply.redirect('/admin', 302)
    }

    const page = await getPageBySlug(HOME)
    const id = await createBlock({
      pageId: page.id,
      type,
      settings: defaultSettings(type),
      isVisible: false // новый блок не должен внезапно появиться на сайте
    })

    afterWrite()
    setFlash(reply, 'success', 'Блок создан. Заполните содержимое и включите показ.')
    return reply.redirect(`/admin/blocks/${id}`, 302)
  })

  /* ─── Форма блока ───────────────────────────────────────── */
  app.get('/blocks/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const block = await getBlock(id)
    const descriptor = block && getBlockType(block.type)
    if (!block || !descriptor) return reply.callNotFound()

    const [texts, mediaByField, galleries, locales] = await Promise.all([
      getBlockTexts(id), getBlockMedia(id), listGalleries(), listLocales()
    ])

    const mediaIds = Object.values(mediaByField).flat()
    const mediaById = await getMediaByIds(mediaIds)
    const previews = {}
    for (const [field, ids] of Object.entries(mediaByField)) {
      previews[field] = ids
        .map((mediaId) => mediaById.get(mediaId))
        .filter(Boolean)
        .map((media) => ({ id: media.id, thumb: thumbnailUrl(media), name: media.originalName }))
    }

    return renderAdmin(request, reply, 'admin/block-form', {
      block, descriptor, texts, previews, galleries, locales
    })
  })

  /* ─── Сохранение ────────────────────────────────────────── */
  app.post('/blocks/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const block = await getBlock(id)
    const descriptor = block && getBlockType(block.type)
    if (!block || !descriptor) return reply.callNotFound()

    const locales = (await listLocales()).map((row) => row.code)
    const parsed = parseBlockForm(descriptor, request.body, locales)

    // Обязательные поля проверяем до записи, чтобы не оставить блок наполовину сохранённым.
    const missing = (descriptor.settings ?? [])
      .filter((field) => field.required && !parsed.settings[field.key])
      .map((field) => field.label)
    if (missing.length > 0 && parsed.isVisible) {
      setFlash(reply, 'error', `Нельзя включить блок: не заполнено — ${missing.join(', ')}.`)
      return reply.redirect(`/admin/blocks/${id}`, 302)
    }

    await transaction(async (conn) => {
      await updateBlock(id, parsed, conn)
      await saveBlockTexts(id, parsed.textsByLocale, conn)
      await saveBlockMedia(id, parsed.mediaByField, conn)
    })

    afterWrite()
    setFlash(reply, 'success', 'Блок сохранён.')
    return reply.redirect(`/admin/blocks/${id}`, 302)
  })

  /* ─── Видимость, удаление, порядок ──────────────────────── */
  app.post('/blocks/:id/toggle', async (request, reply) => {
    const id = Number(request.params.id)
    const block = await getBlock(id)
    if (!block) return reply.callNotFound()

    await setBlockVisibility(id, !block.isVisible)
    afterWrite()
    return reply.redirect('/admin', 302)
  })

  app.post('/blocks/:id/delete', async (request, reply) => {
    const id = Number(request.params.id)
    await deleteBlock(id)
    afterWrite()
    setFlash(reply, 'success', 'Блок удалён.')
    return reply.redirect('/admin', 302)
  })

  app.post('/blocks/reorder', async (request, reply) => {
    const page = await getPageBySlug(HOME)
    const raw = request.body?.order
    const ids = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
      .map((value) => Number.parseInt(value, 10))
      .filter(Number.isInteger)

    await reorderBlocks(page.id, ids)
    afterWrite()
    return reply.send({ ok: true })
  })

  /* ─── Медиатека для модального выбора картинки ──────────── */
  app.get('/media.json', async () => {
    const media = await listMedia({ limit: 500 })
    return media.map((item) => ({
      id: item.id,
      thumb: thumbnailUrl(item),
      name: item.originalName,
      width: item.width,
      height: item.height
    }))
  })
}

export default blockRoutes
