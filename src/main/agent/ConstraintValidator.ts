import {
  AgentToolName,
  AgentToolResult,
  ConstraintStatus,
  ConstraintVerdict,
  ResultValidation,
  ValidationStatus,
} from './AgentTypes';

// ---------------------------------------------------------------------------
// Constraint extraction & deterministic validation
//
// This module runs AFTER tool execution and BEFORE results return to the
// model. It attaches machine-readable validation verdicts that the model
// CANNOT override with probabilistic reasoning.
//
// Rule: a result is VALID only when every constraint is PASS.
// Any UNKNOWN / ESTIMATED / CONDITIONAL → INCOMPLETE.
// Any FAIL → INVALID.
// ---------------------------------------------------------------------------

export type TaskConstraint = {
  name: string;
  expected?: string;
  check: (result: AgentToolResult, input: unknown) => ConstraintVerdict;
};

// --- Deterministic checks ---------------------------------------------------

function checkExitCode(result: AgentToolResult): ConstraintVerdict {
  const exitCode = result.data.exitCode;
  if (exitCode === undefined || exitCode === null) {
    return {
      name: 'exit_code',
      status: 'UNKNOWN',
      observed: 'no exit code captured',
      expected: '0',
    };
  }
  if (result.data.timedOut === true) {
    return {
      name: 'exit_code',
      status: 'FAIL',
      observed: `command timed out`,
      expected: '0',
    };
  }
  return {
    name: 'exit_code',
    status: exitCode === 0 ? 'PASS' : 'FAIL',
    observed: `${exitCode}`,
    expected: '0',
  };
}

function checkOutputContainsError(result: AgentToolResult, input: unknown): ConstraintVerdict | null {
  const output = typeof result.data.output === 'string' ? result.data.output : '';
  if (!output) return null;

  const command = extractCommand(input);
  if (command && looksLikeReadOnlyInspectionCommand(command)) return null;

  const errorPatterns = [
    /(?:^|\n)\s*fatal:\s/i,
    /(?:^|\n)\s*error:\s/i,
    /\bfailed\b.*\bcreate\b/i,
    /\bcreate\b.*\bfailed\b/i,
    /\bpermission denied\b/i,
    /\bnot found\b/i,
    /\b403\b.*\bforbidden\b/i,
    /\b401\b.*\bunauthorized\b/i,
    /\b422\b/,
    /\brepository.*already.*exists\b/i,
    /\bcannot\b.*\bcreate\b/i,
  ];

  const matched = errorPatterns.filter(p => p.test(output));
  if (matched.length > 0) {
    return {
      name: 'output_error_signals',
      status: 'FAIL',
      observed: `output contains error signals: ${matched.map(p => p.source).join(', ')}`,
      expected: 'no error signals in output',
    };
  }
  return null;
}

function checkCreationVerb(result: AgentToolResult, input: unknown): ConstraintVerdict | null {
  const command = extractCommand(input);
  if (!command) return null;

  const isCreate = looksLikeCreateCommand(command);
  if (!isCreate) return null;

  const output = typeof result.data.output === 'string' ? result.data.output : '';

  if (/\balready exists\b/i.test(output)) {
    return {
      name: 'creation_verified',
      status: 'FAIL',
      observed: 'resource already exists — was not newly created',
      expected: 'new resource created',
    };
  }

  if (result.data.exitCode !== 0) {
    return {
      name: 'creation_verified',
      status: 'FAIL',
      observed: `create command exited with code ${result.data.exitCode}`,
      expected: 'exit code 0 for successful creation',
    };
  }

  // If exit code is 0 and no "already exists" signal, check for positive creation signals
  const createdSignals = [
    /\bcreated\b/i,
    /\binitialized\b/i,
    /\bsuccessfully\b/i,
    /\bdone\b/i,
  ];
  const hasPositiveSignal = createdSignals.some(p => p.test(output));

  if (!hasPositiveSignal && output.length > 0) {
    return {
      name: 'creation_verified',
      status: 'UNKNOWN',
      observed: 'command exited 0 but no explicit creation confirmation in output',
      expected: 'explicit creation confirmation',
    };
  }

  return {
    name: 'creation_verified',
    status: hasPositiveSignal ? 'PASS' : 'UNKNOWN',
    observed: hasPositiveSignal ? 'creation confirmed in output' : 'no output to verify',
    expected: 'explicit creation confirmation',
  };
}

