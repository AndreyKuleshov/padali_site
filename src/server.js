import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import qs from 'qs'

import config from './config.js'
import { migrate, waitForDatabase } from './db/migrate.js'
import { closePool } from './db/pool.js'
import { bootstrapAdminUser } from './services/auth.js'
import { ensureSeeded, ensureFooterBlock } from './services/seed.js'
import { syncManagedAssets } from './services/managed-assets.js'
import { purgeOlderThan } from './repositories/analytics.js'
import { repairMedia } from './services/media-repair.js'
import publicRoutes from './routes/public.js'
import adminRoutes from './routes/admin/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function buildServer ({ logger = true } = {}) {
  const app = Fastify({
    logger,
    trustProxy: true,
    bodyLimit: 1024 * 1024
  })

  await app.register(cookie, { secret: config.sessionSecret })

  // Формы админки используют вложенные имена вида settings[items][0][url].
  await app.register(formbody, {
    parser: (body) => qs.parse(body, { depth: 8, arrayLimit: 500, allowPrototypes: false })
  })

  await app.register(multipart, {
    limits: { fileSize: config.uploadMaxBytes, files: 20, fields: 20 }
  })

  await app.register(rateLimit, { global: false, max: 300, timeWindow: '1 minute' })

  // Статика проекта: css, js, брендовые ассеты.
  await app.register(fastifyStatic, {
    root: join(ROOT, 'public'),
    prefix: '/',
    index: false,
    maxAge: config.isProduction ? '7d' : 0
  })

  // Загруженные картинки: имя содержит хеш, поэтому кэш вечный.
  await app.register(fastifyStatic, {
    root: config.uploadDir,
    prefix: '/uploads/',
    index: false,
    decorateReply: false,
    immutable: true,
    maxAge: '365d'
  })

  await app.register(adminRoutes, { prefix: '/admin' })
  await app.register(publicRoutes)

  return app
}

async function start () {
  await mkdir(config.uploadDir, { recursive: true })

  const app = await buildServer()

  try {
    await waitForDatabase({ logger: app.log })
    await migrate({ logger: app.log })
    await ensureSeeded({ logger: app.log })
    // Файлы репозитория доезжают до сайта так же, как код: заменили
    // картинку в seed-assets, выкатили — медиатека обновилась.
    await ensureFooterBlock({ logger: app.log })
    await syncManagedAssets({ logger: app.log })
    // Снимки, загруженные по старым правилам, приводим к текущим.
    await repairMedia({ logger: app.log })
    await bootstrapAdminUser(app.log)

    // Статистика — не архив: сырые события чистим на старте и раз в сутки.
    const purge = async () => {
      try {
        const removed = await purgeOlderThan(config.analyticsRetentionDays)
        if (removed.views + removed.clicks > 0) {
          app.log.info(`Статистика: удалено старых записей — просмотров ${removed.views}, кликов ${removed.clicks}.`)
        }
      } catch (error) {
        app.log.warn({ err: error }, 'Чистка статистики не удалась')
      }
    }
    await purge()
    const purgeTimer = setInterval(purge, 24 * 60 * 60 * 1000)
    purgeTimer.unref()

    await app.listen({ port: config.port, host: config.host })
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      app.log.info(`${signal}: останавливаюсь`)
      await app.close()
      await closePool()
      process.exit(0)
    })
  }

  return app
}

export { buildServer, start }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start()
}
