export default {
  type: 'contact',
  title: { en: 'Contacts', sr: 'Kontakt' },
  description: {
    en: 'An address and a short form. Messages land in the admin and, when mail is set up, in the inbox.',
    sr: 'Adresa i kratka forma. Poruke stižu u admin, a kada je pošta podešena — i na mejl.'
  },

  defaults: { anchor: 'contact', navLabel: { en: 'Contact', sr: 'Kontakt' } },

  texts: [
    { key: 'heading', label: { en: 'Heading', sr: 'Naslov' }, input: 'text', general: true },
    { key: 'intro', label: { en: 'Text above the form', sr: 'Tekst iznad forme' }, input: 'textarea', rows: 2 },
    { key: 'label_message', label: { en: 'Message field label', sr: 'Naziv polja za poruku' }, input: 'text' },
    {
      key: 'label_contact',
      label: {
        en: 'Reply-to — field label',
        sr: 'Odgovor — naziv polja'
      },
      input: 'text',
      hint: {
        en: 'Above the pair «kind of contact + address». The kinds — e-mail and Telegram — are fixed; both are checked before the message is accepted.',
        sr: 'Iznad para «vrsta kontakta + adresa». Vrste — e-mail i Telegram — su fiksne; obe se proveravaju pre prijema poruke.'
      }
    },
    {
      key: 'bad_contact',
      label: { en: 'Wrong address message', sr: 'Poruka o netačnoj adresi' },
      input: 'text'
    },
    { key: 'submit', label: { en: 'Button', sr: 'Dugme' }, input: 'text' },
    { key: 'sent', label: { en: 'Thank-you message', sr: 'Poruka zahvalnosti' }, input: 'text' },
    { key: 'failed', label: { en: 'Error message', sr: 'Poruka o grešci' }, input: 'text' }
  ],

  settings: [
    {
      key: 'email',
      label: { en: 'Address shown on the page', sr: 'Adresa prikazana na strani' },
      input: 'text',
      default: 'padaliband@gmail.com',
      hint: {
        en: 'Shown as a mailto link. Where the form goes is set by MAIL_TO on the server.',
        sr: 'Prikazuje se kao mailto veza. Gde ide forma, određuje MAIL_TO na serveru.'
      }
    },
    {
      key: 'show_form',
      label: { en: 'Show the form', sr: 'Prikaži formu' },
      input: 'checkbox',
      default: true,
      hint: {
        en: 'Off — only the address is left on the page.',
        sr: 'Isključeno — na strani ostaje samo adresa.'
      }
    }
  ],

  template: 'blocks/contact'
}
