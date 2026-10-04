export default {
  type: 'merch',
  title: { en: 'Merch', sr: 'Merch' },
  description: {
    en: 'An album where each photo carries a name, a price and an order button — all three right here.',
    sr: 'Album u kome svaka fotografija ima naziv, cenu i dugme za porudžbinu — sve troje odmah ovde.'
  },

  defaults: { anchor: 'merch', navLabel: { en: 'Merch', sr: 'Merch' } },

  texts: [
    { key: 'heading', label: { en: 'Heading', sr: 'Naslov' }, input: 'text', general: true },
    { key: 'intro', label: { en: 'Text under the heading', sr: 'Tekst ispod naslova' }, input: 'textarea', rows: 2 },
    { key: 'order', label: { en: '«Order» button', sr: 'Dugme «Poruči»' }, input: 'text' },
    { key: 'form_title', label: { en: 'Order window title', sr: 'Naslov prozora porudžbine' }, input: 'text' },
    { key: 'label_city', label: { en: 'City field label', sr: 'Naziv polja za grad' }, input: 'text' },
    {
      key: 'label_contact',
      label: {
        en: 'Buyer contact — field label',
        sr: 'Kontakt kupca — naziv polja'
      },
      input: 'text',
      hint: {
        en: 'Above the pair «kind of contact + address». The kinds themselves — e-mail and Telegram — are fixed; both are checked before the order is accepted.',
        sr: 'Iznad para «vrsta kontakta + adresa». Same vrste — e-mail i Telegram — su fiksne; obe se proveravaju pre prijema porudžbine.'
      }
    },
    {
      key: 'bad_contact',
      label: { en: 'Wrong address message', sr: 'Poruka o netačnoj adresi' },
      input: 'text'
    },
    { key: 'label_message', label: { en: 'Message field label', sr: 'Naziv polja za poruku' }, input: 'text' },
    { key: 'submit', label: { en: 'Send button', sr: 'Dugme za slanje' }, input: 'text' },
    { key: 'sent', label: { en: 'Thank-you message', sr: 'Poruka zahvalnosti' }, input: 'text' },
    { key: 'failed', label: { en: 'Error message', sr: 'Poruka o grešci' }, input: 'text' }
  ],

  settings: [
    {
      key: 'gallery_id',
      label: { en: 'Album', sr: 'Album' },
      input: 'gallery-picker',
      required: true,
      // Название и цена товара правятся прямо здесь, под снимками.
      itemFields: true,
      hint: {
        en: 'Photos of the album appear below with a name and a price next to each.',
        sr: 'Fotografije albuma su ispod, uz svaku naziv i cena.'
      }
    },
    {
      key: 'columns',
      label: { en: 'Columns', sr: 'Kolone' },
      input: 'number',
      // Одна колонка — нормальный макет: крупная карточка в ряд.
      min: 1,
      max: 5,
      default: 3
    }
  ],

  template: 'blocks/merch'
}
