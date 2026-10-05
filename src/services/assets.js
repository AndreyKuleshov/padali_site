import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../config.js'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public')

/** Отпечаток на файл: { hash, mtime }. В проде считается один раз. */
const fingerprints = new Map()

function absolutePathFor (publicPath) {
  const relative = normalize(publicPath.replace(/^\/+/, ''))
  if (relative.startsWith('..')) throw new Error(`Путь вне public: ${publicPath}`)
  return join(PUBLIC_DIR, relative)
}

function fingerprint (publicPath) {
  const absolute = absolutePathFor(publicPath)
  // В разработке файл правится на лету, поэтому сверяемся со временем
  // изменения. В проде содержимое запечено в образ и не меняется.
  const mtime = config.isProduction ? null : statSync(absolute).mtimeMs

  const cached = fingerprints.get(publicPath)
  if (cached && cached.mtime === mtime) return cached.hash

  const hash = createHash('sha1').update(readFileSync(absolute)).digest('hex').slice(0, 10)
  fingerprints.set(publicPath, { hash, mtime })
  return hash
}

/**
 * Адрес статики с отпечатком содержимого: `/css/site.css?v=1a2b3c4d5e`.
 *
 * Без него браузер держит старые стили и скрипты до истечения
 * max-age и после выкатки показывает прежнюю версию сайта.
 * Отсутствующий файл не должен ронять страницу — возвращаем путь как есть.
 */
function assetUrl (publicPath) {
  try {
    return `${publicPath}?v=${fingerprint(publicPath)}`
  } catch {
    return publicPath
  }
}

export { assetUrl, PUBLIC_DIR }

/**
 * Логотип, вшитый в репозиторий: шапка, hero и подвал откатываются
 * на него, когда своего файла нет ни у блока, ни в настройках.
 */
export const BUILT_IN_LOGO = '/brand/padali-wordmark.webp'