function checkOwnershipFromGhOutput(result: AgentToolResult, input: unknown): ConstraintVerdict | null {
  const command = extractCommand(input);
  if (!command) return null;

  // Only applies to gh repo commands
  if (!/\bgh\s+repo\b/i.test(command)) return null;

  const output = typeof result.data.output === 'string' ? result.data.output : '';
  const url = typeof result.data.url === 'string' ? result.data.url : '';
  const observedUrl = url || extractUrlFromOutput(output);

  if (!observedUrl) {
    return {
      name: 'ownership_verified',
      status: 'UNKNOWN',
      observed: 'no repository URL found in output',
      expected: 'repository URL belonging to authenticated user',
    };
  }

  // We can't know the authenticated user from inside here, but we can flag
  // that ownership verification is REQUIRED. The model must NOT skip this.
  return {
    name: 'ownership_verified',
    status: 'CONDITIONAL',
    observed: `repository URL: ${observedUrl} — ownership must be verified against authenticated user`,
    expected: 'URL matches authenticated GitHub user/org',
  };
}

function checkBrowserNavigationTarget(result: AgentToolResult, input: unknown): ConstraintVerdict | null {
  const obj = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const requestedUrl = typeof obj.url === 'string' ? obj.url : null;
  if (!requestedUrl) return null;

  const actualUrl = typeof result.data.url === 'string' ? result.data.url : '';
  if (!actualUrl) {
    return {
      name: 'navigation_target',
      status: 'UNKNOWN',
      observed: 'no URL in navigation result',
      expected: requestedUrl,
    };
  }

  // Check if we landed where we expected (allowing for redirects within same domain)
  try {
    const requested = new URL(requestedUrl);
    const actual = new URL(actualUrl);
    if (requested.hostname === actual.hostname) {
      return {
        name: 'navigation_target',
        status: 'PASS',
        observed: actualUrl,
        expected: requestedUrl,
      };
    }
    return {
      name: 'navigation_target',
      status: 'FAIL',
      observed: `landed on ${actual.hostname} instead of ${requested.hostname}`,
      expected: requestedUrl,
    };
  } catch {
    return null;
  }
}

function checkResearchEvidenceSufficiency(result: AgentToolResult): ConstraintVerdict | null {
  const openedPages = result.data.openedPages;
  if (!Array.isArray(openedPages)) return null;

  const anyLikely = openedPages.some(
    (p: Record<string, unknown>) => p.answerLikely === true,
  );
  const allScores = openedPages
    .map((p: Record<string, unknown>) => typeof p.evidenceScore === 'number' ? p.evidenceScore : 0);
  const maxScore = allScores.length > 0 ? Math.max(...allScores) : 0;

  if (!anyLikely) {
    return {
      name: 'evidence_sufficiency',
      status: 'FAIL',
      observed: `no opened page has answerLikely=true, max evidence score: ${maxScore}`,
      expected: 'at least one page with sufficient evidence',
    };
  }

  return {
    name: 'evidence_sufficiency',
    status: 'PASS',
    observed: `evidence found, max score: ${maxScore}`,
    expected: 'sufficient evidence for answer',
  };
}

function checkBrowserCreateTab(result: AgentToolResult): ConstraintVerdict | null {
  const tab = result.data.tab;
  const tabs = result.data.tabs;
  if (!tab || typeof tab !== 'object' || !Array.isArray(tabs)) {
    return {
      name: 'tab_created',
      status: 'UNKNOWN',
      observed: 'create-tab result did not include post-action tab state',
      expected: 'created tab present in current tab list',
    };
  }

  const tabId = typeof (tab as Record<string, unknown>).id === 'string'
    ? (tab as Record<string, unknown>).id
    : '';
  const present = !!tabId && tabs.some((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).id === tabId);
  return {
    name: 'tab_created',
    status: present ? 'PASS' : 'FAIL',
    observed: present ? `tab ${tabId} present in tab list` : `tab ${tabId || '<missing>'} absent from tab list`,
    expected: 'new tab present in current tab list',
  };
}

