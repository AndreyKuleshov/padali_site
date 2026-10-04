import { db, placeholders } from './helpers.js'

/**
 * Ширины экранов, по которым раскладываются клики на карте.
 *
 * `preview` — размер окна, в котором страница показывается под
 * картой. Высота взята настоящая: во фрейме во весь документ
 * единицы svh раздули бы шапку, и страница выглядела бы не так,
 * как у людей.
 *
 * Границы держим здесь одни на всех: доля мобильных считается по
 * той же, и разъехавшись, две цифры показали бы разное про один
 * и тот же экран.
 */
const DEVICE_BANDS = {
  mobile: {
    label: { en: 'Phone', sr: 'Telefon' },
    min: 0, max: 640, preview: { width: 390, height: 844 }
  },
  tablet: {
    label: { en: 'Tablet', sr: 'Tablet' },
    min: 641, max: 1024, preview: { width: 834, height: 1112 }
  },
  desktop: {
    label: { en: 'Desktop', sr: 'Računar' },
    min: 1025, max: 100000, preview: { width: 1440, height: 900 }
  }
}

/** Телефон ли это — по той же границе, что у карты кликов. */
function isMobileWidth (width) {
  return Number(width) <= DEVICE_BANDS.mobile.max
}

async function recordView (view, conn) {
  await db(conn).run(
    'INSERT INTO analytics_views (path, locale, visitor_hash, referrer_host, viewport, is_mobile) ' +
    'VALUES (?, ?, ?, ?, ?, ?)',
    [view.path, view.locale, view.visitorHash, view.referrerHost, view.viewport, view.isMobile]
  )
}

/**
 * Клики приходят пачкой в конце визита — пишем одним запросом.
 *
 * Ссылки на несуществующие блоки отсеиваем заранее: внешний ключ
 * иначе отклонил бы всю пачку из-за одной устаревшей записи, а
 * посетитель мог кликнуть по блоку, который редактор удалил,
 * пока страница была открыта.
 */
async function recordClicks (clicks, conn) {
  if (clicks.length === 0) return 0
  const runner = db(conn)

  const referenced = [...new Set(clicks.map((click) => click.blockId).filter(Number.isInteger))]
  const known = new Set()
  if (referenced.length > 0) {
    const rows = await runner.all(
      `SELECT id FROM blocks WHERE id IN (${placeholders(referenced.length)})`,
      referenced
    )
    for (const row of rows) known.add(row.id)
  }

  const writable = clicks.filter((click) => click.blockId == null || known.has(click.blockId))
  if (writable.length === 0) return 0

  const values = writable.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')
  const params = writable.flatMap((click) => [
    click.path, click.xOffset, click.yOffset, click.viewport,
    click.target, click.blockId ?? null, click.anchor ?? null
  ])
  const result = await runner.run(
    'INSERT INTO analytics_clicks ' +
    `(path, x_offset, y_offset, viewport, target, block_id, anchor) VALUES ${values}`,
    params
  )
  return result.rowCount
}

function sinceClause (days) {
  return `now() - make_interval(days => ${Number.parseInt(days, 10) || 30})`
}

async function viewTotals (days, conn) {
  return db(conn).one(
    'SELECT COUNT(*)::int AS views, ' +
    'COUNT(DISTINCT visitor_hash)::int AS visitors, ' +
    'COUNT(*) FILTER (WHERE is_mobile)::int AS mobile ' +
    `FROM analytics_views WHERE viewed_at > ${sinceClause(days)}`
  )
}

/** Посещения по дням — с нулями за дни без визитов, иначе график врёт. */
async function viewsByDay (days, conn) {
  return db(conn).all(
    'SELECT d::date AS day, ' +
    '  COALESCE(v.views, 0)::int AS views, ' +
    '  COALESCE(v.visitors, 0)::int AS visitors ' +
    `FROM generate_series(date_trunc('day', ${sinceClause(days)}), date_trunc('day', now()), '1 day') AS d ` +
    'LEFT JOIN ( ' +
    "  SELECT date_trunc('day', viewed_at) AS day, COUNT(*) AS views, " +
    '         COUNT(DISTINCT visitor_hash) AS visitors ' +
    `  FROM analytics_views WHERE viewed_at > ${sinceClause(days)} ` +
    '  GROUP BY 1 ' +
    ') AS v ON v.day = d ' +
    'ORDER BY d'
  )
}

