/**
 * Кэш отрендеренных страниц в памяти процесса.
 *
 * Сбрасывается целиком при любой записи из админки: контента мало,
 * точечная инвалидация тут не окупается, а ошибиться в ней легко.
 */
const store = new Map()

function cacheKey (parts) {
  return parts.join('|')
}

function getCached (key) {
  return store.get(key) ?? null
}

function setCached (key, value) {
  store.set(key, value)
  return value
}

function invalidateCache () {
  store.clear()
}

function cacheSize () {
  return store.size
}

export { cacheKey, getCached, setCached, invalidateCache, cacheSize }
