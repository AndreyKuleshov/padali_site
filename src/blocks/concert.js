export default {
  type: 'concert',
  title: { en: 'Concerts', sr: 'Koncerti' },
  description: {
    en: 'One or more concerts: poster, date, venue, tickets. Several are flipped through like photos.',
    sr: 'Jedan ili više koncerata: plakat, datum, mesto, karte. Više njih se lista kao fotografije.'
  },

  defaults: { anchor: 'concert', navLabel: { en: 'Concert', sr: 'Koncert' } },

  texts: [
    { key: 'heading', label: { en: 'Section heading', sr: 'Naslov sekcije' }, input: 'text', general: true }
  ],

  settings: [
    {
      key: 'events',
      label: { en: 'Concerts', sr: 'Koncerti' },
      input: 'repeater',
      tabs: true,
      addLabel: { en: 'Add concert', sr: 'Dodaj koncert' },
      tabLabel: { en: 'Concert', sr: 'Koncert' },
      fields: [
        { key: 'poster', label: { en: 'Poster', sr: 'Plakat' }, input: 'media' },
        { key: 'date', label: { en: 'Date', sr: 'Datum' }, input: 'date', required: true },
        { key: 'venue', label: { en: 'Venue', sr: 'Mesto' }, input: 'text', translatable: true },
        { key: 'note', label: { en: 'Note', sr: 'Napomena' }, input: 'textarea', rows: 2, translatable: true },
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
        { key: 'ticket_label', label: { en: 'Ticket button label', sr: 'Tekst dugmeta za karte' }, input: 'text', translatable: true },
        {
          key: 'price',
          label: { en: 'Price', sr: 'Cena' },
          input: 'price',
          hint: {
            en: 'Amount and currency. Leave the amount empty to hide the price.',
            sr: 'Iznos i valuta. Ostavite iznos prazan da se cena sakrije.'
          }
        },
        { key: 'tag', label: { en: 'Tag', sr: 'Oznaka' }, input: 'text', translatable: true }
      ]
    }
  ],

  template: 'blocks/concert'
}
