export default {
  type: 'concert',
  title: { en: 'Concert', sr: 'Koncert' },
  description: {
    en: 'Poster, date, venue and a ticket link.',
    sr: 'Plakat, datum, mesto i link za karte.'
  },

  texts: [
    { key: 'heading', label: { en: 'Section heading', sr: 'Naslov sekcije' }, input: 'text' },
    { key: 'venue',   label: { en: 'Venue', sr: 'Mesto' },          input: 'text' },
    { key: 'note',    label: { en: 'Note', sr: 'Napomena' },        input: 'textarea', rows: 2 },
    { key: 'tag',     label: { en: 'Tag', sr: 'Oznaka' },               input: 'text' },
    { key: 'ticket_label', label: { en: 'Ticket button label', sr: 'Tekst dugmeta za karte' }, input: 'text' }
  ],

  media: [
    { key: 'poster', label: { en: 'Poster', sr: 'Plakat' } }
  ],

  settings: [
    { key: 'date',       label: { en: 'Concert date', sr: 'Datum koncerta' },   input: 'date' },
    { key: 'ticket_url', label: { en: 'Ticket link', sr: 'Link za karte' }, input: 'url' }
  ],

  template: 'blocks/concert'
}
