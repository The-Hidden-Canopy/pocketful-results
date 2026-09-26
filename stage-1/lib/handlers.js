'use strict';

const store = require('./store');
const V = require('./validate');
const { errors } = require('./http-helpers');
const { serializeState, deserializeState } = require('./serialize');

function requireString(body, field, { allowEmpty = true } = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, field) || body[field] === undefined) {
    throw errors.validation(`missing ${field}`);
  }
  const v = body[field];
  if (typeof v !== 'string') throw errors.malformed(`${field} must be a string`);
  if (!allowEmpty && v.length === 0) throw errors.validation(`${field} must not be empty`);
  return v;
}

function userPublic(u) {
  return { user_id: u.id, display_name: u.displayName, handle: u.handle };
}

function paymentPublic(p) {
  return {
    payment_id: p.payment_id,
    from_user_id: p.from_user_id,
    from_handle: p.from_handle,
    to_user_id: p.to_user_id,
    to_handle: p.to_handle,
    amount: p.amount,
    currency: p.currency,
    note: p.note,
    visibility: p.visibility,
    request_id: p.request_id,
    settlement_id: p.settlement_id || null,
    created_at: p.created_at,
  };
}

function requestPublic(r) {
  return {
    request_id: r.request_id,
    requester_id: r.requester_id,
    requester_handle: r.requester_handle,
    payer_id: r.payer_id,
    payer_handle: r.payer_handle,
    amount: r.amount,
    currency: r.currency,
    note: r.note,
    status: r.status,
    payment_id: r.payment_id,
    created_at: r.created_at,
  };
}

function nowIso() {
  return new Date().toISOString().replace('Z', '+00:00');
}

// ---- idempotency ------------------------------------------------------

function withIdempotency(ctx, method, path, run) {
  const state = store.getState();
  const key = ctx.headers['idempotency-key'];
  if (key === undefined || key === '') throw errors.missingKey();
  if (typeof key !== 'string' || key.length > 255) throw errors.validation('Idempotency-Key must be 1-255 characters');
  const mapKey = store.idempotencyKeyFor(ctx.user.id, method, path, key);
  const existing = state.idempotency.get(mapKey);
  if (existing) {
    if (V.deepEqual(existing.body_in, ctx.body)) {
      return { status: 200, body: existing.body_out };
    }
    throw errors.keyReuse();
  }
  const result = run();
  state.idempotency.set(mapKey, { body_in: ctx.body, body_out: result.body });
  return result;
}

// ---- auth ---------------------------------------------------------------

function signup(ctx) {
  const state = store.getState();
  const body = ctx.body;
  const email = requireString(body, 'email', { allowEmpty: false });
  const password = requireString(body, 'password', { allowEmpty: false });
  const displayName = requireString(body, 'display_name');
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw errors.validation('invalid email format');
  if (password.length < 8) throw errors.validation('password too short');
  const emailLower = email.toLowerCase();
  if (state.usersByEmail.has(emailLower)) throw errors.emailTaken();
  const handle = store.deriveHandleFromEmail(email);
  if (state.usersByHandle.has(handle)) throw errors.handleTaken();
  const id = store.nextId('user');
  const user = {
    id,
    email,
    emailLower,
    passwordHash: store.hashPassword(password),
    displayName,
    handle,
    balance: 0,
    isOperator: false,
  };
  state.users.set(id, user);
  state.usersByHandle.set(handle, id);
  state.usersByEmail.set(emailLower, id);
  const token = store.newToken();
  state.tokens.set(token, id);
  return { status: 201, body: { user_id: id, display_name: displayName, token } };
}

function login(ctx) {
  const state = store.getState();
  const body = ctx.body;
  const email = requireString(body, 'email', { allowEmpty: false });
  const password = requireString(body, 'password', { allowEmpty: false });
  const user = state.users.get(state.usersByEmail.get(email.toLowerCase()));
  if (!user || !store.verifyPassword(password, user.passwordHash)) throw errors.unauthenticated();
  const token = store.newToken();
  state.tokens.set(token, user.id);
  return { status: 200, body: { user_id: user.id, display_name: user.displayName, token } };
}

function authenticate(headers) {
  const auth = headers['authorization'];
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw errors.unauthenticated();
  const token = auth.slice('Bearer '.length);
  const state = store.getState();
  const userId = state.tokens.get(token);
  if (!userId) throw errors.unauthenticated();
  const user = state.users.get(userId);
  if (!user) throw errors.unauthenticated();
  return user;
}

