import type { Pin } from '../DeterministicKernel';

const ANIMATIONS_OFF_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
`.trim();

export const visualPin: Pin = {
  name: 'visual',
  async apply({ tabId, config, capabilities }) {
    if (!config.disableAnimations && !config.reduceMotion) {
      return { name: 'visual', revert: () => Promise.resolve() };
    }
    if (config.disableAnimations) {
      const key = await capabilities.insertCss(tabId, ANIMATIONS_OFF_CSS);
      return {
        name: 'visual',
        revert: () => capabilities.removeInsertedCss(tabId, key),
      };
    }
    return { name: 'visual', revert: () => Promise.resolve() };
  },
};
