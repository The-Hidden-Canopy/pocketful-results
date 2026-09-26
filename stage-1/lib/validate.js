'use strict';

const MAX_AMOUNT = 1000000000;
const SAFE_CEILING = Math.pow(2, 53);

function charLength(str) {
  return [...str].length;
}

function isPlainNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidAmount(v) {
  return isPlainNumber(v) && Number.isInteger(v) && v >= 1 && v <= MAX_AMOUNT;
}

function isValidHandle(h) {
  return typeof h === 'string' && /^[a-z0-9_]{1,20}$/.test(h);
}

function isValidVisibility(v) {
  return v === 'public' || v === 'private';
}

function isValidNote(n) {
  return typeof n === 'string' && charLength(n) <= 200;
}

function isPlainDecimalDigits(s) {
  return typeof s === 'string' && /^[0-9]+$/.test(s);
}

function parseListParams(query) {
  const errors = [];
  let limit = 50;
  let offset = 0;
  if (Object.prototype.hasOwnProperty.call(query, 'limit')) {
    const raw = query.limit;
    if (!isPlainDecimalDigits(raw)) {
      errors.push('limit');
    } else {
      limit = parseInt(raw, 10);
      if (limit < 1 || limit > 200) errors.push('limit');
    }
  }
  if (Object.prototype.hasOwnProperty.call(query, 'offset')) {
    const raw = query.offset;
    if (!isPlainDecimalDigits(raw)) {
      errors.push('offset');
    } else {
      offset = parseInt(raw, 10);
      if (offset < 0) errors.push('offset');
    }
  }
  return { limit, offset, valid: errors.length === 0 };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return false;
    }
    for (const key of aKeys) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function wouldExceedCeiling(balance) {
  return balance > SAFE_CEILING || balance < -SAFE_CEILING;
}

module.exports = {
  MAX_AMOUNT,
  SAFE_CEILING,
  charLength,
  isPlainNumber,
  isValidAmount,
  isValidHandle,
  isValidVisibility,
  isValidNote,
  isPlainDecimalDigits,
  parseListParams,
  deepEqual,
  wouldExceedCeiling,
};