function me(ctx) {
  const u = ctx.user;
  const state = store.getState();
  return {
    status: 200,
    body: {
      user_id: u.id,
      display_name: u.displayName,
      handle: u.handle,
      balance: u.balance,
      currency: state.currency,
      minor_units: state.minorUnits,
    },
  };
}

// ---- test control ---------------------------------------------------------

function validateFixtureAndBuild(fixture) {
  if (typeof fixture !== 'object' || fixture === null || Array.isArray(fixture)) {
    throw errors.validation('fixture must be an object');
  }
  if (typeof fixture.currency !== 'string' || fixture.currency.length === 0) {
    throw errors.validation('currency is required');
  }
  if (!Number.isInteger(fixture.minor_units) || fixture.minor_units < 0) {
    throw errors.validation('minor_units is required');
  }
  const state = store.createEmptyState();
  state.currency = fixture.currency;
  state.minorUnits = fixture.minor_units;
  for (const opId of fixture.settlement_operator_ids || []) {
    state.settlementOperatorIds.add(opId);
  }
  const usersInput = Array.isArray(fixture.users) ? fixture.users : [];
  for (const u of usersInput) {
    if (!u || typeof u.id !== 'string' || typeof u.email !== 'string' || typeof u.password !== 'string'
      || typeof u.display_name !== 'string' || typeof u.handle !== 'string' || !Number.isInteger(u.balance)) {
      throw errors.validation('invalid seeded user');
    }
    if (u.balance < 0) throw errors.validation('seeded balance below zero');
    const user = {
      id: u.id,
      email: u.email,
      emailLower: u.email.toLowerCase(),
      passwordHash: store.hashPassword(u.password),
      displayName: u.display_name,
      handle: u.handle,
      balance: u.balance,
      isOperator: state.settlementOperatorIds.has(u.id),
    };
    state.users.set(user.id, user);
    state.usersByHandle.set(user.handle, user.id);
    state.usersByEmail.set(user.emailLower, user.id);
  }
  const paymentsInput = Array.isArray(fixture.payments) ? fixture.payments : [];
  const seedTime = nowIso();
  for (const p of paymentsInput) {
    if (!p || typeof p.id !== 'string' || !state.users.has(p.from_user_id) || !state.users.has(p.to_user_id)
      || !Number.isInteger(p.amount)) {
      throw errors.validation('invalid seeded payment');
    }
    const from = state.users.get(p.from_user_id);
    const to = state.users.get(p.to_user_id);
    state.payments.set(p.id, {
      payment_id: p.id,
      from_user_id: from.id,
      from_handle: from.handle,
      to_user_id: to.id,
      to_handle: to.handle,
      amount: p.amount,
      currency: state.currency,
      note: typeof p.note === 'string' ? p.note : '',
      visibility: p.visibility === 'private' ? 'private' : 'public',
      request_id: null,
      settlement_id: null,
      created_at: seedTime,
    });
  }
  const requestsInput = Array.isArray(fixture.requests) ? fixture.requests : [];
  for (const r of requestsInput) {
    if (!r || typeof r.id !== 'string' || !state.users.has(r.requester_id) || !state.users.has(r.payer_id)
      || !Number.isInteger(r.amount)) {
      throw errors.validation('invalid seeded request');
    }
    const requester = state.users.get(r.requester_id);
    const payer = state.users.get(r.payer_id);
    const status = ['pending', 'paid', 'declined', 'cancelled'].includes(r.status) ? r.status : 'pending';
    state.requests.set(r.id, {
      request_id: r.id,
      requester_id: requester.id,
      requester_handle: requester.handle,
      payer_id: payer.id,
      payer_handle: payer.handle,
      amount: r.amount,
      currency: state.currency,
      note: typeof r.note === 'string' ? r.note : '',
      status,
      payment_id: typeof r.payment_id === 'string' ? r.payment_id : null,
      created_at: seedTime,
    });
  }
  return state;
}

function testReset(ctx) {
  const next = validateFixtureAndBuild(ctx.body);
  store.replaceState(next);
  return { status: 204, body: null };
}

function testExport() {
  const state = store.getState();
  return {
    status: 200,
    body: { track: 'pocketful', format_version: 1, state: serializeState(state) },
  };
}

