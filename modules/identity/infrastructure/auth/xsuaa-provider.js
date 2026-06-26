// Stub for the BTP/XSUAA authentication provider.
// XSUAA handles token verification at the Approuter level — by the time a
// request reaches a CAP handler, req.user is already populated by the XSUAA
// middleware. This provider exists to satisfy the interface and will be
// implemented when BTP deployment is set up (EPIC01-T6 revisit).
const xsuaaProvider = {
  async authenticate() {
    throw new Error('XSUAA provider is not implemented yet. Deferred to BTP sprint.');
  },

  issueToken() {
    throw new Error('XSUAA provider is not implemented yet. Deferred to BTP sprint.');
  },

  verify() {
    throw new Error('XSUAA provider is not implemented yet. Deferred to BTP sprint.');
  },
};

module.exports = xsuaaProvider;
