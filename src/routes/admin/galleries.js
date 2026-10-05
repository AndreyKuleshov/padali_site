import { transaction } from '../../db/pool.js'
import { blocksUsingGallery } from '../../repositories/blocks.js'
import {
  listGalleries, getGallery, getGalleryBySlug, createGallery, renameGallery,
  deleteGallery, getGalleryTexts, textsForGalleries, saveGalleryTexts,
  getGalleryItems, setGalleryItems, itemFieldsForGalleries, appendGalleryItems, removeGalleryItems
} from '../../repositories/galleries.js'
import { getMediaByIds, listMediaForPicker } from '../../repositories/media.js'
import { listLocales } from '../../repositories/locales.js'
import { thumbnailUrl } from '../../services/media-processor.js'
import { setFlash } from '../../services/auth.js'
import { renderAdmin, afterWrite, numericId, itemKey, idList } from './helpers.js'

function slugify (value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 128)
}

async function galleryRoutes (app) {
  app.get('/galleries', async (request, reply) => {
    const [galleries, locales] = await Promise.all([listGalleries(), listLocales()])
    const defaultLocale = locales.find((row) => row.is_default)?.code ?? locales[0]?.code

    const textsByGallery = await textsForGalleries(galleries.map((gallery) => gallery.id))
    const withTitles = galleries.map((gallery) => ({
      ...gallery,
      title: textsByGallery.get(gallery.id)?.[defaultLocale]?.title ?? ''
    }))

    return renderAdmin(request, reply, 'admin/galleries', { galleries: withTitles, locales })
  })

  /**
   * Создание альбома, не уходя со страницы.
   *
   * Из формы блока «Мерч» или «Фотогалерея» альбома может ещё не
   * быть. Ссылка на страницу альбомов уводила с незаписанной
   * формой, и всё заполненное пропадало: так и случилось у
   * редактора. Поэтому отдельный ответ без переходов.
   */
  app.post('/galleries.json', async (request, reply) => {
    const slug = slugify(request.body?.slug)
    if (!slug) {
      return reply.code(400).send({ ok: false, message: request.t('galleries.slugRequired') })
    }
    if (await getGalleryBySlug(slug)) {
      return reply.code(409).send({ ok: false, message: request.t('galleries.slugTaken', { slug }) })
    }

    const id = await createGallery(slug)
    afterWrite()
    return reply.send({ ok: true, id, slug, label: `${slug} (0)` })
  })

  /** Состав альбома для формы блока: что уже лежит и сколько. */
  app.get('/galleries/:id/items.json', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const gallery = await getGallery(id)
    if (!gallery) return reply.callNotFound()

    const itemIds = await getGalleryItems(id)
    const [mediaById, fieldsByGallery] = await Promise.all([
      getMediaByIds(itemIds), itemFieldsForGalleries([id])
    ])
    const fields = fieldsByGallery.get(id) ?? new Map()
    const items = itemIds
      .map((mediaId) => mediaById.get(mediaId))
      .filter(Boolean)
      .map((media) => ({
        id: media.id,
        thumb: thumbnailUrl(media),
        name: media.originalName,
        title: fields.get(media.id)?.title ?? {},
        price: fields.get(media.id)?.price ?? ''
      }))

    return reply.send({ ok: true, id, slug: gallery.slug, count: items.length, items })
  })

  /**
   * Дописать фотографии в альбом из формы блока.
   *
   * Отдельный ответ, а не сохранение альбома целиком: форма блока
   * про состав альбома ничего не знает и, отправив его, стёрла бы
   * и порядок, и цены.
   */
  app.post('/galleries/:id/items.json', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const gallery = await getGallery(id)
    if (!gallery) return reply.callNotFound()

    const mediaIds = idList(request.body?.media)

    if (mediaIds.length === 0) {
      return reply.code(400).send({ ok: false, message: request.t('media.noFiles') })
    }

    const added = await appendGalleryItems(id, mediaIds)
    afterWrite()
    return reply.send({ ok: true, added })
  })

  /** Убрать снимок из альбома, не уходя из формы блока. */
  app.post('/galleries/:id/items/remove.json', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const gallery = await getGallery(id)
    if (!gallery) return reply.callNotFound()

    const mediaIds = idList(request.body?.media)

    if (mediaIds.length === 0) {
      return reply.code(400).send({ ok: false, message: request.t('media.noFiles') })
    }

    const removed = await removeGalleryItems(id, mediaIds)
    afterWrite()
    return reply.send({ ok: true, removed })
  })

  app.post('/galleries', async (request, reply) => {
    const slug = slugify(request.body?.slug)
    if (!slug) {
      setFlash(reply, 'error', request.t('galleries.slugRequired'))
      return reply.redirect('/admin/galleries', 302)
    }
    if (await getGalleryBySlug(slug)) {
      setFlash(reply, 'error', request.t('galleries.slugTaken', { slug }))
      return reply.redirect('/admin/galleries', 302)
    }

    const id = await createGallery(slug)
    afterWrite()
    return reply.redirect(`/admin/galleries/${id}`, 302)
  })

  app.get('/galleries/:id', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const gallery = await getGallery(id)
    if (!gallery) return reply.callNotFound()

    const [texts, itemIds, locales, library] = await Promise.all([
      getGalleryTexts(id), getGalleryItems(id), listLocales(), listMediaForPicker()
    ])

    const [mediaById, fieldsByGallery] = await Promise.all([
      getMediaByIds(itemIds), itemFieldsForGalleries([id])
    ])
    const fields = fieldsByGallery.get(id) ?? new Map()
    const items = itemIds
      .map((mediaId) => mediaById.get(mediaId))
      .filter(Boolean)
      .map((media) => ({
        id: media.id,
        thumb: thumbnailUrl(media),
        name: media.originalName,
        price: fields.get(media.id)?.price ?? ''
      }))

    // Где этот альбом уже вставлен — чтобы было видно последствия правок.
    const usedIn = await blocksUsingGallery(id)

    return renderAdmin(request, reply, 'admin/gallery-form', {
      gallery,
      texts,
      items,
      locales,
      usedIn,
      library: library.map((media) => ({
        id: media.id, thumb: thumbnailUrl(media), name: media.originalName
      }))
    })
  })

  app.post('/galleries/:id', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const gallery = await getGallery(id)
    if (!gallery) return reply.callNotFound()

    const locales = (await listLocales()).map((row) => row.code)
    const textsByLocale = {}
    for (const locale of locales) {
      textsByLocale[locale] = {
        title: String(request.body?.text?.[locale]?.title ?? '').trim(),
        description: String(request.body?.text?.[locale]?.description ?? '').trim()
      }
    }

    const mediaIds = idList(request.body?.items)

    const slug = slugify(request.body?.slug) || gallery.slug
    const clash = await getGalleryBySlug(slug)
    if (clash && clash.id !== id) {
      setFlash(reply, 'error', request.t('galleries.slugClash', { slug }))
      return reply.redirect(`/admin/galleries/${id}`, 302)
    }

    /* Цена едет вместе с составом: setGalleryItems переписывает
       строки целиком, и отдельным запросом после неё цену пришлось
       бы восстанавливать. */
    /* Название товара переводится и правится в блоке мерча, где
       рядом стоит строка перевода. Здесь — состав, порядок и
       цена; title не трогаем, иначе переписывание состава стёрло
       бы переводы. */
    const prices = request.body?.price ?? {}
    const existing = (await itemFieldsForGalleries([id])).get(id) ?? new Map()
    const items = mediaIds.map((mediaId) => ({
      mediaId,
      title: existing.get(mediaId)?.title,
      price: String(prices[itemKey(mediaId)] ?? '').trim().slice(0, 64)
    }))

    await transaction(async (conn) => {
      await renameGallery(id, slug, conn)
      await saveGalleryTexts(id, textsByLocale, conn)
      await setGalleryItems(id, items, conn)
    })

    afterWrite()
    setFlash(reply, 'success', request.t('galleries.saved', { count: mediaIds.length }))
    return reply.redirect(`/admin/galleries/${id}`, 302)
  })

  app.post('/galleries/:id/delete', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()

    const usedIn = await blocksUsingGallery(id)
    if (usedIn.length > 0) {
      setFlash(reply, 'error', request.t('galleries.inUse', { count: usedIn.length }))
      return reply.redirect(`/admin/galleries/${id}`, 302)
    }

    await deleteGallery(id)
    afterWrite()
    setFlash(reply, 'success', request.t('galleries.deleted'))
    return reply.redirect('/admin/galleries', 302)
  })
}

export default galleryRoutes
export { slugify }