function testImport(ctx) {
  const body = ctx.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw errors.validation('invalid import payload');
  if (body.track !== 'pocketful') throw errors.validation('unexpected track');
  if (body.format_version !== 1) throw errors.validation('unsupported format_version');
  let next;
  try {
    next = deserializeState(body.state);
  } catch (e) {
    throw errors.validation('invalid state payload');
  }
  store.replaceState(next);
  return { status: 204, body: null };
}

// ---- payments -------------------------------------------------------------

function validateAmountField(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'amount') || body.amount === undefined) {
    throw errors.validation('amount is required');
  }
  if (!V.isValidAmount(body.amount)) throw errors.validation('amount must be an integer between 1 and 1000000000');
  return body.amount;
}

function validateOptionalNote(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'note') || body.note === undefined) return '';
  if (!V.isValidNote(body.note)) throw errors.validation('note must be a string of at most 200 characters');
  return body.note;
}

function validateOptionalVisibility(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'visibility') || body.visibility === undefined) return 'public';
  if (!V.isValidVisibility(body.visibility)) throw errors.validation('visibility must be public or private');
  return body.visibility;
}

function applyTransfer(state, fromUser, toUser, amount) {
  if (V.wouldExceedCeiling(fromUser.balance - amount) || V.wouldExceedCeiling(toUser.balance + amount)) {
    throw errors.validation('operation would exceed the balance ceiling');
  }
  fromUser.balance -= amount;
  toUser.balance += amount;
}

function createPayments(ctx) {
  return withIdempotency(ctx, 'POST', '/payments', () => {
    const state = store.getState();
    const body = ctx.body;
    const amount = validateAmountField(body);
    const note = validateOptionalNote(body);
    const visibility = validateOptionalVisibility(body);
    const toHandle = requireString(body, 'to_handle', { allowEmpty: false });
    if (toHandle === ctx.user.handle) throw errors.selfPayment();
    const toId = state.usersByHandle.get(toHandle);
    if (!toId) throw errors.notFound();
    const toUser = state.users.get(toId);
    if (ctx.user.balance < amount) throw errors.insufficientFunds();
    applyTransfer(state, ctx.user, toUser, amount);
    const id = store.nextId('payment');
    const payment = {
      payment_id: id,
      from_user_id: ctx.user.id,
      from_handle: ctx.user.handle,
      to_user_id: toUser.id,
      to_handle: toUser.handle,
      amount,
      currency: state.currency,
      note,
      visibility,
      request_id: null,
      settlement_id: null,
      created_at: nowIso(),
    };
    state.payments.set(id, payment);
    return { status: 201, body: paymentPublic(payment) };
  });
}

// ---- requests ---------------------------------------------------------------

function createRequest(ctx) {
  return withIdempotency(ctx, 'POST', '/requests', () => {
    const state = store.getState();
    const body = ctx.body;
    const amount = validateAmountField(body);
    const note = validateOptionalNote(body);
    const payerHandle = requireString(body, 'payer_handle', { allowEmpty: false });
    if (payerHandle === ctx.user.handle) throw errors.selfRequest();
    const payerId = state.usersByHandle.get(payerHandle);
    if (!payerId) throw errors.notFound();
    const payer = state.users.get(payerId);
    const id = store.nextId('request');
    const request = {
      request_id: id,
      requester_id: ctx.user.id,
      requester_handle: ctx.user.handle,
      payer_id: payer.id,
      payer_handle: payer.handle,
      amount,
      currency: state.currency,
      note,
      status: 'pending',
      payment_id: null,
      created_at: nowIso(),
    };
    state.requests.set(id, request);
    return { status: 201, body: requestPublic(request) };
  });
}

function payRequest(ctx) {
  return withIdempotency(ctx, 'POST', `/requests/${ctx.params.id}/pay`, () => {
    const state = store.getState();
    const request = state.requests.get(ctx.params.id);
    if (!request) throw errors.notFound();
    if (request.payer_id !== ctx.user.id) throw errors.forbidden();
    if (request.status !== 'pending') throw errors.requestNotPending();
    const requester = state.users.get(request.requester_id);
    if (ctx.user.balance < request.amount) throw errors.insufficientFunds();
    const visibility = validateOptionalVisibility(ctx.body);
    applyTransfer(state, ctx.user, requester, request.amount);
    const id = store.nextId('payment');
    const payment = {
      payment_id: id,
      from_user_id: ctx.user.id,
      from_handle: ctx.user.handle,
      to_user_id: requester.id,
      to_handle: requester.handle,
      amount: request.amount,
      currency: state.currency,
      note: '',
      visibility,
      request_id: request.request_id,
      settlement_id: null,
      created_at: nowIso(),
    };
    state.payments.set(id, payment);
    request.status = 'paid';
    request.payment_id = id;
    return { status: 201, body: paymentPublic(payment) };
  });
}

