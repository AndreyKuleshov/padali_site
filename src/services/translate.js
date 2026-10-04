/**
 * Перевод строк админки.
 *
 * Редактор пишет текст на том языке, на котором думает, и получает
 * обе версии сразу. Перевод — подсказка, а не истина: поля остаются
 * обычными и правятся руками, поэтому ошибка модели стоит дёшево.
 *
 * Ключа может не быть — тогда функция честно говорит об этом, а
 * админка не показывает кнопок.
 */
import config from '../config.js'

/** Как называть язык модели: код вроде «sr» она понимает хуже. */
const LANGUAGE_NAMES = {
  en: 'English',
  sr: 'Serbian in Latin script (gajica) — never Cyrillic',
  ru: 'Russian',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  hr: 'Croatian',
  bs: 'Bosnian'
}

function languageName (code, title) {
  return LANGUAGE_NAMES[code] ?? title ?? code
}

/**
 * Сербская кириллица в латиницу.
 *
 * Сайт написан латиницей, и модель, как бы её ни просили, изредка
 * отвечает кириллицей. Соответствие однозначное, так что чинится
 * это на месте и без второго запроса.
 */
const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'č', џ: 'dž', ш: 'š'
}

const HAS_CYRILLIC = /[\u0400-\u04FF]/

export function toLatin (text) {
  if (!HAS_CYRILLIC.test(text)) return text

  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const lower = char.toLowerCase()
    const latin = CYRILLIC_TO_LATIN[lower]
    if (latin === undefined) { out += char; continue }
    if (char === lower) { out += latin; continue }

    /* Прописная љ — это «Lj» в слове и «LJ» в наборе капсом.
       Различаем по следующей букве: ЉУБАВ → LJUBAV, Љубав → Ljubav. */
    const next = text[index + 1] ?? ''
    const shout = next !== '' && next === next.toUpperCase() && next !== next.toLowerCase()
    out += shout ? latin.toUpperCase() : latin[0].toUpperCase() + latin.slice(1)
  }
  return out
}

/**
 * Первая буква — прописная.
 *
 * Модель иногда отвечает со строчной, повторяя регистр источника,
 * а на странице это заголовок или пункт меню. Разметку в начале
 * пропускаем: «<p>текст» должен стать «<p>Текст», а не «<P>».
 */
export function capitalizeFirst (text) {
  const prefix = /^(?:\s|<[^>]*>)*/.exec(text)[0]
  const rest = text.slice(prefix.length)
  if (rest === '') return text

  const [first] = Array.from(rest)
  const upper = first.toUpperCase()
  return upper === first ? text : prefix + upper + rest.slice(first.length)
}

export function isConfigured (settings = config.openai) {
  return Boolean(settings.apiKey)
}

const SYSTEM = [
  'You translate short strings for the website of PADALI, a Serbian rapcore band.',
  'The text is a heading, a menu label, a caption or a short paragraph on that site.',
  'Rules:',
  '- Translate closely and literally. Keep the register of a band site: direct, informal,',
  '  no corporate wording, no polishing.',
  /* Сайт рэпкор-группы: брань там часть языка, а не случайность.
     Смягчённый перевод — неверный перевод, и редактор всё равно
     перепишет его руками. */
  '- Slang and profanity are translated as they are: the same meaning and the same strength.',
  '  Never soften, censor, asterisk out or replace a rude word with a polite one.',
  '  This is the band writing about itself; the rough wording is deliberate.',
  /* Без этого модель переписывала русский мат латиницей:
     «Zaebis majica» вместо сербского «Jebeno dobra majica». */
  '- Swear in the target language, do not transliterate the source. A Serbian reader must',
  '  see Serbian swearing (jebeno, kurac, sranje), an English one English swearing.',
  '- Keep the length close to the source. These strings sit in a layout.',
  '- Keep placeholders such as {days} exactly as they are.',
  '- Keep HTML tags, markdown and line breaks exactly as they are.',
  '- Keep proper names, band names, venue names and track titles unchanged.',
  '- Serbian is ALWAYS written in Latin script (gajica), never in Cyrillic.',
  '  Use the letters č ć ž š đ where they belong.',
  '- Start every translation with a capital letter.',
  '- Return the translation only, with no quotes and no commentary.'
].join('\n')

