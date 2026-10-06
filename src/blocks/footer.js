import { ICON_NAMES } from '../services/icons.js'

export default {
  type: 'footer',
  title: { en: 'Footer', sr: 'Podnožje' },
  description: {
    en: 'Logo, a line of text and small links. Always last on the page.',
    sr: 'Logotip, red teksta i male veze. Uvek poslednje na strani.'
  },

  // Подвал — всегда последний блок, переставить его нельзя.
  pinned: 'bottom',

  texts: [
    {
      key: 'note',
      label: { en: 'Text on the right', sr: 'Tekst desno' },
      input: 'text',
      hint: {
        en: 'The year is added by the site itself, next to «©» — do not type it in.',
        sr: 'Godinu sajt dodaje sam, pored «©» — nemojte je kucati.'
      }
    }
  ],

  media: [
    { key: 'logo', label: { en: 'Logo', sr: 'Logotip' }, fallback: 'siteLogo', size: { w: 640 } }
  ],

  settings: [
    {
      key: 'show_logo',
      label: { en: 'Show the logo', sr: 'Prikaži logotip' },
      input: 'checkbox',
      default: true,
      hint: {
        en: 'If no logo is uploaded, the one from the site header is used.',
        sr: 'Ako logotip nije otpremljen, koristi se onaj iz zaglavlja sajta.'
      }
    },
    {
      key: 'links',
      label: { en: 'Links', sr: 'Veze' },
      input: 'repeater',
      hint: {
        en: 'Empty — the footer shows the social links from site settings.',
        sr: 'Prazno — podnožje prikazuje mreže iz podešavanja sajta.'
      },
      addLabel: { en: 'Add link', sr: 'Dodaj vezu' },
      fields: [
        { key: 'icon', label: { en: 'Icon', sr: 'Ikona' }, input: 'select', options: ICON_NAMES },
        { key: 'label', label: { en: 'Name', sr: 'Naziv' }, input: 'text' },
        // Смысловое подполе строки: без адреса строка пустая.
        { key: 'url', label: { en: 'Link', sr: 'Link' }, input: 'url', required: true }
      ],
      default: []
    }
  ],

  template: 'blocks/footer'
}
