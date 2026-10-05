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
    const settings = await getAllSettings()
    const [locales, page, library] = await Promise.all([
      listLocales(),
      getPageBySlug(HOME_SLUG),
      listMediaForPicker([Number(settings.logo_id), Number(settings.og_image_id)])
    ])
    const pageTexts = page ? await getPageTexts(page.id) : {}
    // Логотип разрешаем той же цепочкой, что и сайт: свой из
    // медиатеки либо встроенный файл. Иначе поле выглядит пустым,
    // хотя в шапке логотип стоит.
    const logo = await logoFromSettings(settings)

    /* Иконки соцсетей — такой же повторитель, как ссылки в блоке,
       и рисуются тем же партиалом. Описание строки живёт здесь:
       у настроек нет дескриптора, из которого его взять. */
    const socialField = {
      key: 'social',
      fields: [
        { key: 'icon', label: request.t('settings.icon'), input: 'select', options: ICON_NAMES },
        { key: 'label', label: request.t('settings.label'), input: 'text' },
        { key: 'url', label: request.t('settings.url'), input: 'url' }
      ]
    }

    return renderAdmin(request, reply, 'admin/settings', {
      logo,
      socialField,
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

    /* Поля нет в теле — настройку не трогаем. Пустое значение это
       «очистить», а отсутствие поля — признак, что форма пришла
       неполной, и стирать по нему нечего. */
    async function saveMediaSetting (key) {
      if (!Object.hasOwn(request.body ?? {}, key)) return
      const id = Number.parseInt(asString(request.body[key]), 10)
      await setSetting(key, Number.isInteger(id) && id > 0 ? id : null)
    }

    await setSetting('social', social)
    await setSetting('footer_note', asString(request.body?.footer_note))
    await saveMediaSetting('og_image_id')
    await saveMediaSetting('logo_id')

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
