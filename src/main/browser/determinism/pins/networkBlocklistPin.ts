import type { Pin } from '../DeterministicKernel';

export const networkBlocklistPin: Pin = {
  name: 'networkBlocklist',
  async apply({ tabId, config, capabilities }) {
    if (config.blockNetworkPatterns.length === 0) {
      return { name: 'networkBlocklist', revert: () => Promise.resolve() };
    }
    const blocker = await capabilities.registerRequestBlocker(tabId, config.blockNetworkPatterns);
    return {
      name: 'networkBlocklist',
      revert: () => {
        blocker.dispose();
        return Promise.resolve();
      },
    };
  },
};
