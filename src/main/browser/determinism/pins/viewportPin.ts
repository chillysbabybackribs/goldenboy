import type { Pin } from '../DeterministicKernel';

export const viewportPin: Pin = {
  name: 'viewport',
  async apply({ tabId, config, capabilities }) {
    await capabilities.setViewport(tabId, config.viewport);
    return {
      name: 'viewport',
      revert: () => capabilities.clearViewport(tabId),
    };
  },
};