function declineRequest(ctx) {
  const state = store.getState();
  const request = state.requests.get(ctx.params.id);
  if (!request) throw errors.notFound();
  if (request.payer_id !== ctx.user.id) throw errors.forbidden();
  if (request.status === 'declined') return { status: 200, body: requestPublic(request) };
  if (request.status !== 'pending') throw errors.requestNotPending();
  request.status = 'declined';
  return { status: 200, body: requestPublic(request) };
}

function cancelRequest(ctx) {
  const state = store.getState();
  const request = state.requests.get(ctx.params.id);
  if (!request) throw errors.notFound();
  if (request.requester_id !== ctx.user.id) throw errors.forbidden();
  if (request.status === 'cancelled') return { status: 200, body: requestPublic(request) };
  if (request.status !== 'pending') throw errors.requestNotPending();
  request.status = 'cancelled';
  return { status: 200, body: requestPublic(request) };
}

function listRequests(ctx) {
  const state = store.getState();
  const { limit, offset, valid } = V.parseListParams(ctx.query);
  if (!valid) throw errors.validation('invalid limit/offset');
  const direction = ctx.query.direction;
  if (direction !== undefined && !['incoming', 'outgoing'].includes(direction)) {
    throw errors.validation('invalid direction');
  }
  const status = ctx.query.status;
  if (status !== undefined && !['pending', 'paid', 'declined', 'cancelled'].includes(status)) {
    throw errors.validation('invalid status');
  }
  let items = [...state.requests.values()].filter((r) => r.requester_id === ctx.user.id || r.payer_id === ctx.user.id);
  if (direction === 'incoming') items = items.filter((r) => r.payer_id === ctx.user.id);
  if (direction === 'outgoing') items = items.filter((r) => r.requester_id === ctx.user.id);
  if (status !== undefined) items = items.filter((r) => r.status === status);
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const page = items.slice(offset, offset + limit);
  return {
    status: 200,
    body: { requests: page.map(requestPublic), has_more: offset + limit < items.length },
  };
}

// ---- splits -----------------------------------------------------------------

function equalSplit(amount, n) {
  const base = Math.floor(amount / n);
  const remainder = amount - base * n;
  const shares = [];
  for (let i = 0; i < n; i++) shares.push(base + (i < remainder ? 1 : 0));
  return shares;
}

function createSplit(ctx) {
  return withIdempotency(ctx, 'POST', '/splits', () => {
    const state = store.getState();
    const body = ctx.body;
    const amount = validateAmountField(body);
    const note = validateOptionalNote(body);
    if (!Array.isArray(body.participant_handles) || body.participant_handles.length === 0) {
      throw errors.validation('participant_handles must be a non-empty array');
    }
    const handles = body.participant_handles;
    if (!handles.every((h) => typeof h === 'string')) throw errors.malformed('participant_handles must be strings');
    const seen = new Set();
    for (const h of handles) {
      if (seen.has(h)) throw errors.validation('duplicate participant handle');
      seen.add(h);
    }
    const participants = [];
    for (const h of handles) {
      const id = state.usersByHandle.get(h);
      if (!id) throw errors.notFound();
      participants.push(state.users.get(id));
    }
    const shareAmounts = equalSplit(amount, participants.length);
    const shares = participants.map((p, i) => ({ handle: p.handle, amount: shareAmounts[i] }));
    const requestIds = [];
    const requests = [];
    for (let i = 0; i < participants.length; i++) {
      if (participants[i].id === ctx.user.id) continue;
      const id = store.nextId('request');
      const request = {
        request_id: id,
        requester_id: ctx.user.id,
        requester_handle: ctx.user.handle,
        payer_id: participants[i].id,
        payer_handle: participants[i].handle,
        amount: shareAmounts[i],
        currency: state.currency,
        note,
        status: 'pending',
        payment_id: null,
        created_at: nowIso(),
      };
      state.requests.set(id, request);
      requestIds.push(id);
      requests.push(requestPublic(request));
    }
    const splitId = store.nextId('split');
    const split = {
      split_id: splitId,
      caller_id: ctx.user.id,
      amount,
      currency: state.currency,
      note,
      shares,
      request_ids: requestIds,
      created_at: nowIso(),
    };
    state.splits.set(splitId, split);
    return {
      status: 201,
      body: {
        split_id: splitId,
        amount,
        currency: state.currency,
        note,
        shares,
        requests,
        created_at: split.created_at,
      },
    };
  });
}

