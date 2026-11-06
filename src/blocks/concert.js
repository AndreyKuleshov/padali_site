/*
 * Концерты приходят из Bandsintown.
 *
 * Даты, площадки, билеты и описание заводят там — для афиш,
 * трекеров и рассылки, — и второй такой же список в админке
 * неизбежно с ним разъезжается: кто-то переносит концерт в одном
 * месте и забывает в другом. Поэтому у блока нет полей под
 * события: он только показывает то, что принесла синхронизация.
 *
 * Своя афиша и цена к событию всё-таки нужны — в Bandsintown их
 * просто нет. Они правятся на отдельном экране, «Концерты», у
 * каждого события отдельно, и синхронизация их не трогает.
 */
export default {
  type: 'concert',
  title: { en: 'Concerts', sr: 'Koncerti' },
  description: {
    en: 'Upcoming concerts from Bandsintown: date, venue, tickets. Several are flipped through like photos.',
    sr: 'Predstojeći koncerti iz Bandsintown-a: datum, mesto, karte. Više njih se lista kao fotografije.'
  },

  defaults: { anchor: 'concert', navLabel: { en: 'Concert', sr: 'Koncert' } },

  texts: [
    { key: 'heading', label: { en: 'Section heading', sr: 'Naslov sekcije' }, input: 'text', general: true }
  ],

  /* Полей у блока нет, и подсказка — единственное место, где можно
     сказать редактору, куда идти за концертами. Иначе пустой блок
     выглядит сломанным. */
  note: {
    en: 'Concerts come from Bandsintown: add and edit them there. The poster and the price are not in Bandsintown — set them here, per concert.',
    sr: 'Koncerti dolaze iz Bandsintown-a: tamo ih dodajete i menjate. Plakat i cena u Bandsintown-u ne postoje — njih postavljate ovde, za svaki koncert.'
  },
  noteLink: { url: '/admin/concerts', label: { en: 'Concerts', sr: 'Koncerti' } },

  /* Блок без будущих концертов не рисуется — значит, и пункта меню
     на него быть не должно: он прокрутил бы страницу в никуда.
     События кладёт в settings композитор страницы. */
  isEmpty: (settings) => !Array.isArray(settings?.events) || settings.events.length === 0,

  template: 'blocks/concert'
}
