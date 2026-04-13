import type { ToolPackManifest } from './types';

export const browserAutomationToolPack: ToolPackManifest = {
  id: 'browser-automation',
  description: 'Interactive browser manipulation and form workflows.',
  tools: [
    'browser.navigate',
    'browser.get_state',
    'browser.find_element',
    'browser.click',
    'browser.type',
    'browser.wait_for',
    'browser.click_text',
    'browser.get_actionable_elements',
    'browser.capture_snapshot',
  ],
  relatedPackIds: ['research'],
};