function checkBrowserClosedTabs(result: AgentToolResult, input: unknown): ConstraintVerdict | null {
  const obj = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const requested = [
    ...(typeof obj.tabId === 'string' ? [obj.tabId] : []),
    ...(Array.isArray(obj.tabIds) ? obj.tabIds.filter((value): value is string => typeof value === 'string') : []),
  ];
  if (requested.length === 0) return null;

  const tabs = Array.isArray(result.data.tabs) ? result.data.tabs : null;
  if (!tabs) {
    return {
      name: 'tab_closed',
      status: 'UNKNOWN',
      observed: 'close-tab result did not include post-action tab state',
      expected: `tabs absent: ${requested.join(', ')}`,
    };
  }

  const survivors = requested.filter((tabId) =>
    tabs.some((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).id === tabId),
  );

  return {
    name: 'tab_closed',
    status: survivors.length === 0 ? 'PASS' : 'FAIL',
    observed: survivors.length === 0
      ? `requested tabs are absent: ${requested.join(', ')}`
      : `tabs still present after close: ${survivors.join(', ')}`,
    expected: `tabs absent: ${requested.join(', ')}`,
  };
}

function checkBrowserActivatedTab(result: AgentToolResult, input: unknown): ConstraintVerdict | null {
  const obj = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const requestedTabId = typeof obj.tabId === 'string' ? obj.tabId : null;
  if (!requestedTabId) return null;

  const activeTabId = typeof result.data.activeTabId === 'string' ? result.data.activeTabId : '';
  if (!activeTabId) {
    return {
      name: 'active_tab',
      status: 'UNKNOWN',
      observed: 'no activeTabId in activate-tab result',
      expected: requestedTabId,
    };
  }

  return {
    name: 'active_tab',
    status: activeTabId === requestedTabId ? 'PASS' : 'FAIL',
    observed: activeTabId,
    expected: requestedTabId,
  };
}

function checkBrowserNavigateTo(result: AgentToolResult): ConstraintVerdict | null {
  const actualUrl = typeof result.data.url === 'string' ? result.data.url : '';
  const normalizedUrl = typeof result.data.normalizedUrl === 'string' ? result.data.normalizedUrl : '';
  if (!actualUrl || !normalizedUrl) {
    return {
      name: 'navigation_target',
      status: 'UNKNOWN',
      observed: `actual=${actualUrl || '<missing>'}, normalized=${normalizedUrl || '<missing>'}`,
      expected: 'actual URL should match normalized target',
    };
  }

  try {
    const actual = new URL(actualUrl);
    const normalized = new URL(normalizedUrl);
    return {
      name: 'navigation_target',
      status: actual.hostname === normalized.hostname ? 'PASS' : 'FAIL',
      observed: actualUrl,
      expected: normalizedUrl,
    };
  } catch {
    return {
      name: 'navigation_target',
      status: 'UNKNOWN',
      observed: `actual=${actualUrl}, normalized=${normalizedUrl}`,
      expected: 'parseable URLs',
    };
  }
}

function checkBrowserElementState(result: AgentToolResult, input: unknown): ConstraintVerdict | null {
  const obj = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const selector = typeof obj.selector === 'string' ? obj.selector : null;
  if (!selector) return null;

  const resultObject = result.data.result;
  if (!resultObject || typeof resultObject !== 'object') {
    return {
      name: 'element_state_returned',
      status: 'UNKNOWN',
      observed: 'no result object in tool output',
      expected: `state object for selector ${selector}`,
    };
  }

  const returnedSelector = typeof (resultObject as Record<string, unknown>).selector === 'string'
    ? (resultObject as Record<string, unknown>).selector
    : '';
  const found = (resultObject as Record<string, unknown>).found;
  if (typeof found !== 'boolean') {
    return {
      name: 'element_state_returned',
      status: 'UNKNOWN',
      observed: 'result object missing boolean found field',
      expected: `state object for selector ${selector}`,
    };
  }

  return {
    name: 'element_state_returned',
    status: returnedSelector === selector ? 'PASS' : 'FAIL',
    observed: `selector=${returnedSelector || '<missing>'}, found=${found}`,
    expected: selector,
  };
}

