import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Eta } from 'eta'
import sanitizeHtml from 'sanitize-html'
import config from '../config.js'
import { icon, ICON_NAMES } from './icons.js'
import { assetUrl } from './assets.js'
import { parseVideoId, thumbnailFor, embedUrl, watchUrl } from './youtube.js'

const VIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'views')

const eta = new Eta({
  views: VIEWS_DIR,
  cache: config.isProduction,
  autoEscape: true,
  rmWhitespace: false
})

/** Белый список для richtext: редактор свой, но дыру делать всё равно незачем. */
const SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'a',
    'ul', 'ol', 'li', 'blockquote', 'h3', 'h4', 'hr', 'code'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener', target: '_blank' })
  }
}

function sanitize (html) {
  return sanitizeHtml(html ?? '', SANITIZE_OPTIONS)
}

/** Дата хранится как YYYY-MM-DD, показывается как ДД.ММ.ГГГГ. */
function formatDate (value) {
  if (!value) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value)
}

/** Язык по умолчанию живёт в корне, остальные — в своём префиксе. */
function localeUrl (code, defaultLocale, path = '') {
  const prefix = code === defaultLocale ? '' : `/${code}`
  return `${prefix}/${path}`.replace(/\/+$/, '') || '/'
}

const helpers = {
  icon,
  asset: assetUrl,
  // Разбор ссылки один на админку и на сайт: иначе шаблон знал бы
  // про форматы адресов YouTube отдельно от того, кто их проверяет.
  youtube: { id: parseVideoId, thumbnail: thumbnailFor, embed: embedUrl, watch: watchUrl },
  iconNames: ICON_NAMES,
  sanitize,
  formatDate,
  localeUrl,
  publicUrl: config.publicUrl,
  /** Безопасный JSON для вставки в <script type="application/json">. */
  jsonScript: (value) => JSON.stringify(value ?? null).replace(/</g, '\\u003c')
}

function render (template, data = {}) {
  const html = eta.render(template, { ...data, h: helpers })
  if (html === undefined) throw new Error(`Шаблон «${template}» не найден.`)
  return html
}

export { render, helpers, sanitize, formatDate, localeUrl, eta, VIEWS_DIR }
