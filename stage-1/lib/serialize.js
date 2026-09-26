'use strict';

const { createEmptyState } = require('./store');

function serializeState(state) {
  return {
    currency: state.currency,
    minorUnits: state.minorUnits,
    settlementOperatorIds: [...state.settlementOperatorIds],
    users: [...state.users.values()],
    tokens: [...state.tokens.entries()].map(([token, userId]) => ({ token, userId })),
    payments: [...state.payments.values()],
    requests: [...state.requests.values()],
    splits: [...state.splits.values()],
    settlements: [...state.settlements.values()],
    idempotency: [...state.idempotency.entries()].map(([k, v]) => ({ k, v })),
    counters: { ...state.counters },
  };
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deserializeState(obj) {
  if (!isPlainObject(obj)) throw new Error('state must be an object');
  const state = createEmptyState();
  state.currency = obj.currency;
  state.minorUnits = obj.minorUnits;
  for (const id of obj.settlementOperatorIds || []) state.settlementOperatorIds.add(id);
  for (const u of obj.users || []) {
    if (!isPlainObject(u) || typeof u.id !== 'string' || typeof u.handle !== 'string') {
      throw new Error('invalid user record');
    }
    state.users.set(u.id, u);
    state.usersByHandle.set(u.handle, u.id);
    if (typeof u.emailLower === 'string') state.usersByEmail.set(u.emailLower, u.id);
  }
  for (const t of obj.tokens || []) {
    if (!isPlainObject(t) || typeof t.token !== 'string' || typeof t.userId !== 'string') {
      throw new Error('invalid token record');
    }
    state.tokens.set(t.token, t.userId);
  }
  for (const p of obj.payments || []) state.payments.set(p.payment_id, p);
  for (const r of obj.requests || []) state.requests.set(r.request_id, r);
  for (const s of obj.splits || []) state.splits.set(s.split_id, s);
  for (const s of obj.settlements || []) state.settlements.set(s.settlement_id, s);
  for (const item of obj.idempotency || []) {
    if (!isPlainObject(item) || typeof item.k !== 'string') throw new Error('invalid idempotency record');
    state.idempotency.set(item.k, item.v);
  }
  if (isPlainObject(obj.counters)) state.counters = { ...state.counters, ...obj.counters };
  if (typeof state.currency !== 'string' || !Number.isInteger(state.minorUnits)) {
    throw new Error('invalid currency/minorUnits');
  }
  return state;
}

module.exports = { serializeState, deserializeState, isPlainObject };
