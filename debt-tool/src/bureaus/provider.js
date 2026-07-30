import { config } from '../config.js';

/**
 * Contract every credit bureau adapter implements.
 *
 * Adding a bureau means subclassing this and registering it in ./index.js —
 * nothing above this layer knows which bureau supplied a balance.
 *
 * fetchCreditProfile() returns the provider's raw payload (kept verbatim on the
 * snapshot for dispute resolution) and normalise() turns it into:
 *
 *   {
 *     reference:   string | null   — the bureau's enquiry reference
 *     creditScore: number | null
 *     scoreBand:   string | null
 *     accounts:    CanonicalAccount[]   (see normaliseAccount)
 *     enquiries:   [{ date, subscriber, reason }]
 *     publicRecords: [{ type, date, amount, court, caseNumber }]
 *   }
 */
export class BureauProvider {
  /** Machine name, also the value stored on bureau_snapshots.provider. */
  static id = 'abstract';
  /** Shown to staff. */
  static label = 'Abstract provider';
  /** True when this provider fabricates data (drives the "SIMULATED" badge). */
  static isSimulated = false;

  constructor(settings = {}) {
    this.settings = settings;
  }

  get id() {
    return this.constructor.id;
  }

  get label() {
    return this.constructor.label;
  }

  get isSimulated() {
    return this.constructor.isSimulated;
  }

  /**
   * Whether this provider has everything it needs to run. The registry uses this
   * to decide what to offer staff, so a half-configured bureau is never selectable.
   */
  isConfigured() {
    return false;
  }

  /** Human-readable reason isConfigured() is false, for the settings screen. */
  configurationHint() {
    return 'Not configured.';
  }

  /**
   * @param {{idNumber: string, firstName: string, lastName: string, dateOfBirth?: string, reference: string}} subject
   * @returns {Promise<object>} the provider's raw response
   */
  async fetchCreditProfile() {
    throw new Error(`${this.id}: fetchCreditProfile() not implemented`);
  }

  /** @param {object} raw @returns {object} the canonical profile described above */
  normalise() {
    throw new Error(`${this.id}: normalise() not implemented`);
  }
}

/**
 * fetch() with a timeout and a uniform error shape. Bureau endpoints are slow
 * and occasionally hang; a consultant sitting with a client needs a clear
 * failure inside twenty seconds rather than a spinner that never resolves.
 */
export async function bureauFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? config.bureau.timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) {
      throw new BureauError(
        `Bureau responded ${response.status} ${response.statusText}`,
        { status: response.status, body: body.slice(0, 2000) },
      );
    }
    return { body, response };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new BureauError('Bureau request timed out', { cause: 'timeout' });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export class BureauError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'BureauError';
    this.detail = detail;
  }
}

export function parseJsonBody(body, providerId) {
  try {
    return JSON.parse(body);
  } catch {
    throw new BureauError(`${providerId}: response was not valid JSON`, { body: String(body).slice(0, 500) });
  }
}
