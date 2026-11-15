const messages = {
  authentication_failed: 'Sign in to synchronize.',
  renewal_failed: 'Session renewal failed. Try Sync again.',
  trip_unavailable: 'The Trip could not be retrieved.',
  invalid_packet: 'The server returned an invalid TripPacket.',
  artifact_unavailable: 'A required offline artifact could not be retrieved.',
  artifact_version: 'A required artifact version did not match.',
  artifact_checksum: 'A required artifact checksum did not match.',
  artifact_verification: 'A required artifact could not be verified.',
  network_error: 'The connection was interrupted. Try Sync again.',
  timeout: 'Trip preparation timed out. Try Sync again.',
  local_read_failed: 'Saved Trip data could not be read.',
  commit_failed: 'The verified Trip could not be saved on this device.',
  adoption_failed: 'The saved Trip could not be displayed.',
  superseded: 'A newer selection or sync superseded this attempt.',
  cancelled: 'Synchronization was cancelled.',
  no_active_trip: 'No active local Trip.',
};

export const correlationId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : null;

export function responseCorrelation(response) {
  return { status: response.status, requestId: correlationId(response.headers.get('X-Request-ID')) };
}

export class SyncFailure extends Error {
  constructor(phase, category, code, { status = null, requestId = null } = {}) {
    super(messages[code]);
    this.phase = phase;
    this.category = category;
    this.code = code;
    this.status = status;
    this.requestId = correlationId(requestId);
  }

  summary() {
    const { phase, category, code, message, status, requestId } = this;
    return { phase, category, code, message, status, requestId };
  }
}

export function transportFailure(phase, error, signal) {
  if (error instanceof SyncFailure) return error;
  if (signal?.reason instanceof SyncFailure) return signal.reason;
  if (error?.name === 'TimeoutError') return new SyncFailure(phase, 'network', 'timeout');
  if (error?.name === 'AbortError') return new SyncFailure(phase, 'cancelled', 'cancelled');
  return new SyncFailure(phase, 'network', 'network_error');
}
