"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTargetDescriptor = buildTargetDescriptor;
exports.validateOperationOutcome = validateOperationOutcome;
exports.validateReplayPreflight = validateReplayPreflight;
exports.shouldAbortReplay = shouldAbortReplay;
exports.resolveReplayValidationMode = resolveReplayValidationMode;
exports.resolveReplayStrictness = resolveReplayStrictness;
exports.isReplaySupportedOperation = isReplaySupportedOperation;
const ids_1 = require("../../shared/utils/ids");
function isSupportedDeterministicKind(kind) {
    return kind === 'browser.navigate' || kind === 'browser.click' || kind === 'browser.type';
}
function createValidationResult(input) {
    return {
        phase: input.phase,
        status: input.status,
        summary: input.summary,
        evidenceUsed: input.evidenceUsed,
        expected: input.expected,
        observed: input.observed || {},
        validatedAt: Date.now(),
    };
}
function findFieldBySelector(forms, selector) {
    for (const form of forms) {
        const field = form.fields.find((item) => item.ref.selector === selector);
        if (field)
            return field;
    }
    return null;
}
function selectorExpected(selector) {
    return { selector };
}
function buildActionableDescriptor(operationKind, contextId, tabId, snapshot, selector, element) {
    return {
        id: (0, ids_1.generateId)('target'),
        kind: 'actionable-element',
        contextId,
        tabId,
        snapshotId: snapshot.id,
        operationKind,
        createdAt: Date.now(),
        evidence: {
            selector,
            text: element?.text || null,
            ariaLabel: element?.ariaLabel || null,
            role: element?.role || null,
            tagName: element?.tagName || null,
            href: element?.href || null,
            fieldKind: null,
            label: null,
            name: null,
            placeholder: null,
            boundingBox: element?.boundingBox || null,
            actionability: element?.actionability || [],
            confidence: element?.confidence ?? null,
            expectedUrl: null,
        },
    };
}
function buildFieldDescriptor(contextId, tabId, snapshot, selector, field) {
    return {
        id: (0, ids_1.generateId)('target'),
        kind: 'form-field',
        contextId,
        tabId,
        snapshotId: snapshot.id,
        operationKind: 'browser.type',
        createdAt: Date.now(),
        evidence: {
            selector,
            text: null,
            ariaLabel: null,
            role: null,
            tagName: null,
            href: null,
            fieldKind: field?.kind || null,
            label: field?.label || null,
            name: field?.name || null,
            placeholder: field?.placeholder || null,
            boundingBox: null,
            actionability: field ? ['typeable'] : [],
            confidence: field ? 1 : null,
            expectedUrl: null,
        },
    };
}
function buildNavigationDescriptor(contextId, tabId, url) {
    return {
        id: (0, ids_1.generateId)('target'),
        kind: 'navigation',
        contextId,
        tabId,
        snapshotId: null,
        operationKind: 'browser.navigate',
        createdAt: Date.now(),
        evidence: {
            selector: null,
            text: null,
            ariaLabel: null,
            role: null,
            tagName: null,
            href: null,
            fieldKind: null,
            label: null,
            name: null,
            placeholder: null,
            boundingBox: null,
            actionability: [],
            confidence: null,
            expectedUrl: url,
        },
    };
}
function scoreActionableCandidate(descriptor, element) {
    let score = 0;
    const evidence = [];
    if (descriptor.evidence.selector && element.ref.selector === descriptor.evidence.selector) {
        score += 100;
        evidence.push('selector');
    }
    if (descriptor.evidence.text && element.text === descriptor.evidence.text) {
        score += 35;
        evidence.push('text');
    }
    if (descriptor.evidence.ariaLabel && element.ariaLabel === descriptor.evidence.ariaLabel) {
        score += 25;
        evidence.push('aria-label');
    }
    if (descriptor.evidence.role && element.role === descriptor.evidence.role) {
        score += 10;
        evidence.push('role');
    }
    if (descriptor.evidence.tagName && element.tagName === descriptor.evidence.tagName) {
        score += 8;
        evidence.push('tag');
    }
    return { score, evidence };
}
function scoreFieldCandidate(descriptor, field) {
    let score = 0;
    const evidence = [];
    if (descriptor.evidence.selector && field.ref.selector === descriptor.evidence.selector) {
        score += 100;
        evidence.push('selector');
    }
    if (descriptor.evidence.label && field.label === descriptor.evidence.label) {
        score += 35;
        evidence.push('label');
    }
    if (descriptor.evidence.name && field.name === descriptor.evidence.name) {
        score += 25;
        evidence.push('name');
    }
    if (descriptor.evidence.placeholder && field.placeholder === descriptor.evidence.placeholder) {
        score += 20;
        evidence.push('placeholder');
    }
    if (descriptor.evidence.fieldKind && field.kind === descriptor.evidence.fieldKind) {
        score += 10;
        evidence.push('field-kind');
    }
    return { score, evidence };
}
async function resolveAgainstSnapshot(browser, descriptor) {
    const tabId = descriptor.tabId || browser.getState().activeTabId || null;
    if (!tabId) {
        return {
            status: 'missing',
            summary: 'No tab available for target resolution',
            evidenceUsed: [],
            observed: { tabId: null },
            resolvedSelector: null,
        };
    }
    const snapshot = await browser.captureTabSnapshot(tabId);
    if (descriptor.kind === 'form-field') {
        const fields = snapshot.forms.flatMap(form => form.fields);
        const scored = fields
            .map(field => ({ field, ...scoreFieldCandidate(descriptor, field) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score);
        if (scored.length === 0) {
            return {
                status: 'missing',
                summary: `Target field no longer resolves on ${snapshot.url}`,
                evidenceUsed: ['selector', 'label', 'name', 'placeholder'],
                observed: { url: snapshot.url, snapshotId: snapshot.id, selector: null },
                resolvedSelector: null,
            };
        }
        if (scored.length > 1 && scored[0].score === scored[1].score) {
            return {
                status: 'ambiguous',
                summary: `Target field resolves ambiguously on ${snapshot.url}`,
                evidenceUsed: scored[0].evidence,
                observed: { url: snapshot.url, snapshotId: snapshot.id, selector: scored[0].field.ref.selector },
                resolvedSelector: null,
            };
        }
        return {
            status: 'matched',
            summary: `Resolved field target on ${snapshot.url}`,
            evidenceUsed: scored[0].evidence,
            observed: { url: snapshot.url, snapshotId: snapshot.id, selector: scored[0].field.ref.selector },
            resolvedSelector: scored[0].field.ref.selector,
        };
    }
    const scored = snapshot.actionableElements
        .map(element => ({ element, ...scoreActionableCandidate(descriptor, element) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
    if (scored.length === 0) {
        return {
            status: 'missing',
            summary: `Target element no longer resolves on ${snapshot.url}`,
            evidenceUsed: ['selector', 'text', 'aria-label', 'role', 'tag'],
            observed: { url: snapshot.url, snapshotId: snapshot.id, selector: null },
            resolvedSelector: null,
        };
    }
    if (scored.length > 1 && scored[0].score === scored[1].score) {
        return {
            status: 'ambiguous',
            summary: `Target element resolves ambiguously on ${snapshot.url}`,
            evidenceUsed: scored[0].evidence,
            observed: { url: snapshot.url, snapshotId: snapshot.id, selector: scored[0].element.ref.selector },
            resolvedSelector: null,
        };
    }
    return {
        status: 'matched',
        summary: `Resolved element target on ${snapshot.url}`,
        evidenceUsed: scored[0].evidence,
        observed: { url: snapshot.url, snapshotId: snapshot.id, selector: scored[0].element.ref.selector },
        resolvedSelector: scored[0].element.ref.selector,
    };
}
async function buildTargetDescriptor(browser, input) {
    if (input.kind === 'browser.navigate') {
        const payload = input.payload;
        return {
            descriptor: buildNavigationDescriptor(input.contextId, input.tabId, payload.url),
            preflightValidation: createValidationResult({
                phase: 'preflight',
                status: 'matched',
                summary: `Navigation target recorded for ${payload.url}`,
                evidenceUsed: ['expected-url'],
                expected: { url: payload.url },
                observed: { url: browser.getState().navigation.url || null },
            }),
            resolvedSelector: null,
        };
    }
    const snapshot = await browser.captureTabSnapshot(input.tabId || undefined);
    if (input.kind === 'browser.click') {
        const payload = input.payload;
        const element = snapshot.actionableElements.find(item => item.ref.selector === payload.selector) || null;
        return {
            descriptor: buildActionableDescriptor(input.kind, input.contextId, input.tabId, snapshot, payload.selector, element),
            preflightValidation: createValidationResult({
                phase: 'preflight',
                status: element ? 'matched' : 'missing',
                summary: element
                    ? `Resolved click target in snapshot ${snapshot.id}`
                    : `Click target selector ${payload.selector} was not present in snapshot ${snapshot.id}`,
                evidenceUsed: ['selector'],
                expected: selectorExpected(payload.selector),
                observed: { snapshotId: snapshot.id, selector: element?.ref.selector || null, text: element?.text || null },
            }),
            resolvedSelector: element?.ref.selector || null,
        };
    }
    const payload = input.payload;
    const field = findFieldBySelector(snapshot.forms, payload.selector);
    return {
        descriptor: buildFieldDescriptor(input.contextId, input.tabId, snapshot, payload.selector, field),
        preflightValidation: createValidationResult({
            phase: 'preflight',
            status: field ? 'matched' : 'missing',
            summary: field
                ? `Resolved type target in snapshot ${snapshot.id}`
                : `Type target selector ${payload.selector} was not present in snapshot ${snapshot.id}`,
            evidenceUsed: ['selector'],
            expected: selectorExpected(payload.selector),
            observed: {
                snapshotId: snapshot.id,
                selector: field?.ref.selector || null,
                label: field?.label || null,
            },
        }),
        resolvedSelector: field?.ref.selector || null,
    };
}
async function validateOperationOutcome(browser, input, descriptor, result, preflightValidation) {
    if (input.kind === 'browser.navigate') {
        const observedUrl = typeof result.data.url === 'string'
            ? result.data.url
            : browser.getState().navigation.url || null;
        const expectedUrl = descriptor.evidence.expectedUrl;
        const matched = !!expectedUrl && observedUrl === expectedUrl;
        return createValidationResult({
            phase: 'postflight',
            status: matched ? 'matched' : 'failed',
            summary: matched
                ? `Navigation reached ${expectedUrl}`
                : `Navigation ended at ${observedUrl || 'unknown URL'} instead of ${expectedUrl || 'unknown URL'}`,
            evidenceUsed: ['expected-url', 'observed-url'],
            expected: { url: expectedUrl },
            observed: { url: observedUrl },
        });
    }
    if (input.kind === 'browser.click') {
        const clickResult = (result.data.result || null);
        if (!clickResult?.clicked) {
            return createValidationResult({
                phase: 'postflight',
                status: 'failed',
                summary: 'Click operation did not report success',
                evidenceUsed: ['operation-result'],
                expected: selectorExpected(descriptor.evidence.selector),
                observed: { clicked: false, method: clickResult?.method || null },
            });
        }
        return createValidationResult({
            phase: 'postflight',
            status: 'matched',
            summary: preflightValidation?.status === 'matched'
                ? `Clicked resolved target ${descriptor.evidence.selector || '(unknown selector)'}`
                : `Click succeeded for selector ${descriptor.evidence.selector || '(unknown selector)'} without strong snapshot evidence`,
            evidenceUsed: preflightValidation?.evidenceUsed?.length ? preflightValidation.evidenceUsed : ['selector'],
            expected: selectorExpected(descriptor.evidence.selector),
            observed: {
                clicked: true,
                method: clickResult.method || null,
                url: browser.getState().navigation.url || null,
            },
        });
    }
    const payload = input.payload;
    const forms = await browser.getFormModel(input.tabId || undefined);
    const field = findFieldBySelector(forms, descriptor.evidence.selector || '');
    const expectedValuePreview = payload.text.slice(0, 60);
    if (field) {
        const matched = field.valuePreview === expectedValuePreview;
        return createValidationResult({
            phase: 'postflight',
            status: matched ? 'matched' : 'failed',
            summary: matched
                ? `Typed value matched field preview for ${descriptor.evidence.selector || '(unknown selector)'}`
                : `Field preview did not match typed value for ${descriptor.evidence.selector || '(unknown selector)'}`,
            evidenceUsed: ['selector', 'form-value-preview'],
            expected: { selector: descriptor.evidence.selector, valuePreview: expectedValuePreview },
            observed: { selector: field.ref.selector, valuePreview: field.valuePreview },
        });
    }
    return createValidationResult({
        phase: 'postflight',
        status: 'matched',
        summary: `Type operation reported success for ${descriptor.evidence.selector || '(unknown selector)'}, but no form preview was available`,
        evidenceUsed: ['operation-result'],
        expected: { selector: descriptor.evidence.selector, valuePreview: expectedValuePreview },
        observed: { selector: descriptor.evidence.selector, valuePreview: null },
    });
}
async function validateReplayPreflight(browser, descriptor) {
    if (!descriptor) {
        return { validation: null, resolvedSelector: null };
    }
    if (descriptor.kind === 'navigation') {
        return {
            validation: createValidationResult({
                phase: 'preflight',
                status: 'matched',
                summary: `Replayable navigation target ${descriptor.evidence.expectedUrl || 'unknown URL'} is available`,
                evidenceUsed: ['expected-url'],
                expected: { url: descriptor.evidence.expectedUrl },
                observed: { url: browser.getState().navigation.url || null },
            }),
            resolvedSelector: null,
        };
    }
    const resolution = await resolveAgainstSnapshot(browser, descriptor);
    return {
        validation: createValidationResult({
            phase: 'preflight',
            status: resolution.status,
            summary: resolution.summary,
            evidenceUsed: resolution.evidenceUsed,
            expected: selectorExpected(descriptor.evidence.selector),
            observed: resolution.observed,
        }),
        resolvedSelector: resolution.resolvedSelector,
    };
}
function shouldAbortReplay(validation, strictness) {
    if (!validation)
        return false;
    if (strictness !== 'strict')
        return false;
    return validation.status !== 'matched';
}
function resolveReplayValidationMode(mode) {
    return mode === 'none' ? 'none' : 'basic';
}
function resolveReplayStrictness(strictness) {
    return strictness === 'best-effort' ? 'best-effort' : 'strict';
}
function isReplaySupportedOperation(kind) {
    return isSupportedDeterministicKind(kind);
}
//# sourceMappingURL=browserDeterministicExecution.js.map