/**
 * @param {object} input
 * @param {string} input.text исходный текст на любом языке
 * @param {Array<{code: string, title?: string}>} input.locales куда переводить
 * @returns {Promise<{ok: true, translations: Record<string, string>, source: string}
 *                 | {ok: false, reason: 'not_configured'|'empty'|'gibberish'|'unreachable'|'refused'}>}
 */
export async function translate ({ text, locales }, {
  fetchImpl = fetch, settings = config.openai
} = {}) {
  const source = String(text ?? '').trim()
  if (source === '') return { ok: false, reason: 'empty' }
  if (!isConfigured(settings)) return { ok: false, reason: 'not_configured' }

  const targets = (locales ?? []).filter((locale) => locale?.code)
  if (targets.length === 0) return { ok: false, reason: 'empty' }

  const wanted = targets
    .map((locale) => `- "${locale.code}": ${languageName(locale.code, locale.title)}`)
    .join('\n')

  let response
  try {
    response = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        // Перевод не место для выдумки: нужен предсказуемый ответ.
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `The site is published in these languages:\n${wanted}\n\n` +
              'First decide which language the text below is written in. Then answer ' +
              'with a JSON object holding:\n' +
              '- "source": the code of that language if it is one of the codes above, ' +
              'otherwise the string "other";\n' +
              '- one key for EVERY code above except the one you put in "source", each ' +
              'holding the translation into that language.\n\n' +
              /* Без примеров модель на «other» всё равно отдавала один
                 язык из двух — контракт задаём показом, а не описанием. */
              'For codes "en" and "sr" that means:\n' +
              '- text written in Serbian -> {"source": "sr", "en": "…"}\n' +
              '- text written in English -> {"source": "en", "sr": "…"}\n' +
              '- text in any other language -> {"source": "other", "en": "…", "sr": "…"}\n\n' +
              'Only if the text is not language at all — a keyboard mash with no words in ' +
              'it, like "йщлокйдцлтадй" or "asdkjhasd" — answer exactly ' +
              '{"source": "gibberish"} and nothing else. Any text made of real words is NOT ' +
              'gibberish, however short, slangy, rude or offensive it is: translate it.\n\n' +
              `Text:\n${source}`
          }
        ]
      }),
      signal: AbortSignal.timeout(settings.timeoutMs)
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  // 401 и 429 — это про ключ и квоту, а не про текст; разделять их
  // в интерфейсе незачем, но «отказано» и «не доехало» — разное.
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    return { ok: false, reason: 'refused' }
  }
  if (!response.ok) return { ok: false, reason: 'unreachable' }

  let payload
  try {
    payload = await response.json()
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  const content = payload?.choices?.[0]?.message?.content
  let parsed
  try {
    parsed = JSON.parse(String(content ?? ''))
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  const detected = typeof parsed?.source === 'string' ? parsed.source.trim().toLowerCase() : ''

  /* Набор букв переводить не во что, и подсунуть его в поля
     молча нельзя: редактор решит, что перевод сделан. */
  if (detected === 'gibberish') return { ok: false, reason: 'gibberish' }

  const translations = {}

  for (const locale of targets) {
    /* В поле того языка, на котором писали, кладём исходник как
       есть. Через модель он вернулся бы пересказанным, а править
       то, что уже написано рукой редактора, незачем. */
    const value = locale.code === detected ? source : parsed?.[locale.code]
    // Пропуск языка — не повод терять остальные: отдаём что есть.
    if (typeof value !== 'string' || value.trim() === '') continue

    const latin = locale.code === 'sr' ? toLatin(value.trim()) : value.trim()
    translations[locale.code] = capitalizeFirst(latin)
  }

  if (Object.keys(translations).length === 0) return { ok: false, reason: 'unreachable' }
  return { ok: true, translations, source: detected || 'other' }
}
