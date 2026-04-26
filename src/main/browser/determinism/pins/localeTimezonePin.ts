import type { Pin } from '../DeterministicKernel';

export const localeTimezonePin: Pin = {
  name: 'localeTimezone',
  async apply({ tabId, config, capabilities }) {
    const cdp = await capabilities.attachCdp(tabId);
    await cdp.send('Emulation.setLocaleOverride', { locale: config.locale });
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: config.timezone });
    if (config.reduceMotion) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
    }
    return {
      name: 'localeTimezone',
      revert: async () => {
        await cdp.send('Emulation.setLocaleOverride', { locale: '' });
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' });
        await cdp.send('Emulation.setEmulatedMedia', { features: [] });
      },
    };
  },
};
