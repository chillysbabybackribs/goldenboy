"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserAutomationToolPack = void 0;
exports.browserAutomationToolPack = {
    id: 'browser-automation',
    description: 'Interactive browser manipulation and form workflows.',
    baseline4: [
        'browser.get_state',
        'browser.get_tabs',
        'browser.close_tab',
        'browser.navigate',
    ],
    baseline6: [
        'browser.get_state',
        'browser.get_tabs',
        'browser.close_tab',
        'browser.navigate',
        'browser.click',
        'browser.type',
    ],
    tools: [
        'browser.get_state',
        'browser.get_tabs',
        'browser.navigate',
        'browser.create_tab',
        'browser.close_tab',
        'browser.activate_tab',
        'browser.find_element',
        'browser.click',
        'browser.type',
        'browser.wait_for',
        'browser.click_text',
        'browser.get_actionable_elements',
        'browser.capture_snapshot',
    ],
    relatedPackIds: ['research', 'browser-advanced'],
};
//# sourceMappingURL=browserAutomation.js.map