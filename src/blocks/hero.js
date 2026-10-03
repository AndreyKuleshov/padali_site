export default {
  type: 'hero',
  title: 'Шапка',
  description: 'Фотография на всю высоту экрана, вордмарк и слоган поверх неё.',

  texts: [
    { key: 'tagline', label: 'Слоган', input: 'text' }
  ],

  media: [
    { key: 'background', label: 'Фоновая фотография', required: true }
  ],

  settings: [
    { key: 'show_wordmark', label: 'Показывать вордмарк поверх фото', input: 'checkbox', default: true },
    { key: 'full_height',   label: 'На всю высоту экрана',           input: 'checkbox', default: true }
  ],

  template: 'blocks/hero'
}
