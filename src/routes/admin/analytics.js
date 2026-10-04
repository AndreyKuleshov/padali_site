import {
  DEVICE_BANDS, viewTotals, viewsByDay, viewsByHour, topPaths, topReferrers,
  clickPoints, topTargets, trackedPaths
} from '../../repositories/analytics.js'
import { renderAdmin } from './helpers.js'

const PERIODS = [7, 30, 90]

/**
 * Драйвер отдаёт колонку date объектом Date. Форматируем по местному
 * времени: toISOString() сдвинул бы день назад в отрицательных поясах.
 */
function isoDay (value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function parsePeriod (value) {
  const days = Number.parseInt(value, 10)
  return PERIODS.includes(days) ? days : 30
}

/**
 * Пять ступеней одного цвета: насыщенность растёт вместе с числом
 * визитов. Радуга здесь читалась бы хуже — глаз не знает её порядка.
 */
function intensityStep (value, max) {
  if (value === 0 || max === 0) return 0
  return Math.min(4, Math.ceil((value / max) * 4))
}

/*
 * Точка карты едет в разметку тройкой, а не объектом: их бывает
 * пять тысяч, и имена полей весили бы больше самих чисел.
 *
 * Порядок читает place() в public/js/admin.js — менять можно
 * только вместе с ней. Третий элемент — якорь: id блока строкой
 * или служебное имя вроде header; клик отмеряется от этого блока,
 * а не от начала страницы.
 */
const POINT = ['x_offset', 'y_offset', 'anchor']

function toPoint (row) {
  return POINT.map((field) => row[field])
}

async function analyticsRoutes (app) {
  app.get('/analytics', async (request, reply) => {
    const days = parsePeriod(request.query?.days)

    const [totals, byDay, byHour, paths, referrers, pathsWithClicks] = await Promise.all([
      viewTotals(days), viewsByDay(days), viewsByHour(days),
      topPaths(days), topReferrers(days), trackedPaths(days)
    ])

    const path = pathsWithClicks.some((row) => row.path === request.query?.path)
      ? request.query.path
      : (pathsWithClicks[0]?.path ?? '/')
    const band = Object.hasOwn(DEVICE_BANDS, request.query?.band ?? '')
      ? request.query.band
      : 'desktop'

    const [points, targets] = await Promise.all([
      clickPoints({ path, band, days }),
      topTargets({ path, band, days })
    ])

    // Сетка «день недели × час» — 7 строк по 24 часа, с нулями.
    const hourMax = byHour.reduce((max, row) => Math.max(max, row.views), 0)
    const hourIndex = new Map(byHour.map((row) => [`${row.weekday}:${row.hour}`, row.views]))
    const hourGrid = Array.from({ length: 7 }, (_unused, day) => ({
      weekday: day + 1,
      hours: Array.from({ length: 24 }, (_empty, hour) => {
        const views = hourIndex.get(`${day + 1}:${hour}`) ?? 0
        return { hour, views, step: intensityStep(views, hourMax) }
      })
    }))

    const dayMax = byDay.reduce((max, row) => Math.max(max, row.views), 0)

    return renderAdmin(request, reply, 'admin/analytics', {
      days,
      periods: PERIODS,
      totals,
      byDay: byDay.map((row) => ({
        day: isoDay(row.day),
        views: row.views,
        visitors: row.visitors,
        // Нулевой день — тонкая засечка, иначе провал читается как пропуск данных.
        height: dayMax === 0 ? 0 : Math.max(2, Math.round((row.views / dayMax) * 100))
      })),
      dayMax,
      hourGrid,
      hourMax,
      paths,
      referrers,
      pathsWithClicks,
      heatmap: {
        path,
        band,
        bands: Object.entries(DEVICE_BANDS).map(([key, value]) => ({ key, label: value.label })),
        ...DEVICE_BANDS[band].preview,
        points: points.map(toPoint),
        targets
      }
    })
  })
}

export default analyticsRoutes
export { intensityStep, parsePeriod, isoDay }
