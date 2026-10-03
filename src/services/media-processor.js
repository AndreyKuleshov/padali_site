import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import sharp from 'sharp'
import config from '../config.js'
import { findMediaByHash, insertMedia } from '../repositories/media.js'

const EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif'
}

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif'
}

class UploadError extends Error {
  constructor (message) {
    super(message)
    this.name = 'UploadError'
    this.statusCode = 400
  }
}

function hashOf (buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Ширины, которые должны существовать для оригинала такой ширины.
 * Апскейла нет, но полная ширина входит всегда: без неё srcset
 * обрывался бы на предыдущей ступени и браузер растягивал бы кадр,
 * хотя на диске есть версия крупнее.
 */
function expectedWidths (width) {
  return [...new Set([
    ...config.derivativeWidths.filter((candidate) => candidate < width),
    width
  ])].sort((a, b) => a - b)
}

/** Папка по году и месяцу: каталог загрузок не превращается в свалку. */
function datedFolder (date = new Date()) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}/${month}`
}

function absolutePath (relativePath) {
  return join(config.uploadDir, relativePath)
}

/** URL для отдачи файла: статика смонтирована на /uploads. */
function mediaUrl (relativePath) {
  return `/uploads/${relativePath}`
}

function derivativeRelPath (relativeOriginal, width) {
  const dir = dirname(relativeOriginal)
  const base = relativeOriginal.slice(dir.length + 1, -extname(relativeOriginal).length)
  return `${dir}/${base}-${width}.webp`
}

/**
 * Кладёт оригинал на диск и генерирует webp-версии.
 * Общая часть загрузки через админку и обновления файлов репозитория.
 *
 * @returns {{path: string, width: number, height: number, derivatives: number[]}}
 */
async function writeDerivatives ({ buffer, mime, hash }) {
  let image = sharp(buffer, { failOn: 'error' })
  let metadata
  try {
    metadata = await image.metadata()
  } catch {
    throw new UploadError('Файл не является изображением или повреждён.')
  }
  if (!metadata.width || !metadata.height) {
    throw new UploadError('Не удалось определить размеры изображения.')
  }

  // EXIF-поворот применяем один раз, дальше работаем с нормализованным кадром.
  image = image.rotate()
  const normalized = await image.toBuffer({ resolveWithObject: true })
  const width = normalized.info.width
  const height = normalized.info.height

  const folder = datedFolder()
  const relativeOriginal = `${folder}/${hash}${EXTENSION_BY_MIME[mime] ?? '.bin'}`

  await mkdir(absolutePath(folder), { recursive: true })
  await writeFile(absolutePath(relativeOriginal), buffer)

  const widths = expectedWidths(width)

  for (const targetWidth of widths) {
    await sharp(normalized.data)
      .resize({ width: targetWidth, withoutEnlargement: true })
      // Мелкие кадры сжимаем сильнее: на превью разницы не видно,
      // а крупные идут в шапку и на весь экран.
      .webp({ quality: targetWidth <= 640 ? 82 : 88 })
      .toFile(absolutePath(derivativeRelPath(relativeOriginal, targetWidth)))
  }

  return { path: relativeOriginal, width, height, derivatives: widths }
}

/**
 * Сохраняет загруженный файл и его webp-деривативы.
 * Повторная загрузка того же содержимого возвращает существующую запись:
 * hash уникален, файлы не дублируются.
 */
async function processUpload ({ buffer, originalName, mime, managedKey = null }) {
  if (!config.allowedImageMimes.includes(mime)) {
    throw new UploadError(`Тип файла «${mime}» не поддерживается. Разрешены: JPEG, PNG, WebP, AVIF.`)
  }
  if (buffer.length > config.uploadMaxBytes) {
    throw new UploadError(`Файл больше ${Math.round(config.uploadMaxBytes / 1024 / 1024)} МБ.`)
  }

  const hash = hashOf(buffer)
  const existing = await findMediaByHash(hash)
  if (existing) return { media: existing, deduplicated: true }

  const written = await writeDerivatives({ buffer, mime, hash })

  const record = {
    ...written,
    mime,
    bytes: buffer.length,
    hash,
    originalName: originalName.slice(0, 255),
    managedKey
  }
  record.id = await insertMedia(record)

  return { media: record, deduplicated: false }
}

/** Удаляет оригинал и все деривативы с диска. Запись в БД удаляется отдельно. */
async function deleteFiles (media) {
  await rm(absolutePath(media.path), { force: true })
  for (const width of media.derivatives ?? []) {
    await rm(absolutePath(derivativeRelPath(media.path, width)), { force: true })
  }
}

/**
 * Данные для <picture>: srcset по деривативам и src для браузеров без webp.
 */
function pictureSources (media) {
  const widths = (media.derivatives ?? []).slice().sort((a, b) => a - b)
  const srcset = widths
    .map((width) => `${mediaUrl(derivativeRelPath(media.path, width))} ${width}w`)
    .join(', ')
  const fallbackWidth = widths.at(-1) ?? media.width
  return {
    srcset,
    src: widths.length > 0 ? mediaUrl(derivativeRelPath(media.path, fallbackWidth)) : mediaUrl(media.path),
    original: mediaUrl(media.path),
    width: media.width,
    height: media.height
  }
}

/** Самый маленький дериватив — для превью в админке. */
function thumbnailUrl (media) {
  const widths = (media.derivatives ?? []).slice().sort((a, b) => a - b)
  return widths.length > 0
    ? mediaUrl(derivativeRelPath(media.path, widths[0]))
    : mediaUrl(media.path)
}

export {
  processUpload, writeDerivatives, deleteFiles, pictureSources, thumbnailUrl,
  mediaUrl, derivativeRelPath, absolutePath, hashOf,
  MIME_BY_EXTENSION, EXTENSION_BY_MIME, expectedWidths, UploadError
}
