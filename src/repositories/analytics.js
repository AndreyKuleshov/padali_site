import { db } from './helpers.js'

/** Ширины экранов, по которым раскладываются клики на карте. */
const DEVICE_BANDS = {
  mobile: { label: { en: 'Phone', sr: 'Telefon' }, min: 0, max: 640 },
  tablet: { label: { en: 'Tablet', sr: 'Tablet' }, min: 641, max: 1024 },
  desktop: { label: { en: 'Desktop', sr: 'Računar' }, min: 1025, max: 100000 }
}

async function recordView (view, conn) {
  await db(conn).run(
    'INSERT INTO analytics_views (path, locale, visitor_hash, referrer_host, viewport, is_mobile) ' +
    'VALUES (?, ?, ?, ?, ?, ?)',
    [view.path, view.locale, view.visitorHash, view.referrerHost, view.viewport, view.isMobile]
  )
}

/** Клики приходят пачкой в конце визита — пишем одним запросом. */
async function recordClicks (clicks, conn) {
  if (clicks.length === 0) return 0
  const values = clicks.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')
  const params = clicks.flatMap((click) => [
    click.path, click.xOffset, click.yOffset, click.viewport, click.target, click.anchor
  ])
  const result = await db(conn).run(
    `INSERT INTO analytics_clicks (path, x_offset, y_offset, viewport, target, anchor) VALUES ${values}`,
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
    'SELECT x_offset, y_offset, target, anchor FROM analytics_clicks ' +
    `WHERE path = ? AND viewport BETWEEN ? AND ? AND clicked_at > ${sinceClause(days)} ` +
    'ORDER BY clicked_at DESC LIMIT 5000',
    [path, range.min, range.max]
  )
}

/** Куда чаще всего жмут — читается быстрее карты. */
async function topTargets ({ path, days = 30 }, conn) {
  return db(conn).all(
    'SELECT target, COUNT(*)::int AS clicks FROM analytics_clicks ' +
    `WHERE path = ? AND target IS NOT NULL AND clicked_at > ${sinceClause(days)} ` +
    'GROUP BY target ORDER BY clicks DESC LIMIT 12',
    [path]
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
  DEVICE_BANDS, recordView, recordClicks,
  viewTotals, viewsByDay, viewsByHour, topPaths, topReferrers,
  clickPoints, topTargets, trackedPaths, purgeOlderThan
}
