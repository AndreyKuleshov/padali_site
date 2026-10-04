import { transaction } from '../../db/pool.js'
import {
  getBlockType, listBlockTypes, hasBlockType, defaultSettings, sortBlocks, pinOf, nextAnchor
} from '../../blocks/index.js'
import { getPageBySlug } from '../../repositories/pages.js'
import {
  listBlocks, getBlock, createBlock, updateBlock, setBlockVisibility,
  deleteBlock, reorderBlocks, getBlockTexts, textsForBlocks,
  getBlockMedia, saveBlockMedia, saveBlockTexts
} from '../../repositories/blocks.js'
import { getMediaByIds, listMediaForPicker } from '../../repositories/media.js'
import { listGalleries, setGalleryItemFields } from '../../repositories/galleries.js'
import { listLocales } from '../../repositories/locales.js'
import { parseBlockForm } from '../../services/block-form.js'
import { thumbnailUrl } from '../../services/media-processor.js'
import { setFlash } from '../../services/auth.js'
import { renderAdmin, afterWrite, numericId } from './helpers.js'
import { localize } from '../../i18n/admin.js'
import { currentSiteLogo } from '../../services/site-logo.js'
import { lookupVideo } from '../../services/youtube.js'

const HOME = 'home'

/**
 * `{ m7: {...} }` → `{ 7: {...} }`.
 *
 * Ключ в форме с буквой: qs считает «item[7]» индексом массива,
 * схлопывает разрывы и теряет привязку к снимку.
 */
function stripPrefix (fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    const id = Number(String(key).replace(/^m/, ''))
    if (id) out[id] = value
  }
  return out
}

/** Пустые переводы названия не храним: иначе откат на язык по
 *  умолчанию не сработает. */
