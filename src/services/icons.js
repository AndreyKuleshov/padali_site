/**
 * Набор SVG-иконок. В исходном лендинге они были скопированы в разметку
 * по два-три раза; здесь каждая описана один раз и вставляется по имени.
 * Все иконки наследуют currentColor и viewBox 0 0 24 24.
 */
const ICONS = {
  instagram:
    '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<circle cx="17.2" cy="6.8" r="1" fill="none" stroke="currentColor" stroke-width="1.6"/>',

  tiktok:
    '<path fill="currentColor" d="M14.5 3c.3 2 1.7 3.6 3.6 3.9v2.6c-1.3-.1-2.5-.5-3.6-1.3v6.2c0 3-2.4 5.4-5.4 5.4S3.7 17.4 3.7 14.4c0-2.9 2.3-5.3 5.2-5.4v2.7c-1.4.1-2.5 1.3-2.5 2.7 0 1.5 1.2 2.7 2.7 2.7s2.7-1.2 2.7-2.7V3h2.7z"/>',

  youtube:
    '<rect x="2.5" y="5.5" width="19" height="13" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path fill="currentColor" d="M10.5 9.5l5 2.5-5 2.5z"/>',

  spotify:
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M7 10c3.3-.9 7-.4 9.4 1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M7.4 13.2c2.8-.7 5.9-.3 8 1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M7.8 16.2c2.2-.5 4.6-.2 6.3.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',

  'apple-music':
    '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M9.2 15.6V9.1l5.6-1.2v6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="8.1" cy="15.8" r="1.7" fill="currentColor"/>' +
    '<circle cx="13.7" cy="14.1" r="1.7" fill="currentColor"/>',

  'youtube-music':
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path fill="currentColor" d="M10 8.7l6 3.3-6 3.3z"/>',

  deezer:
    '<path fill="currentColor" d="M1.5 14h3v4.5h-3zM6 10.5h3v8H6zM10.5 7h3v11.5h-3zM15 10.5h3v8h-3zM19.5 14h3v4.5h-3z"/>',

  bandcamp:
    '<path fill="currentColor" d="M3 17.5L8.4 6.5H21l-5.4 11z"/>',

  soundcloud:
    '<path d="M3 16v-4M6 17V11M9 17V8.5M12 17V8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M15 17V9.2a4.2 4.2 0 016.3 3.6A4.2 4.2 0 0118 17z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',

  vk:
    '<path d="M3.5 7.5h3c.4 3 1.8 5.1 3 5.6V7.5h2.8v4.3c1.2-.2 2.4-1.8 2.8-4.3h2.8c-.3 2.5-1.5 4.3-2.5 5 .9.6 2.4 2.2 3 4h-3c-.5-1.4-1.6-2.6-3.1-2.8v2.8h-.4c-3.4 0-6.4-2.9-8.4-9z" fill="currentColor"/>',

  telegram:
    '<path d="M21 4.5L2.8 11.3c-.6.2-.6 1 .1 1.2l4.6 1.4 1.7 5.1c.2.5.8.6 1.1.2l2.5-2.6 4.6 3.4c.5.4 1.2.1 1.3-.5L21.9 5.3c.1-.6-.4-1-.9-.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M7.5 13.9L17 7.6l-7 7.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',

  // Конверт для выбора вида связи в форме заказа.
  email:
    '<path d="M3 6.5h18v11H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M3.5 7l8.5 6 8.5-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',

  ticket:
    '<path d="M3 8.5a2 2 0 012-2h14a2 2 0 012 2v1.2a2.3 2.3 0 000 4.6v1.2a2 2 0 01-2 2H5a2 2 0 01-2-2v-1.2a2.3 2.3 0 000-4.6z" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M14 7v10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 2.5"/>'
}

const ICON_NAMES = Object.keys(ICONS)

/**
 * SVG по имени. Неизвестное имя даёт пустую строку, а не падение рендера:
 * иконка в контенте — не повод отдать пятисотку.
 */
function icon (name, { className = '', title = '' } = {}) {
  const body = ICONS[name]
  if (!body) return ''
  const classAttr = className ? ` class="${className}"` : ''
  const label = title
    ? ` role="img" aria-label="${title.replace(/"/g, '&quot;')}"`
    : ' aria-hidden="true"'
  return `<svg${classAttr} viewBox="0 0 24 24"${label}>${body}</svg>`
}

function hasIcon (name) {
  return Object.hasOwn(ICONS, name)
}

export { icon, hasIcon, ICON_NAMES }
