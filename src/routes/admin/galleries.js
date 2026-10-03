import { query, transaction } from '../../db/pool.js'
import {
  listGalleries, getGallery, getGalleryBySlug, createGallery, renameGallery,
  deleteGallery, getGalleryTexts, textsForGalleries, saveGalleryTexts,
  getGalleryItems, setGalleryItems
} from '../../repositories/galleries.js'
import { getMediaByIds, listMedia } from '../../repositories/media.js'
import { listLocales } from '../../repositories/locales.js'
import { thumbnailUrl } from '../../services/media-processor.js'
import { setFlash } from '../../services/auth.js'
import { renderAdmin, afterWrite } from './helpers.js'

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

  app.post('/galleries', async (request, reply) => {
    const slug = slugify(request.body?.slug)
    if (!slug) {
      setFlash(reply, 'error', 'Укажите короткое имя альбома латиницей.')
      return reply.redirect('/admin/galleries', 302)
    }
    if (await getGalleryBySlug(slug)) {
      setFlash(reply, 'error', `Альбом «${slug}» уже есть.`)
      return reply.redirect('/admin/galleries', 302)
    }

    const id = await createGallery(slug)
    afterWrite()
    return reply.redirect(`/admin/galleries/${id}`, 302)
  })

  app.get('/galleries/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const gallery = await getGallery(id)
    if (!gallery) return reply.callNotFound()

    const [texts, itemIds, locales, library] = await Promise.all([
      getGalleryTexts(id), getGalleryItems(id), listLocales(), listMedia({ limit: 500 })
    ])

    const mediaById = await getMediaByIds(itemIds)
    const items = itemIds
      .map((mediaId) => mediaById.get(mediaId))
      .filter(Boolean)
      .map((media) => ({ id: media.id, thumb: thumbnailUrl(media), name: media.originalName }))

    // Где этот альбом уже вставлен — чтобы было видно последствия правок.
    const usedIn = await query(
      "SELECT id, type FROM blocks WHERE settings ->> 'gallery_id' = ?",
      [String(id)]
    )

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
    const id = Number(request.params.id)
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

    const raw = request.body?.items
    const mediaIds = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0)

    const slug = slugify(request.body?.slug) || gallery.slug
    const clash = await getGalleryBySlug(slug)
    if (clash && clash.id !== id) {
      setFlash(reply, 'error', `Короткое имя «${slug}» занято.`)
      return reply.redirect(`/admin/galleries/${id}`, 302)
    }

    await transaction(async (conn) => {
      await renameGallery(id, slug, conn)
      await saveGalleryTexts(id, textsByLocale, conn)
      await setGalleryItems(id, mediaIds, conn)
    })

    afterWrite()
    setFlash(reply, 'success', `Альбом сохранён: ${mediaIds.length} фото.`)
    return reply.redirect(`/admin/galleries/${id}`, 302)
  })

  app.post('/galleries/:id/delete', async (request, reply) => {
    const id = Number(request.params.id)

    const usedIn = await query(
      "SELECT id FROM blocks WHERE settings ->> 'gallery_id' = ?",
      [String(id)]
    )
    if (usedIn.length > 0) {
      setFlash(reply, 'error', `Альбом вставлен в блоков: ${usedIn.length}. Сначала уберите вставки.`)
      return reply.redirect(`/admin/galleries/${id}`, 302)
    }

    await deleteGallery(id)
    afterWrite()
    setFlash(reply, 'success', 'Альбом удалён. Фотографии остались в медиатеке.')
    return reply.redirect('/admin/galleries', 302)
  })
}

export default galleryRoutes
export { slugify }