// ---- activity -----------------------------------------------------------------

function listActivity(ctx) {
  const state = store.getState();
  const { limit, offset, valid } = V.parseListParams(ctx.query);
  if (!valid) throw errors.validation('invalid limit/offset');
  let items = [...state.payments.values()].filter(
    (p) => p.visibility === 'public' || p.from_user_id === ctx.user.id || p.to_user_id === ctx.user.id
  );
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const page = items.slice(offset, offset + limit);
  return { status: 200, body: { payments: page.map(paymentPublic), has_more: offset + limit < items.length } };
}

// ---- settlements -----------------------------------------------------------------

function createSettlement(ctx) {
  if (!ctx.user.isOperator) throw errors.forbidden();
  return withIdempotency(ctx, 'POST', '/settlements', () => {
    const state = store.getState();
    const body = ctx.body;
    if (!Array.isArray(body.transfers) || body.transfers.length < 1 || body.transfers.length > 32) {
      throw errors.validation('transfers must be an array of 1 to 32 entries');
    }
    const resolved = [];
    for (const t of body.transfers) {
      if (!t || typeof t !== 'object') throw errors.validation('malformed transfer entry');
      const fromHandle = requireString(t, 'from_handle', { allowEmpty: false });
      const toHandle = requireString(t, 'to_handle', { allowEmpty: false });
      if (!V.isValidAmount(t.amount)) throw errors.validation('invalid transfer amount');
      const fromId = state.usersByHandle.get(fromHandle);
      const toId = state.usersByHandle.get(toHandle);
      if (!fromId || !toId) throw errors.notFound();
      if (fromHandle === toHandle) throw errors.selfPayment();
      resolved.push({
        from: state.users.get(fromId),
        to: state.users.get(toId),
        amount: t.amount,
        note: typeof t.note === 'string' ? t.note : '',
        visibility: t.visibility === 'private' ? 'private' : 'public',
      });
    }
    const net = new Map();
    for (const r of resolved) {
      net.set(r.from.id, (net.get(r.from.id) || 0) - r.amount);
      net.set(r.to.id, (net.get(r.to.id) || 0) + r.amount);
    }
    for (const [userId, delta] of net) {
      const user = state.users.get(userId);
      if (user.balance + delta < 0) throw errors.insufficientFunds();
    }
    const committedAt = nowIso();
    const settlementId = store.nextId('settlement');
    const paymentIds = [];
    const payments = [];
    for (const r of resolved) {
      r.from.balance -= r.amount;
      r.to.balance += r.amount;
      const id = store.nextId('payment');
      const payment = {
        payment_id: id,
        from_user_id: r.from.id,
        from_handle: r.from.handle,
        to_user_id: r.to.id,
        to_handle: r.to.handle,
        amount: r.amount,
        currency: state.currency,
        note: r.note,
        visibility: r.visibility,
        request_id: null,
        settlement_id: settlementId,
        created_at: committedAt,
      };
      state.payments.set(id, payment);
      paymentIds.push(id);
      payments.push(paymentPublic(payment));
    }
    const settlement = { settlement_id: settlementId, operator_id: ctx.user.id, committed_at: committedAt, payment_ids: paymentIds };
    state.settlements.set(settlementId, settlement);
    return { status: 201, body: { settlement_id: settlementId, committed_at: committedAt, payments } };
  });
}

module.exports = {
  signup,
  login,
  authenticate,
  me,
  testReset,
  testExport,
  testImport,
  createPayments,
  createRequest,
  payRequest,
  declineRequest,
  cancelRequest,
  listRequests,
  createSplit,
  listActivity,
  createSettlement,
  userPublic,
};
