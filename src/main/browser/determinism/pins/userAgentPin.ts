import type { Pin } from '../DeterministicKernel';

export const userAgentPin: Pin = {
  name: 'userAgent',
  async apply({ tabId, config, capabilities }) {
    if (!config.userAgent) {
      return { name: 'userAgent', revert: () => Promise.resolve() };
    }
    const previous = await capabilities.setUserAgent(tabId, config.userAgent);
    return {
      name: 'userAgent',
      revert: () => capabilities.restoreUserAgent(tabId, previous),
    };
  },
};
