"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const jsdom_1 = require("jsdom");
const live_run_1 = require("./live-run");
(0, vitest_1.describe)('live run chat ordering', () => {
    let dom;
    let container;
    let updateLastAgentResponseText;
    (0, vitest_1.beforeEach)(() => {
        dom = new jsdom_1.JSDOM('<!doctype html><html><body><div id="chat"></div></body></html>', {
            pretendToBeVisual: true,
        });
        Object.assign(globalThis, {
            window: dom.window,
            document: dom.window.document,
            HTMLElement: dom.window.HTMLElement,
        });
        container = dom.window.document.getElementById('chat');
        updateLastAgentResponseText = vitest_1.vi.fn();
    });
    (0, vitest_1.afterEach)(() => {
        dom.window.close();
    });
    (0, vitest_1.it)('renders assistant text before the live tool panel', () => {
        const card = (0, live_run_1.createLiveRunCard)('task-live-order', 'provider', container, {
            renderMarkdown: (text) => `<p>${text}</p>`,
            updateLastAgentResponseText,
            scheduleChatScrollToBottom: () => { },
            disableChatAutoPin: () => { },
        }, 'Check the adapter');
        const userPrompt = dom.window.document.createElement('div');
        userPrompt.className = 'chat-msg chat-msg-user';
        userPrompt.textContent = 'Check the adapter';
        container.insertBefore(userPrompt, card.root);
        (0, live_run_1.appendThought)('task-live-order', 'Now I’m pulling the adapter requirements.');
        (0, live_run_1.appendToolStatus)('task-live-order', 'tool-start:Open Best Buy product page');
        const root = container.querySelector('[data-task-id="task-live-order"]');
        const output = root.querySelector('.chat-msg-text');
        const panel = root.querySelector('.chat-live-panel');
        (0, vitest_1.expect)(container.querySelector('.chat-live-prompt')).toBeNull();
        (0, vitest_1.expect)(container.firstElementChild).toBe(userPrompt);
        (0, vitest_1.expect)(output.nextElementSibling).toBe(panel);
        (0, vitest_1.expect)(panel.previousElementSibling).toBe(output);
    });
    (0, vitest_1.it)('shows a thinking placeholder before any streamed content arrives', () => {
        (0, live_run_1.createLiveRunCard)('task-thinking-placeholder', 'provider', container, {
            renderMarkdown: (text) => `<p>${text}</p>`,
            updateLastAgentResponseText,
            scheduleChatScrollToBottom: () => { },
            disableChatAutoPin: () => { },
        });
        const output = container.querySelector('[data-task-id="task-thinking-placeholder"] .chat-msg-text');
        (0, vitest_1.expect)(output.textContent).toBe('Thinking...');
        (0, vitest_1.expect)(output.classList.contains('chat-live-status-text')).toBe(true);
    });
    (0, vitest_1.it)('appends thoughts and tool cards in strict chronological order under the user bubble', () => {
        const userPrompt = dom.window.document.createElement('div');
        userPrompt.className = 'chat-msg chat-msg-user';
        userPrompt.textContent = 'Run the task';
        container.appendChild(userPrompt);
        (0, live_run_1.createLiveRunCard)('task-ordered-stream', 'provider', container, {
            renderMarkdown: (text) => `<p>${text}</p>`,
            updateLastAgentResponseText,
            scheduleChatScrollToBottom: () => { },
            disableChatAutoPin: () => { },
        });
        (0, live_run_1.appendThought)('task-ordered-stream', 'Inspecting the code path.');
        (0, live_run_1.appendToolStatus)('task-ordered-stream', 'tool-start:Open live renderer');
        (0, live_run_1.appendToolStatus)('task-ordered-stream', 'tool-done:Open live renderer');
        (0, live_run_1.appendThought)('task-ordered-stream', 'Applying the UI patch.');
        const root = container.querySelector('[data-task-id="task-ordered-stream"]');
        const output = root.querySelector('.chat-msg-text');
        const panel = root.querySelector('.chat-live-panel');
        const entries = Array.from(root.querySelectorAll('.chat-stream > *')).map((el) => el.textContent?.trim());
        (0, vitest_1.expect)(container.firstElementChild).toBe(userPrompt);
        (0, vitest_1.expect)(output.textContent).toBe('');
        (0, vitest_1.expect)(panel.classList.contains('chat-live-panel-empty')).toBe(false);
        (0, vitest_1.expect)(entries).toEqual([
            'Inspecting the code path.',
            'Open live renderer',
            'Applying the UI patch.',
        ]);
    });
    (0, vitest_1.it)('keeps the collapsed process block above the final response', () => {
        const card = (0, live_run_1.createLiveRunCard)('task-final-order', 'provider', container, {
            renderMarkdown: (text) => `<p>${text}</p>`,
            updateLastAgentResponseText,
            scheduleChatScrollToBottom: () => { },
            disableChatAutoPin: () => { },
        });
        (0, live_run_1.appendThought)('task-final-order', 'Checking the port and OS requirements.');
        (0, live_run_1.appendToolStatus)('task-final-order', 'tool-start:Load compatibility details');
        (0, live_run_1.appendToolStatus)('task-final-order', 'tool-done:Load compatibility details');
        (0, live_run_1.replaceWithResult)('task-final-order', {
            success: true,
            output: 'The adapter needs a USB 3.0 data port and DisplayLink drivers.',
        });
        const root = container.querySelector('[data-task-id="task-final-order"]');
        const outputNodes = root.querySelectorAll('.chat-msg-text');
        const response = outputNodes[outputNodes.length - 1];
        const details = root.querySelector('.chat-process-details');
        (0, vitest_1.expect)(details.nextElementSibling).toBe(response);
        (0, vitest_1.expect)(response.previousElementSibling).toBe(details);
        (0, vitest_1.expect)(details.open).toBe(false);
    });
    (0, vitest_1.it)('retracts the live process block before streaming the final answer under it', () => {
        (0, live_run_1.createLiveRunCard)('task-live-retract', 'provider', container, {
            renderMarkdown: (text) => `<p>${text}</p>`,
            updateLastAgentResponseText,
            scheduleChatScrollToBottom: () => { },
            disableChatAutoPin: () => { },
        });
        (0, live_run_1.appendThought)('task-live-retract', 'Checking the current renderer order.');
        (0, live_run_1.appendToolStatus)('task-live-retract', 'tool-start:Inspect live response slot');
        (0, live_run_1.appendToolStatus)('task-live-retract', 'tool-done:Inspect live response slot');
        (0, live_run_1.appendToken)('task-live-retract', 'The response should render below the tool summary.');
        const root = container.querySelector('[data-task-id=\"task-live-retract\"]');
        const panel = root.querySelector('.chat-live-panel');
        const details = root.querySelector('.chat-live-process-details');
        const response = root.querySelector('[data-live-role=\"response\"]');
        (0, vitest_1.expect)(details).not.toBeNull();
        (0, vitest_1.expect)(details.open).toBe(false);
        (0, vitest_1.expect)(panel.classList.contains('chat-live-panel-retracted')).toBe(true);
        (0, vitest_1.expect)(panel.nextElementSibling).toBe(response);
        (0, vitest_1.expect)(response.textContent).toContain('The response should render below the tool summary.');
    });
    (0, vitest_1.it)('renders live errors without relying on a legacy meta header', () => {
        (0, live_run_1.createLiveRunCard)('task-live-error', 'provider', container, {
            renderMarkdown: (text) => `<p>${text}</p>`,
            updateLastAgentResponseText,
            scheduleChatScrollToBottom: () => { },
            disableChatAutoPin: () => { },
        });
        (0, live_run_1.replaceWithError)('task-live-error', 'Something failed');
        const root = container.querySelector('[data-task-id=\"task-live-error\"]');
        const error = root.querySelector('.chat-msg-error');
        (0, vitest_1.expect)(error).not.toBeNull();
        (0, vitest_1.expect)(error.textContent).toBe('Something failed');
        (0, vitest_1.expect)(root.querySelector('.chat-live-panel')).toBeNull();
    });
    (0, vitest_1.it)('streams generic progress prose into the live panel', () => {
        (0, live_run_1.createLiveRunCard)('task-neutral-status', 'provider', container, {
            renderMarkdown: (text) => `<p>${text}</p>`,
            updateLastAgentResponseText,
            scheduleChatScrollToBottom: () => { },
            disableChatAutoPin: () => { },
        });
        (0, live_run_1.appendThought)('task-neutral-status', 'I am checking the prompt-construction path now.');
        const root = container.querySelector('[data-task-id="task-neutral-status"]');
        const output = container.querySelector('[data-task-id="task-neutral-status"] .chat-msg-text');
        const entries = Array.from(root.querySelectorAll('.chat-stream > *')).map((el) => el.textContent?.trim());
        (0, vitest_1.expect)(output.textContent).toBe('');
        (0, vitest_1.expect)(entries).toEqual(['I am checking the prompt-construction path now.']);
    });
    (0, vitest_1.it)('streams blocker-style questions and clears migrated interim output from copy state', () => {
        (0, live_run_1.createLiveRunCard)('task-user-facing-status', 'provider', container, {
            renderMarkdown: (text) => `<p>${text}</p>`,
            updateLastAgentResponseText,
            scheduleChatScrollToBottom: () => { },
            disableChatAutoPin: () => { },
        });
        (0, live_run_1.appendThought)('task-user-facing-status', 'Which branch should I use?');
        let root = container.querySelector('[data-task-id="task-user-facing-status"]');
        let output = container.querySelector('[data-task-id="task-user-facing-status"] .chat-msg-text');
        let entries = Array.from(root.querySelectorAll('.chat-stream > *')).map((el) => el.textContent?.trim());
        (0, vitest_1.expect)(output.textContent).toBe('');
        (0, vitest_1.expect)(entries).toEqual(['Which branch should I use?']);
        (0, live_run_1.appendToken)('task-user-facing-status', 'I am checking the terminal path now.');
        (0, vitest_1.expect)(updateLastAgentResponseText).toHaveBeenLastCalledWith('I am checking the terminal path now.');
        (0, live_run_1.migrateBufferedOutputToThoughts)('task-user-facing-status');
        root = container.querySelector('[data-task-id="task-user-facing-status"]');
        output = container.querySelector('[data-task-id="task-user-facing-status"] .chat-msg-text');
        entries = Array.from(root.querySelectorAll('.chat-stream > *')).map((el) => el.textContent?.trim());
        (0, vitest_1.expect)(output.textContent).toBe('');
        (0, vitest_1.expect)(entries).toEqual(['Which branch should I use?', 'I am checking the terminal path now.']);
        (0, vitest_1.expect)(updateLastAgentResponseText).toHaveBeenLastCalledWith('');
    });
    (0, vitest_1.it)('keeps earlier chat rows visible while a live response streams', () => {
        const priorMessage = dom.window.document.createElement('div');
        priorMessage.className = 'chat-msg chat-msg-user';
        priorMessage.textContent = 'Original prompt';
        container.appendChild(priorMessage);
        (0, live_run_1.createLiveRunCard)('task-keeps-history', 'provider', container, {
            renderMarkdown: (text) => `<p>${text}</p>`,
            updateLastAgentResponseText,
            scheduleChatScrollToBottom: () => { },
            disableChatAutoPin: () => { },
        });
        (0, live_run_1.appendToken)('task-keeps-history', 'Streaming reply');
        (0, vitest_1.expect)(priorMessage.isConnected).toBe(true);
        (0, vitest_1.expect)(priorMessage.classList.contains('chat-msg-archived')).toBe(false);
        (0, vitest_1.expect)(container.children).toHaveLength(2);
    });
});
//# sourceMappingURL=live-run.test.js.map