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
    'data-name', 'data-roll-id', 'data-item-ability', 'data-ability-source', 'data-text', 'data-preset',
    'data-tab', 'data-stat',
    'value', 'id', 'src', 'min', 'max', 'type', 'disabled',
    'selected', 'placeholder', 'aria-hidden',
  ],
};

const MOJIBAKE_PATTERN = /(?:[\u00C2\u00C3][\u0080-\u00BF]|[\u00E2\u00F0][\u0080-\u00BF]{1,3}|\uFFFD)/;
const MOJIBAKE_SCORE = /(?:[\u00C2\u00C3]|[\u00E2\u00F0]|\uFFFD)/g;

function scoreMojibake(value) {
  return (String(value || '').match(MOJIBAKE_SCORE) || []).length;
}

function decodeLatin1Mojibake(value) {
  const bytes = Array.from(String(value || ''))
    .map(char => {
      const code = char.charCodeAt(0);
      if (code > 0xff) return encodeURIComponent(char);
      return `%${code.toString(16).padStart(2, '0')}`;
    })
    .join('');
  return decodeURIComponent(bytes);
}

export function sanitizeStrict(html) {
  return DOMPurify.sanitize(html, STRICT);
}

export function sanitize(html) {
  return DOMPurify.sanitize(html, TRUSTED);
}

export function repairDisplayText(value) {
  if (typeof value !== 'string') return value;

  let current = value.replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n');
  let currentScore = scoreMojibake(current);

  for (let i = 0; i < 3 && MOJIBAKE_PATTERN.test(current); i++) {
    try {
      const candidate = decodeLatin1Mojibake(current);
      const candidateScore = scoreMojibake(candidate);
      if (candidateScore >= currentScore) break;
      current = candidate;
      currentScore = candidateScore;
    } catch {
      break;
    }
  }

  return current;
}

export function repairHtmlText(value) {
  if (typeof value !== 'string') return value;
  return repairDisplayText(value).replace(/[ \t]+\n/g, '\n');
}

export function repairStoredText(value) {
  if (typeof value === 'string') return repairDisplayText(value);
  if (Array.isArray(value)) return value.map(item => repairStoredText(item));
  if (!value || typeof value !== 'object') return value;

  const clone = {};
  Object.entries(value).forEach(([key, entryValue]) => {
    clone[key] = repairStoredText(entryValue);
  });
  return clone;
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