function checkBrowserSelectOption(result: AgentToolResult, input: unknown): ConstraintVerdict[] {
  const obj = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const requestedValue = typeof obj.value === 'string' ? obj.value : null;
  const requestedLabel = typeof obj.label === 'string' ? obj.label : null;
  const requestedIndex = typeof obj.index === 'number' ? obj.index : null;
  const resultObject = result.data.result;

  if (!resultObject || typeof resultObject !== 'object') {
    return [{
      name: 'option_selected',
      status: 'UNKNOWN',
      observed: 'no result object in tool output',
      expected: 'selected state returned',
    }];
  }

  const selected = (resultObject as Record<string, unknown>).selected;
  const rawSelectedValue = (resultObject as Record<string, unknown>).selectedValue;
  const selectedValue = typeof rawSelectedValue === 'string'
    ? rawSelectedValue
    : null;
  const rawSelectedLabel = (resultObject as Record<string, unknown>).selectedLabel;
  const selectedLabel = typeof rawSelectedLabel === 'string'
    ? rawSelectedLabel
    : null;
  const selectedIndex = typeof (resultObject as Record<string, unknown>).selectedIndex === 'number'
    ? (resultObject as Record<string, unknown>).selectedIndex
    : null;

  const verdicts: ConstraintVerdict[] = [{
    name: 'option_selected',
    status: selected === true ? 'PASS' : 'FAIL',
    observed: `selected=${String(selected)}`,
    expected: 'selected=true',
  }];

  if (requestedValue !== null) {
    verdicts.push({
      name: 'selected_value',
      status: selectedValue === requestedValue ? 'PASS' : 'FAIL',
      observed: selectedValue ?? '<missing>',
      expected: requestedValue,
    });
  } else if (requestedLabel !== null) {
    verdicts.push({
      name: 'selected_label',
      status: selectedLabel === requestedLabel ? 'PASS' : 'FAIL',
      observed: selectedLabel ?? '<missing>',
      expected: requestedLabel,
    });
  } else if (requestedIndex !== null) {
    verdicts.push({
      name: 'selected_index',
      status: selectedIndex === requestedIndex ? 'PASS' : 'FAIL',
      observed: selectedIndex === null ? '<missing>' : `${selectedIndex}`,
      expected: `${requestedIndex}`,
    });
  }

  return verdicts;
}

// --- Helpers ----------------------------------------------------------------

function extractCommand(input: unknown): string | null {
  if (typeof input === 'string') return input;
  const obj = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  return typeof obj.command === 'string' ? obj.command : null;
}

function looksLikeReadOnlyInspectionCommand(command: string): boolean {
  return /^\s*(?:rg|grep|sed|cat|head|tail|less|more|nl|awk|cut|sort|uniq|wc|find|ls|tree|pwd|which|whereis|git\s+(?:status|show|diff|log|branch)|stat)\b/i.test(command);
}

function looksLikeCreateCommand(command: string): boolean {
  return /\b(?:create|new|init|mkdir|touch)\b/i.test(command)
    || /\b(?:gh\s+repo\s+create|npm\s+init|pnpm\s+create|yarn\s+create)\b/i.test(command);
}

function extractUrlFromOutput(output: string): string | null {
  const match = output.match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
}

// --- Classification ---------------------------------------------------------

function classifyResult(constraints: ConstraintVerdict[]): ValidationStatus {
  if (constraints.length === 0) return 'VALID';

  const hasFail = constraints.some(c => c.status === 'FAIL');
  if (hasFail) return 'INVALID';

  const hasUncertain = constraints.some(
    c => c.status === 'UNKNOWN' || c.status === 'ESTIMATED' || c.status === 'CONDITIONAL',
  );
  if (hasUncertain) return 'INCOMPLETE';

  return 'VALID';
}

function buildValidationSummary(status: ValidationStatus, constraints: ConstraintVerdict[]): string {
  if (status === 'VALID') return 'All constraints passed.';

  const failing = constraints.filter(c => c.status !== 'PASS');
  const parts = failing.map(c => `${c.name}: ${c.status} — ${c.observed}`);
  const prefix = status === 'INVALID'
    ? 'VALIDATION FAILED'
    : 'VALIDATION INCOMPLETE — cannot confirm success';
  return `${prefix}. ${parts.join('; ')}`;
}

// --- Tool-specific constraint sets ------------------------------------------

type ConstraintExtractor = (result: AgentToolResult, input: unknown) => ConstraintVerdict[];

const TERMINAL_EXEC_CONSTRAINTS: ConstraintExtractor = (result, input) => {
  const verdicts: ConstraintVerdict[] = [];
  verdicts.push(checkExitCode(result));

  const errorCheck = checkOutputContainsError(result, input);
  if (errorCheck) verdicts.push(errorCheck);

  const createCheck = checkCreationVerb(result, input);
  if (createCheck) verdicts.push(createCheck);

  const ownerCheck = checkOwnershipFromGhOutput(result, input);
  if (ownerCheck) verdicts.push(ownerCheck);

  return verdicts;
};

