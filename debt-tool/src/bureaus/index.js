import { config } from '../config.js';
import { TransUnionProvider } from './transunion.js';
import { ExperianProvider } from './experian.js';
import { XdsProvider } from './xds.js';
import { MockProvider } from './mock.js';

/**
 * Provider registry. Everything above this file asks for a provider by id and
 * gets an object satisfying BureauProvider — swapping bureaus is a config change.
 */
const providers = new Map();

function register(instance) {
  providers.set(instance.id, instance);
}

register(new TransUnionProvider(config.bureau.transunion));
register(new ExperianProvider(config.bureau.experian));
register(new XdsProvider(config.bureau.xds));
register(new MockProvider());

export function getProvider(id) {
  const provider = providers.get(id);
  if (!provider) throw new Error(`Unknown bureau provider: ${id}`);
  if (provider.isSimulated && !config.bureau.allowMock) {
    throw new Error('The simulated bureau is disabled on this instance (BUREAU_ALLOW_MOCK=false).');
  }
  if (!provider.isConfigured()) {
    throw new Error(`${provider.label} is not configured. ${provider.configurationHint()}`);
  }
  return provider;
}

/** Every provider with its readiness, for the settings screen and the pull form. */
export function listProviders() {
  return [...providers.values()]
    .filter((p) => !p.isSimulated || config.bureau.allowMock)
    .map((p) => ({
      id: p.id,
      label: p.label,
      isSimulated: p.isSimulated,
      configured: p.isConfigured(),
      hint: p.configurationHint(),
    }));
}

/** Providers a consultant can actually run an enquiry against right now. */
export function listAvailableProviders() {
  return listProviders().filter((p) => p.configured);
}

/**
 * The provider used when staff do not pick one. Falls back to the first
 * configured live bureau if the configured default is unusable, and only then
 * to the mock — so a typo in BUREAU_DEFAULT degrades to a real bureau, not a fake one.
 */
export function defaultProviderId() {
  const available = listAvailableProviders();
  if (available.some((p) => p.id === config.bureau.default)) return config.bureau.default;
  const live = available.find((p) => !p.isSimulated);
  if (live) return live.id;
  return available[0]?.id ?? null;
}
