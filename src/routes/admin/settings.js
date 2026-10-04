import { getAllSettings, setSetting } from '../../repositories/settings.js'
import { getPageBySlug, getPageTexts, savePageTexts, HOME_SLUG } from '../../repositories/pages.js'
import { listLocales } from '../../repositories/locales.js'
import { listMediaForPicker } from '../../repositories/media.js'
import { ICON_NAMES } from '../../services/icons.js'
import { thumbnailUrl } from '../../services/media-processor.js'
import { asUrl, asString } from '../../services/block-form.js'
import { setFlash } from '../../services/auth.js'
import { renderAdmin, afterWrite } from './helpers.js'
import { logoFromSettings, builtInLogo } from '../../services/site-logo.js'

async function settingsRoutes (app) {
  app.get('/settings', async (request, reply) => {
    const [settings, locales, page, library] = await Promise.all([
      getAllSettings(), listLocales(), getPageBySlug(HOME_SLUG), listMediaForPicker()
    ])
    const pageTexts = page ? await getPageTexts(page.id) : {}
    // Логотип разрешаем той же цепочкой, что и сайт: свой из
    // медиатеки либо встроенный файл. Иначе поле выглядит пустым,
    // хотя в шапке логотип стоит.
    const logo = await logoFromSettings(settings)

    return renderAdmin(request, reply, 'admin/settings', {
      logo,
      builtInLogo: builtInLogo(),
      settings,
      pageTexts,
      locales,
      iconNames: ICON_NAMES,
      library: library.map((media) => ({
        id: media.id, thumb: thumbnailUrl(media), name: media.originalName
      }))
    })
  })

  app.post('/settings', async (request, reply) => {
    const locales = (await listLocales()).map((row) => row.code)

    // Соцсети в шапке — тот же повторитель, что и в блоках, но глобальный.
    const raw = request.body?.social
    const rows = Array.isArray(raw)
      ? raw
      : Object.values(raw ?? {})
    const social = rows
      .map((row) => ({
        icon: ICON_NAMES.includes(asString(row?.icon)) ? asString(row.icon) : '',
        label: asString(row?.label),
        url: asUrl(row?.url)
      }))
      .filter((row) => row.icon && row.url)

    const ogImageId = Number.parseInt(asString(request.body?.og_image_id), 10)
    const logoId = Number.parseInt(asString(request.body?.logo_id), 10)

    await setSetting('social', social)
    await setSetting('footer_note', asString(request.body?.footer_note))
    await setSetting('og_image_id', Number.isInteger(ogImageId) && ogImageId > 0 ? ogImageId : null)
    await setSetting('logo_id', Number.isInteger(logoId) && logoId > 0 ? logoId : null)

    const page = await getPageBySlug(HOME_SLUG)
    if (page) {
      const textsByLocale = {}
      for (const locale of locales) {
        textsByLocale[locale] = {
          title: asString(request.body?.text?.[locale]?.title),
          description: asString(request.body?.text?.[locale]?.description)
        }
      }
      await savePageTexts(page.id, textsByLocale)
    }

    afterWrite()
    setFlash(reply, 'success', request.t('settings.saved'))
    return reply.redirect('/admin/settings', 302)
  })
}

export default settingsRoutes
