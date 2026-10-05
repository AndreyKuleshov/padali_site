import { getBlockType, sortBlocks } from '../blocks/index.js'
import { getPageBySlug, getPageTexts, HOME_SLUG } from '../repositories/pages.js'
import { listBlocks, textsForBlocks, mediaForBlocks } from '../repositories/blocks.js'
import {
  itemsForGalleries, itemFieldsForGalleries, textsForGalleries
} from '../repositories/galleries.js'
import { getMediaByIds, textsForMedia } from '../repositories/media.js'
import { listLocales, getDefaultLocale } from '../repositories/locales.js'
import { getAllSettings } from '../repositories/settings.js'
import { pictureSources } from './media-processor.js'
import { siteTranslator } from '../i18n/site.js'

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
 * переводимые — в block_texts по ключу `<поле>.<индекс>.<подполе>`,
 * картинки — в block_media под тем же составным именем.
 */
/**
 * Строки повторителя с подставленными текстами и картинками.
 *
 * Повторитель может объявить `upcoming: '<подполе с датой>'` — тогда
 * строки с прошедшей датой на страницу не попадают, а оставшиеся
 * идут по возрастанию. Без этого вчерашний концерт продолжал бы
 * висеть под заголовком «Ближайший концерт», пока редактор не
 * вспомнит; а править такое вручную раз в месяц никто не станет.
 *
 * Номер строки для текстов и картинок берётся ДО отсева: ключи
 * `events.<номер>.<поле>` записаны по исходному порядку, и сдвиг
 * отдал бы оставшемуся концерту чужую афишу.
 */
/** Подпись из дескриптора: она объявлена сразу на всех языках. */
function pickLabel (value, locale, defaultLocale) {
  if (typeof value === 'string') return value
  return value?.[locale] ?? value?.[defaultLocale] ?? ''
}

/** «ГГГГ-ММ-ДД» по часам сервера: даты блоков хранятся так же. */
function isoDate (date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function resolveRepeater (field, rawRows, blockTexts, media, locale, defaultLocale, today) {
  const rows = Array.isArray(rawRows) ? rawRows : []
  const resolvedRows = rows.map((row, index) => {
    const resolved = { ...row }
    for (const sub of field.fields) {
      const key = `${field.key}.${index}.${sub.key}`
      if (sub.translatable) {
        resolved[sub.key] = pick(blockTexts, locale, defaultLocale, key)
      } else if (sub.input === 'media') {
        const views = media[key] ?? []
        resolved[sub.key] = sub.multiple ? views : (views[0] ?? null)
      }
    }
    return resolved
  })

  if (!field.upcoming) return resolvedRows

  return resolvedRows
    .filter((row) => {
      const date = row[field.upcoming]
      return typeof date === 'string' && date !== '' && date >= today
    })
    .sort((a, b) => a[field.upcoming].localeCompare(b[field.upcoming]))
}

/**
 * Собирает дерево страницы за фиксированное число запросов,
 * независимо от количества блоков и фотографий.
 */
/* Сегодня приходит параметром, а не берётся внутри: тест должен
   уметь показать и вчера, и завтра, не трогая часы машины. */
async function composePage ({ slug = HOME_SLUG, locale, today = isoDate(new Date()) }) {
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

    const media = {}
    for (const [field, ids] of Object.entries(mediaByBlock.get(block.id) ?? {})) {
      media[field] = ids.map(toView).filter(Boolean)
    }

    // Строки разбираем после картинок: у строки бывает своя.
    const settingsResolved = { ...block.settings }
    for (const field of descriptor?.settings ?? []) {
      if (field.input !== 'repeater') continue
      settingsResolved[field.key] = resolveRepeater(
        field, block.settings?.[field.key], blockTexts, media, activeLocale, defaultLocale, today
      )
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
          return {
            ...view,
            // Название товара переводится, поэтому выбирается так
            // же, как остальные тексты: язык страницы, затем язык
            // по умолчанию.
            title: own?.title?.[activeLocale] ?? own?.title?.[defaultLocale] ?? '',
            price: own?.price ?? ''
          }
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
      /* Запасная подпись объявлена в дескрипторе у каждого блока, но
         попадала в тексты только при создании: у блоков, заведённых
         раньше, поле осталось пустым, и раздел молча выпадал из
         меню, оставаясь на странице. Держим её отдельно от своей:
         своя годится всегда, запасная — только пока не повторяет
         уже занятую. */
      navFallback: pickLabel(descriptor?.defaults?.navLabel, activeLocale, defaultLocale),
      descriptor,
      settings: settingsResolved,
      text,
      media,
      gallery,
      // Первая картинка поля — то, что нужно почти всем шаблонам.
      first: (field) => media[field]?.[0] ?? null
    }
  })

  /* Блок, которому нечего показать, не рисуется — значит, и якоря
     для него нет. Пункт меню, ведущий в никуда, прокручивает
     страницу в случайное место. О пустоте знает дескриптор: только
     он знает, что у концертов содержимое — это события.

     Запасной подписью пользуемся, пока она никого не повторяет: два
     альбома подряд получили бы в меню два одинаковых «Фото», и это
     хуже, чем один ненайденный раздел. Повторилась — значит, имя
     разделу должен дать редактор. */
  const taken = new Set()
  const quicknav = []
  for (const block of blocks) {
    if (!block.anchor) continue
    if (block.descriptor?.isEmpty?.(block.settings)) continue

    const label = block.navLabel || (taken.has(block.navFallback) ? '' : block.navFallback)
    if (!label) continue

    taken.add(label)
    quicknav.push({ anchor: block.anchor, label })
  }

  const pageTextsResolved = resolveTexts(pageTexts, activeLocale, defaultLocale)

  return {
    page,
    locale: activeLocale,
    /** Обвязка сайта: подписи стрелок, кнопок и ответов форм. */
    s: siteTranslator(activeLocale),
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

export { composePage, pick }
