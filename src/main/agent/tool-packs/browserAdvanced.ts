import type { ToolPackManifest } from './types';

export const browserAdvancedToolPack: ToolPackManifest = {
  id: 'browser-advanced',
  description: 'Advanced browser workflows: uploads, downloads, dialogs, diagnostics, and semantic intent execution.',
  tools: [
    'browser.back',
    'browser.forward',
    'browser.reload',
    'browser.upload_file',
    'browser.download_link',
    'browser.download_url',
    'browser.get_downloads',
    'browser.wait_for_download',
    'browser.drag',
    'browser.hover',
    'browser.hit_test',
    'browser.evaluate_js',
    'browser.get_console_events',
    'browser.get_network_events',
    'browser.get_dialogs',
    'browser.accept_dialog',
    'browser.dismiss_dialog',
    'browser.run_intent_program',
    'browser.capture_snapshot',
  ],
  relatedPackIds: ['browser-automation', 'research', 'debug'],
};
