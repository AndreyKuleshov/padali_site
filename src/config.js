import { resolve } from 'node:path'

/** Переменные, без которых приложение не имеет смысла запускать. */
const REQUIRED = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'SESSION_SECRET']

function readEnv (env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(
      `Не заданы обязательные переменные окружения: ${missing.join(', ')}.\n` +
      'Скопируйте .env.example в .env и заполните его.'
    )
  }
  if (env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET должен быть не короче 32 символов (openssl rand -hex 32).')
  }

  const isProduction = env.NODE_ENV === 'production'

  return {
    isProduction,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    publicUrl: (env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),

    db: {
      host: env.DB_HOST,
      port: Number(env.DB_PORT ?? 5432),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      /**
       * Приложение живёт в собственной схеме: база общая с другим
       * проектом, и таблицы не должны пересекаться.
       */
      schema: env.DB_SCHEMA ?? 'padali'
    },

    sessionSecret: env.SESSION_SECRET,
    /** Срок жизни сессии администратора. */
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,

    /**
     * Попыток входа с одного адреса за 15 минут. Вынесено в настройку
     * ради тестов: они логинятся на каждый сценарий и упираются в предел.
     */
    loginRateLimit: {
      max: Number(env.LOGIN_RATE_LIMIT_MAX ?? 10),
      timeWindow: '15 minutes'
    },

    /** Учётка, создаваемая при первом старте, когда admin_users пуста. */
    bootstrapAdmin: env.ADMIN_EMAIL && env.ADMIN_PASSWORD
      ? { email: env.ADMIN_EMAIL.trim().toLowerCase(), password: env.ADMIN_PASSWORD }
      : null,

    /**
     * Дополнительные учётки: `почта:пароль`, через запятую.
     * Создаются, если такой почты ещё нет, и не трогаются дальше —
     * пароль, изменённый в админке, переменная не перезапишет.
     * Нужны, чтобы завести доступ там, где в админку ещё не войти.
     */
    bootstrapUsers: String(env.ADMIN_USERS ?? '')
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const separator = pair.indexOf(':')
        return separator === -1
          ? null
          : {
              email: pair.slice(0, separator).trim().toLowerCase(),
              password: pair.slice(separator + 1).trim()
            }
      })
      .filter((user) => user && user.email && user.password.length >= 10),

    uploadDir: resolve(env.UPLOAD_DIR ?? './data/uploads'),
    /** Предел на один загружаемый файл. */
    uploadMaxBytes: 20 * 1024 * 1024,
    allowedImageMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    /**
     * Ступени ширины для webp-деривативов. Апскейла не делается, но к
     * списку всегда добавляется полная ширина оригинала — иначе всё,
     * что между ступенями, терялось бы: у снимка 1100px лучшим
     * кандидатом оказывался бы 640px.
     */
    derivativeWidths: [320, 640, 1280, 1920, 2560]
  }
}

export { readEnv }
export default readEnv()
