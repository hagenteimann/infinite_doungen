import DOMPurify from 'dompurify';

const STRICT = {
  ALLOWED_TAGS: [
    'span', 'strong', 'em', 'i', 'div', 'br', 'p',
    'ul', 'li', 'img',
  ],
  ALLOWED_ATTR: [
    'class', 'style', 'title', 'data-prompt', 'src', 'aria-hidden',
  ],
  FORBID_ATTR: ['onclick', 'onchange', 'onerror', 'onload', 'oninput', 'onkeydown'],
};

const TRUSTED = {
  ALLOWED_TAGS: [
    'span', 'strong', 'em', 'i', 'div', 'br', 'p', 'button',
    'select', 'option', 'optgroup', 'label', 'h3', 'h4',
    'ul', 'li', 'img', 'input',
  ],
  ALLOWED_ATTR: [
    'class', 'style', 'title', 'data-prompt', 'data-action',
    'data-id', 'data-char-id', 'data-item', 'data-equipped',
    'data-count', 'data-idx', 'data-talent', 'data-ability',
    'data-close-modal', 'data-route', 'data-merchant-id',
    'data-safe-id', 'data-merchant-name', 'data-entity-type', 'data-entity-id',
    'data-name', 'data-roll-id', 'data-item-ability', 'data-text', 'data-preset',
    'data-tab', 'data-stat',
    'value', 'id', 'src', 'min', 'max', 'type', 'disabled',
    'selected', 'placeholder', 'aria-hidden',
  ],
};

export function sanitizeStrict(html) {
  return DOMPurify.sanitize(html, STRICT);
}

export function sanitize(html) {
  return DOMPurify.sanitize(html, TRUSTED);
}

export function validateSaveData(data) {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid save data');
  delete data.__proto__;
  delete data.constructor;
  return data;
}

export function validateHeroData(data) {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid hero data');
  delete data.__proto__;
  delete data.constructor;
  const required = ['name', 'class'];
  for (const key of required) {
    if (typeof data[key] !== 'string' || !data[key].trim()) {
      throw new Error(`Missing required field: ${key}`);
    }
  }
  return data;
}
