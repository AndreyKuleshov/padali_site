/**
 * Строки самого сайта, которых нет в админке.
 *
 * Это не содержимое, а обвязка: подписи кнопок по умолчанию,
 * aria-подписи стрелок, ответы форм. Редактор их не пишет, но
 * посетитель видит, и на сербском они должны быть сербскими.
 *
 * Раньше каждая такая строка стояла в шаблоне как
 * `sr ? 'Nazad' : 'Previous'`. Пока языков два, это работает;
 * третий получил бы английский молча, а найти все двадцать шесть
 * развилок можно было только перебором шаблонов.
 *
 * Отсутствующий перевод откатывается на английский — как в админке.
 */
const FALLBACK = 'en'

const DICTIONARY = {
  en: {
    'common.close': 'Close',

    'nav.social': 'Social links',
    'nav.sections': 'Sections',

    'form.submit': 'Send',
    'form.badContact': 'That address does not look right',

    'gallery.previous': 'Previous',
    'gallery.next': 'Next',
    'gallery.showing': 'Showing',
    'gallery.of': 'of',

    'lightbox.title': 'Photo viewer',
    'lightbox.previous': 'Previous photo',
    'lightbox.next': 'Next photo',

    'youtube.play': 'Play the video',
    'youtube.watch': 'Watch on YouTube',

    'merch.order': 'Order',
    'merch.formTitle': 'Order',
    'merch.city': 'City',
    'merch.contact': 'How we reach you',
    'merch.message': 'Message (optional)',
    'merch.sent': 'Thanks, we will get back to you.',
    'merch.failed': 'Not sent. Please try again.',

    'contact.message': 'Message',
    'contact.contact': 'How we reach you',
    'contact.sent': 'Thanks, your message is on its way.',
    'contact.failed': 'Not sent. Please write to the address above.'
  },
  sr: {
    'common.close': 'Zatvori',

    'nav.social': 'Društvene mreže',
    'nav.sections': 'Sadržaj',

    'form.submit': 'Pošalji',
    'form.badContact': 'Netačna adresa',

    'gallery.previous': 'Nazad',
    'gallery.next': 'Napred',
    'gallery.showing': 'Prikazano',
    'gallery.of': 'od',

    'lightbox.title': 'Pregled fotografija',
    'lightbox.previous': 'Prethodna fotografija',
    'lightbox.next': 'Sledeća fotografija',

    'youtube.play': 'Pusti video',
    'youtube.watch': 'Pogledaj na YouTube-u',

    'merch.order': 'Poruči',
    'merch.formTitle': 'Porudžbina',
    'merch.city': 'Grad',
    'merch.contact': 'Kako da vas nađemo',
    'merch.message': 'Poruka (nije obavezno)',
    'merch.sent': 'Hvala, javićemo se.',
    'merch.failed': 'Nije poslato. Pokušajte ponovo.',

    'contact.message': 'Poruka',
    'contact.contact': 'Kako da vam odgovorimo',
    'contact.sent': 'Hvala, poruka je poslata.',
    'contact.failed': 'Nije poslato. Pišite nam na mejl iznad.'
  }
}

/** Переводчик для одного языка: s('gallery.next') → строка. */
function siteTranslator (locale) {
  const strings = DICTIONARY[locale] ?? DICTIONARY[FALLBACK]
  return function s (key) {
    return strings[key] ?? DICTIONARY[FALLBACK][key] ?? key
  }
}

export { siteTranslator, DICTIONARY, FALLBACK }
