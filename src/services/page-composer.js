import { getBlockType, sortBlocks } from '../blocks/index.js'
import { getPageBySlug, getPageTexts } from '../repositories/pages.js'
import { listBlocks, textsForBlocks, mediaForBlocks } from '../repositories/blocks.js'
import {
  itemsForGalleries, itemFieldsForGalleries, textsForGalleries
} from '../repositories/galleries.js'
import { getMediaByIds, textsForMedia } from '../repositories/media.js'
import { listLocales, getDefaultLocale } from '../repositories/locales.js'
import { getAllSettings } from '../repositories/settings.js'
import { pictureSources } from './media-processor.js'

/** Значение на нужном языке, иначе на языке по умолчанию, иначе пустая строка. */
function pick (textsByLocale, locale, defaultLocale, field) {
  return textsByLocale?.[locale]?.[field]
      ?? textsByLocale?.[defaultLocale]?.[field]
      ?? ''
}

/** Все поля сущности, разрешённые на нужный язык. */
function resolveTexts (textsByLocale, locale, defaultLocale) {
  const fields = new Set([
    ...Object.keys(textsByLocale?.[defaultLocale] ?? {}),
    ...Object.keys(textsByLocale?.[locale] ?? {})
  ])
  const resolved = {}
  for (const field of fields) {
    resolved[field] = pick(textsByLocale, locale, defaultLocale, field)
  }
  return resolved
}

function viewMedia (media, textsByLocale, locale, defaultLocale) {
  if (!media) return null
  return {
    id: media.id,
    alt: pick(textsByLocale, locale, defaultLocale, 'alt'),
    caption: pick(textsByLocale, locale, defaultLocale, 'caption'),
    ...pictureSources(media)
  }
}

/**
 * Строки повторителя: непереводимые значения лежат в settings,
 * переводимые — в block_texts по ключу `<поле>.<индекс>.<подполе>`.
 */
function resolveRepeater (field, rawRows, blockTexts, locale, defaultLocale) {
  const rows = Array.isArray(rawRows) ? rawRows : []
  return rows.map((row, index) => {
    const resolved = { ...row }
    for (const sub of field.fields) {
      if (!sub.translatable) continue
      resolved[sub.key] = pick(blockTexts, locale, defaultLocale, `${field.key}.${index}.${sub.key}`)
    }
    return resolved
  })
}

/**
 * Собирает дерево страницы за фиксированное число запросов,
 * независимо от количества блоков и фотографий.
 */
async function composePage ({ slug = 'home', locale }) {
  const locales = await listLocales()
  const defaultLocale = await getDefaultLocale()
  const activeLocale = locales.some((row) => row.code === locale) ? locale : defaultLocale

  const page = await getPageBySlug(slug)
  if (!page || !page.is_published) return null

  const [pageTexts, blockRows, settings] = await Promise.all([
    getPageTexts(page.id),
    listBlocks(page.id, { visibleOnly: true }),
    getAllSettings()
  ])

  const blockIds = blockRows.map((block) => block.id)
  const [textsByBlock, mediaByBlock] = await Promise.all([
    textsForBlocks(blockIds),
    mediaForBlocks(blockIds)
  ])

  // Альбомы, на которые ссылаются блоки-галереи.
  const galleryIds = [...new Set(
    blockRows
      .map((block) => Number(block.settings?.gallery_id))
      .filter((id) => Number.isInteger(id) && id > 0)
  )]
  const [itemsByGallery, fieldsByGallery, textsByGallery] = await Promise.all([
    itemsForGalleries(galleryIds),
    itemFieldsForGalleries(galleryIds),
    textsForGalleries(galleryIds)
  ])

  // Логотип сайта — обычная запись медиатеки, забираем тем же запросом.
  const siteLogoId = Number(settings.logo_id)
  const mediaIds = [...new Set([
    ...[...mediaByBlock.values()].flatMap((byField) => Object.values(byField).flat()),
    ...[...itemsByGallery.values()].flat(),
    ...(Number.isInteger(siteLogoId) && siteLogoId > 0 ? [siteLogoId] : [])
  ])]
  const [mediaById, textsByMedia] = await Promise.all([
    getMediaByIds(mediaIds),
    textsForMedia(mediaIds)
  ])

  const toView = (mediaId) => viewMedia(
    mediaById.get(mediaId), textsByMedia.get(mediaId), activeLocale, defaultLocale
  )

  const blocks = sortBlocks(blockRows).map((block) => {
    const descriptor = getBlockType(block.type)
    const blockTexts = textsByBlock.get(block.id)
    const text = resolveTexts(blockTexts, activeLocale, defaultLocale)

    const settingsResolved = { ...block.settings }
    for (const field of descriptor?.settings ?? []) {
      if (field.input !== 'repeater') continue
      settingsResolved[field.key] = resolveRepeater(
        field, block.settings?.[field.key], blockTexts, activeLocale, defaultLocale
      )
    }

    const media = {}
    for (const [field, ids] of Object.entries(mediaByBlock.get(block.id) ?? {})) {
      media[field] = ids.map(toView).filter(Boolean)
    }

    let gallery = null
    const galleryId = Number(block.settings?.gallery_id)
    if (Number.isInteger(galleryId) && itemsByGallery.has(galleryId)) {
      const limit = Number(block.settings?.limit) || 0
      const fields = fieldsByGallery.get(galleryId) ?? new Map()
      const items = itemsByGallery.get(galleryId)
        .map((mediaId) => {
          const view = toView(mediaId)
          if (!view) return null
          // Название и цену видит только блок мерча, остальным
          // они не мешают.
          const own = fields.get(mediaId)
          return { ...view, title: own?.title ?? '', price: own?.price ?? '' }
        })
        .filter(Boolean)
      const galleryTexts = textsByGallery.get(galleryId)
      gallery = {
        id: galleryId,
        title: pick(galleryTexts, activeLocale, defaultLocale, 'title'),
        description: pick(galleryTexts, activeLocale, defaultLocale, 'description'),
        items: limit > 0 ? items.slice(0, limit) : items,
        totalCount: items.length
      }
    }

    return {
      id: block.id,
      type: block.type,
      anchor: block.anchor,
      navLabel: text.nav_label ?? '',
      descriptor,
      settings: settingsResolved,
      text,
      media,
      gallery,
      // Первая картинка поля — то, что нужно почти всем шаблонам.
      first: (field) => media[field]?.[0] ?? null
    }
  })

  const quicknav = blocks
    .filter((block) => block.anchor && block.navLabel)
    .map((block) => ({ anchor: block.anchor, label: block.navLabel }))

  const pageTextsResolved = resolveTexts(pageTexts, activeLocale, defaultLocale)

  return {
    page,
    locale: activeLocale,
    defaultLocale,
    locales,
    settings,
    /** Логотип из настроек; шапка и подвал берут его, когда своего нет. */
    siteLogo: toView(siteLogoId),
    meta: {
      title: pageTextsResolved.title || 'PADALI',
      description: pageTextsResolved.description || ''
    },
    blocks,
    quicknav,
    // Пока подвала-блока нет, показывается прежний статический.
    hasFooterBlock: blocks.some((block) => block.type === 'footer')
  }
}

export { composePage, pick, resolveTexts }