const BROWSER_NAVIGATE_CONSTRAINTS: ConstraintExtractor = (result, input) => {
  const verdicts: ConstraintVerdict[] = [];
  const obj = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  if (obj.normalize === true) {
    const normalizedCheck = checkBrowserNavigateTo(result);
    if (normalizedCheck) verdicts.push(normalizedCheck);
    return verdicts;
  }
  const navCheck = checkBrowserNavigationTarget(result, input);
  if (navCheck) verdicts.push(navCheck);
  return verdicts;
};

const RESEARCH_SEARCH_CONSTRAINTS: ConstraintExtractor = (result, _input) => {
  const verdicts: ConstraintVerdict[] = [];

  const evidenceCheck = checkResearchEvidenceSufficiency(result);
  if (evidenceCheck) verdicts.push(evidenceCheck);

  return verdicts;
};

const BROWSER_CREATE_TAB_CONSTRAINTS: ConstraintExtractor = (result, _input) => {
  const verdicts: ConstraintVerdict[] = [];
  const createCheck = checkBrowserCreateTab(result);
  if (createCheck) verdicts.push(createCheck);
  return verdicts;
};

const BROWSER_CLOSE_TAB_CONSTRAINTS: ConstraintExtractor = (result, input) => {
  const verdicts: ConstraintVerdict[] = [];
  const closeCheck = checkBrowserClosedTabs(result, input);
  if (closeCheck) verdicts.push(closeCheck);
  return verdicts;
};

const BROWSER_ACTIVATE_TAB_CONSTRAINTS: ConstraintExtractor = (result, input) => {
  const verdicts: ConstraintVerdict[] = [];
  const activateCheck = checkBrowserActivatedTab(result, input);
  if (activateCheck) verdicts.push(activateCheck);
  return verdicts;
};

const BROWSER_GET_ELEMENT_STATE_CONSTRAINTS: ConstraintExtractor = (result, input) => {
  const verdicts: ConstraintVerdict[] = [];
  const stateCheck = checkBrowserElementState(result, input);
  if (stateCheck) verdicts.push(stateCheck);
  return verdicts;
};

const BROWSER_SELECT_OPTION_CONSTRAINTS: ConstraintExtractor = (result, input) => {
  return checkBrowserSelectOption(result, input);
};

// Map tool names to their constraint extractors
const TOOL_CONSTRAINTS = new Map<AgentToolName, ConstraintExtractor>([
  ['terminal.exec', TERMINAL_EXEC_CONSTRAINTS],
  ['browser.navigate', BROWSER_NAVIGATE_CONSTRAINTS],
  ['browser.research_search', RESEARCH_SEARCH_CONSTRAINTS],
  ['browser.create_tab', BROWSER_CREATE_TAB_CONSTRAINTS],
  ['browser.close_tab', BROWSER_CLOSE_TAB_CONSTRAINTS],
  ['browser.activate_tab', BROWSER_ACTIVATE_TAB_CONSTRAINTS],
  ['browser.get_element_state', BROWSER_GET_ELEMENT_STATE_CONSTRAINTS],
  ['browser.select_option', BROWSER_SELECT_OPTION_CONSTRAINTS],
]);

// --- Public API -------------------------------------------------------------

export function validateToolResult(
  toolName: AgentToolName,
  result: AgentToolResult,
  input: unknown,
): ResultValidation | null {
  const extractor = TOOL_CONSTRAINTS.get(toolName);
  if (!extractor) return null;

  const constraints = extractor(result, input);
  if (constraints.length === 0) return null;

  const status = classifyResult(constraints);
  const summary = buildValidationSummary(status, constraints);

  return { status, constraints, summary };
}

export function formatValidationForModel(validation: ResultValidation): string {
  const lines = [
    '',
    '--- RUNTIME VALIDATION (deterministic — do not override) ---',
    `STATUS: ${validation.status}`,
  ];

  for (const c of validation.constraints) {
    lines.push(`  [${c.status}] ${c.name}: observed=${c.observed}${c.expected ? ` expected=${c.expected}` : ''}`);
  }

  lines.push(`VERDICT: ${validation.summary}`);

  if (validation.status === 'INVALID') {
    lines.push('ACTION REQUIRED: This result has failed deterministic validation. Do NOT claim this task succeeded. Report the failure to the user and explain what went wrong.');
  } else if (validation.status === 'INCOMPLETE') {
    lines.push('ACTION REQUIRED: This result has unverified constraints. You MUST perform follow-up verification before claiming success. If verification is not possible, report what could not be confirmed.');
  }

  lines.push('--- END RUNTIME VALIDATION ---');
  return lines.join('\n');
}