function cleanTitles (fields) {
  for (const item of Object.values(fields)) {
    if (!item || typeof item.title !== 'object') continue
    for (const [locale, value] of Object.entries(item.title)) {
      if (String(value ?? '').trim() === '') delete item.title[locale]
    }
  }
  return fields
}

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
    // Тот же порядок, что и на сайте: закреплённые по краям.
    const summaries = sortBlocks(blocks).map((block) => {
      const byLocale = textsByBlock.get(block.id)?.[defaultLocale] ?? {}
      return {
        ...block,
        descriptor: getBlockType(block.type),
        pinned: pinOf(block.type),
        label: byLocale.heading || byLocale.title || byLocale.tagline || byLocale.nav_label || ''
      }
    })

    return renderAdmin(request, reply, 'admin/dashboard', {
      page,
      blocks: summaries,
      blockTypes: listBlockTypes(blocks.map((block) => block.type)),
      locales
    })
  })

  /* ─── Создание ──────────────────────────────────────────── */
  app.post('/blocks', async (request, reply) => {
    const type = String(request.body?.type ?? '')
    if (!hasBlockType(type)) {
      setFlash(reply, 'error', request.t('blocks.unknownTypeError', { type }))
      return reply.redirect('/admin', 302)
    }

    const page = await getPageBySlug(HOME)

    // Из выпадайки такой тип уже убран, но запрос мог прийти и
    // мимо неё — со старой открытой вкладки или вручную.
    if (pinOf(type)) {
      const existing = await listBlocks(page.id)
      if (existing.some((block) => block.type === type)) {
        setFlash(reply, 'error', request.t('blocks.alreadyOnPage', {
          title: localize(getBlockType(type).title, request.adminLocale)
        }))
        return reply.redirect('/admin', 302)
      }
    }

    /* Якорь и пункт меню заполняем сразу. В меню попадает только
       блок, у которого есть и то и другое; пустые поля редактор
       чаще пропускает, и блок молча оставался бы вне меню. Оба
       остаются обычными полями — можно переписать или очистить. */
    const descriptor = getBlockType(type)
    const blocks = await listBlocks(page.id)
    const anchor = nextAnchor(descriptor.defaults?.anchor, blocks.map((block) => block.anchor))

    const id = await createBlock({
      pageId: page.id,
      type,
      settings: defaultSettings(type),
      anchor,
      isVisible: false // новый блок не должен внезапно появиться на сайте
    })

    if (descriptor.defaults?.navLabel) {
      const locales = await listLocales()
      const textsByLocale = {}
      for (const { code } of locales) {
        textsByLocale[code] = { nav_label: localize(descriptor.defaults.navLabel, code) }
      }
      await saveBlockTexts(id, textsByLocale)
    }

    afterWrite()
    setFlash(reply, 'success', request.t('blocks.created'))
    return reply.redirect(`/admin/blocks/${id}`, 302)
  })

  /* ─── Форма блока ───────────────────────────────────────── */
  app.get('/blocks/:id', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
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

    // Поле логотипа показывает действующую картинку, даже когда
    // своей у блока нет, — считаем её только если такое поле есть.
    const inherits = (descriptor.media || []).some((field) => field.fallback === 'siteLogo')
    const siteLogo = inherits ? await currentSiteLogo() : null

    return renderAdmin(request, reply, 'admin/block-form', {
      block, descriptor, texts, previews, galleries, locales, siteLogo
    })
  })

  /* ─── Сохранение ────────────────────────────────────────── */
  app.post('/blocks/:id', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const block = await getBlock(id)
    const descriptor = block && getBlockType(block.type)
    if (!block || !descriptor) return reply.callNotFound()

    const locales = (await listLocales()).map((row) => row.code)
    const parsed = parseBlockForm(descriptor, request.body, locales)

    /* Незаполненное обязательное поле гасит показ, но не отменяет
       запись. Раньше здесь стоял редирект, и длинная форма —
       тексты на двух языках, картинки, цены товаров — пропадала
       целиком ради одной незаполненной строки. */
    const missing = (descriptor.settings ?? [])
      .filter((field) => field.required && !parsed.settings[field.key])
      .map((field) => localize(field.label, request.adminLocale))
    if (missing.length > 0) parsed.isVisible = false

    /* Якорь при сохранении только сохраняем, а не принимаем из
       формы. Заодно доназначаем тем блокам, что заводились до
       автоматической выдачи: без якоря блок не попадает в меню,
       а поля, чтобы вписать его руками, больше нет. */
    const blocks = await listBlocks(block.pageId)
    const anchor = block.anchor || nextAnchor(
      descriptor.defaults?.anchor,
      blocks.map((other) => other.anchor)
    )

    /* Названия и цены товаров живут в альбоме, но правятся здесь:
       уходить за ними на страницу альбома из формы блока —
       лишний круг. Пишем только те, что прислала форма, и только
       в выбранный альбом. */
    const picker = (descriptor.settings ?? []).find((field) => field.itemFields)
    const albumId = picker ? Number(parsed.settings[picker.key]) : 0

    /* Карточки рисует браузер по ответу items.json, и при смене
       альбома в выпадайке они обновляются не мгновенно. Если
       сохранить в этот промежуток, строки предыдущего альбома
       ушли бы в новый и затёрли бы там одноимённые снимки.
       Поэтому форма присылает, для какого альбома она их
       нарисовала, и расхождение означает «не писать». */
    const drawnFor = Number(request.body?.item_album)
    const itemFields = drawnFor === albumId ? request.body?.item : null

    await transaction(async (conn) => {
      await updateBlock(id, { ...parsed, anchor }, conn)
      await saveBlockTexts(id, parsed.textsByLocale, conn)
      await saveBlockMedia(id, parsed.mediaByField, conn)
      if (albumId && itemFields) {
        await setGalleryItemFields(albumId, cleanTitles(stripPrefix(itemFields)), conn)
      }
    })

    afterWrite()
    if (missing.length > 0) {
      setFlash(reply, 'error', request.t('blocks.savedNotShown', { fields: missing.join(', ') }))
    } else {
      setFlash(reply, 'success', request.t('blocks.saved'))
    }
    return reply.redirect(`/admin/blocks/${id}`, 302)
  })

  /**
   * Проверка ролика для поля в форме.
   *
   * Ходить к YouTube из браузера редактора нельзя: oEmbed не
   * обещает заголовков CORS, и запрос бы молча падал. Поэтому
   * спрашиваем с сервера и возвращаем уже готовый ответ с
   * переведённым сообщением.
   */
  app.get('/youtube.json', async (request, reply) => {
    const result = await lookupVideo(request.query?.url ?? '')
    if (result.ok) return reply.send(result)

    return reply.send({
      ok: false,
      reason: result.reason,
      message: request.t(`youtube.${result.reason}`)
    })
  })

  /* ─── Видимость, удаление, порядок ──────────────────────── */
  app.post('/blocks/:id/toggle', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const block = await getBlock(id)
    if (!block) return reply.callNotFound()

    await setBlockVisibility(id, !block.isVisible)
    afterWrite()
    return reply.redirect('/admin', 302)
  })

  app.post('/blocks/:id/delete', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const block = await getBlock(id)
    if (!block) return reply.callNotFound()

    /* Шапку и подвал удалить нельзя: страница без них выглядит
       обрубленной, а вернуть их редактор не смог бы — заводятся
       они при установке. Не нужны на время — достаточно выключить
       показ. Кнопки удаления у них нет, но запрос мог прийти и
       мимо неё: со старой вкладки или вручную. */
    if (pinOf(block.type)) {
      setFlash(reply, 'error', request.t('blocks.cannotDeletePinned', {
        title: localize(getBlockType(block.type)?.title ?? block.type, request.adminLocale)
      }))
      return reply.redirect('/admin', 302)
    }

    await deleteBlock(id)
    afterWrite()
    setFlash(reply, 'success', request.t('blocks.deleted'))
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
    const media = await listMediaForPicker()
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