/** Сетка «день недели × час» — видно, когда на сайт заходят. */
async function viewsByHour (days, conn) {
  return db(conn).all(
    'SELECT EXTRACT(ISODOW FROM viewed_at)::int AS weekday, ' +
    '       EXTRACT(HOUR FROM viewed_at)::int AS hour, ' +
    '       COUNT(*)::int AS views ' +
    `FROM analytics_views WHERE viewed_at > ${sinceClause(days)} ` +
    'GROUP BY 1, 2'
  )
}

async function topPaths (days, conn) {
  return db(conn).all(
    'SELECT path, COUNT(*)::int AS views, COUNT(DISTINCT visitor_hash)::int AS visitors ' +
    `FROM analytics_views WHERE viewed_at > ${sinceClause(days)} ` +
    'GROUP BY path ORDER BY views DESC LIMIT 20'
  )
}

async function topReferrers (days, conn) {
  return db(conn).all(
    'SELECT referrer_host, COUNT(*)::int AS views ' +
    `FROM analytics_views WHERE viewed_at > ${sinceClause(days)} AND referrer_host IS NOT NULL ` +
    'GROUP BY referrer_host ORDER BY views DESC LIMIT 10'
  )
}

async function clickPoints ({ path, band = 'desktop', days = 30 }, conn) {
  const range = DEVICE_BANDS[band] ?? DEVICE_BANDS.desktop
  return db(conn).all(
    'SELECT x_offset, y_offset, target, COALESCE(block_id::text, anchor) AS anchor ' +
    'FROM analytics_clicks ' +
    `WHERE path = ? AND viewport BETWEEN ? AND ? AND clicked_at > ${sinceClause(days)} ` +
    'ORDER BY clicked_at DESC LIMIT 5000',
    [path, range.min, range.max]
  )
}

/**
 * Куда чаще всего жмут — читается быстрее карты.
 * Фильтр по ширине экрана тот же, что у карты: иначе счётчик
 * «clicks: 0» и непустой список рядом противоречили бы друг другу.
 */
async function topTargets ({ path, band = 'desktop', days = 30 }, conn) {
  const range = DEVICE_BANDS[band] ?? DEVICE_BANDS.desktop
  return db(conn).all(
    'SELECT target, COUNT(*)::int AS clicks FROM analytics_clicks ' +
    'WHERE path = ? AND target IS NOT NULL AND viewport BETWEEN ? AND ? ' +
    `AND clicked_at > ${sinceClause(days)} ` +
    'GROUP BY target ORDER BY clicks DESC LIMIT 12',
    [path, range.min, range.max]
  )
}

async function trackedPaths (days, conn) {
  return db(conn).all(
    'SELECT path, COUNT(*)::int AS clicks FROM analytics_clicks ' +
    `WHERE clicked_at > ${sinceClause(days)} ` +
    'GROUP BY path ORDER BY clicks DESC'
  )
}

/** Сырые события живут ограниченное время: статистика — не архив. */
async function purgeOlderThan (days, conn) {
  const runner = db(conn)
  const views = await runner.run(`DELETE FROM analytics_views WHERE viewed_at < ${sinceClause(days)}`)
  const clicks = await runner.run(`DELETE FROM analytics_clicks WHERE clicked_at < ${sinceClause(days)}`)
  return { views: views.rowCount, clicks: clicks.rowCount }
}

export {
  DEVICE_BANDS, isMobileWidth, recordView, recordClicks,
  viewTotals, viewsByDay, viewsByHour, topPaths, topReferrers,
  clickPoints, topTargets, trackedPaths, purgeOlderThan
}
