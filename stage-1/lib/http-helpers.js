'use strict';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function err(status, code, message) {
  return new ApiError(status, code, message);
}

const errors = {
  malformed: (msg) => err(400, 'malformed_request', msg || 'malformed request body'),
  missingKey: () => err(400, 'missing_idempotency_key', 'Idempotency-Key header is required'),
  unauthenticated: () => err(401, 'unauthenticated', 'missing, malformed or unknown bearer token'),
  forbidden: () => err(403, 'forbidden', 'not permitted to access this resource'),
  notFound: () => err(404, 'not_found', 'no such resource'),
  keyReuse: () => err(409, 'idempotency_key_reuse', 'idempotency key already used with a different request body'),
  insufficientFunds: () => err(409, 'insufficient_funds', 'balance is below the requested amount'),
  emailTaken: () => err(409, 'email_taken', 'email already registered'),
  handleTaken: () => err(409, 'handle_taken', 'derived handle already in use'),
  requestNotPending: () => err(409, 'request_not_pending', 'request is not pending'),
  authNotOpen: () => err(409, 'authorization_not_open', 'authorization is not open'),
  validation: (msg) => err(422, 'validation_failed', msg || 'a stated rule was violated'),
  selfPayment: () => err(422, 'self_payment', 'cannot pay yourself'),
  selfRequest: () => err(422, 'self_request', 'cannot request from yourself'),
};

module.exports = { ApiError, err, errors };
