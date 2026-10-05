export default {
  type: 'concert',
  title: { en: 'Concert', sr: 'Koncert' },
  description: {
    en: 'Poster, date, venue and a ticket link.',
    sr: 'Plakat, datum, mesto i link za karte.'
  },

  defaults: { anchor: 'concert', navLabel: { en: 'Concert', sr: 'Koncert' } },

  texts: [
    { key: 'heading', label: { en: 'Section heading', sr: 'Naslov sekcije' }, input: 'text', general: true },
    { key: 'venue',   label: { en: 'Venue', sr: 'Mesto' },          input: 'text' },
    { key: 'note',    label: { en: 'Note', sr: 'Napomena' },        input: 'textarea', rows: 2 },
    { key: 'tag',     label: { en: 'Tag', sr: 'Oznaka' },               input: 'text' },
    { key: 'ticket_label', label: { en: 'Ticket button label', sr: 'Tekst dugmeta za karte' }, input: 'text' }
  ],

  media: [
    { key: 'poster', label: { en: 'Poster', sr: 'Plakat' } }
  ],

  settings: [
    { key: 'date', label: { en: 'Concert date', sr: 'Datum koncerta' }, input: 'date' },
    {
      key: 'tickets',
      label: { en: 'Tickets', sr: 'Karte' },
      input: 'select',
      options: ['link', 'door'],
      optionLabels: {
        link: { en: 'Sold by a link', sr: 'Prodaju se preko linka' },
        door: { en: 'At the door', sr: 'Na ulazu' }
      },
      default: 'link',
      hint: {
        en: 'With «at the door» the link below is not shown, even if filled.',
        sr: 'Uz «na ulazu» link ispod se ne prikazuje, čak i ako je popunjen.'
      }
    },
    { key: 'ticket_url', label: { en: 'Ticket link', sr: 'Link za karte' }, input: 'url' },
    {
      key: 'price',
      label: { en: 'Price', sr: 'Cena' },
      input: 'price',
      hint: {
        en: 'Amount and currency. Leave the amount empty to hide the price.',
        sr: 'Iznos i valuta. Ostavite iznos prazan da se cena sakrije.'
      }
    }
  ],

  template: 'blocks/concert'
}
