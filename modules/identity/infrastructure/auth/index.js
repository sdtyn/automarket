const localProvider = require('./local-provider');
const xsuaaProvider = require('./xsuaa-provider');
const guestTokenProvider = require('./guest-token-provider');

// AUTH_PROVIDER env var selects the active provider at startup.
// Defaults to 'local' so development works out of the box without any config.
// Valid values: 'local' | 'xsuaa' | 'guest'
// This is the only place in the codebase that knows which provider is active —
// all business logic imports from this file, never from a specific provider directly.
const providers = {
  local: localProvider,
  xsuaa: xsuaaProvider,
  guest: guestTokenProvider,
};

const activeProviderKey = process.env.AUTH_PROVIDER ?? 'local';
const authProvider = providers[activeProviderKey];

if (!authProvider) {
  throw new Error(
    `Unknown AUTH_PROVIDER: "${activeProviderKey}". Valid values: local, xsuaa, guest`
  );
}

module.exports = authProvider;
