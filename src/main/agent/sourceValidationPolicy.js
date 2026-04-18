"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRICT_SOURCE_VALIDATION_PROTOCOL = exports.PHYSICAL_TASK_COMPLETION_PROTOCOL = exports.DETERMINISTIC_VALIDATION_OVERRIDE_RULE = exports.CONSTRAINT_LEDGER_PROTOCOL = exports.ALWAYS_ON_SOURCE_VALIDATION_RULE = void 0;
exports.shouldUseStrictSourceValidation = shouldUseStrictSourceValidation;
exports.ALWAYS_ON_SOURCE_VALIDATION_RULE = [
    'For factual, current, technical, legal, medical, financial, or decision-impacting claims, use authoritative sources where feasible, distinguish verified facts from inference, and never fabricate citations, dates, quotes, capabilities, laws, APIs, prices, or numeric values.',
    'If a concrete answer cannot be verified after reasonable effort, say so directly and briefly state what was checked.',
].join('\n');
exports.CONSTRAINT_LEDGER_PROTOCOL = [
    'For every task, extract all explicit user constraints into an active constraint list before acting. Treat this list as the single source of truth for the task.',
    '',
    'Constraints include required outputs, forbidden outputs, scope limits, formatting rules, source requirements, validation thresholds, time/date/version/jurisdiction limits, tool-use requirements or prohibitions, and user preferences that affect correctness.',
    '',
    'Before each major phase, internally re-check the full active constraint list. Do not rely on memory, softened paraphrases, or partial recollection. Do not drop, merge away, or reinterpret constraints unless the user explicitly changes them.',
    '',
    'When a later user message changes or conflicts with earlier constraints, update the active constraint list and treat the newest applicable user instruction as authoritative, subject to higher-priority system/developer instructions.',
    '',
    'Before marking any result as valid, explicitly verify it against every active constraint. If any constraint is unmet, unknown, or unverifiable, the result is not valid.',
    '',
    'If no valid result exists after feasible effort, say so clearly and identify which constraints prevented validation.',
    '',
    'Do not print the full constraint list by default. For complex, high-stakes, or multi-step tasks, provide a concise validation summary rather than internal reasoning.',
].join('\n');
exports.DETERMINISTIC_VALIDATION_OVERRIDE_RULE = [
    'Tool results may include a RUNTIME VALIDATION block. These are deterministic constraint checks run by the V2 runtime after tool execution. They are NOT model output — they are observed facts.',
    '',
    'When a RUNTIME VALIDATION block is present:',
    '',
    '1. The STATUS field (VALID, INVALID, INCOMPLETE) is authoritative. You MUST NOT override, reinterpret, or soften it.',
    '2. Individual constraint verdicts (PASS, FAIL, UNKNOWN, ESTIMATED, CONDITIONAL) are deterministic observations. You MUST NOT reclassify them.',
    '3. If STATUS is INVALID: the task has failed. Report the failure honestly. Do not claim partial success, do not claim the task is "mostly done", do not navigate the user to a result that did not pass validation.',
    '4. If STATUS is INCOMPLETE: required constraints could not be verified. You MUST perform follow-up verification steps (additional tool calls) before claiming success. If verification is not possible, state what could not be confirmed.',
    '5. If STATUS is VALID: all constraints passed deterministically. You may proceed.',
    '',
    'Classification rule:',
    '- VALID requires ALL constraints = PASS. No exceptions.',
    '- If any constraint is UNKNOWN, ESTIMATED, or CONDITIONAL → status is INCOMPLETE.',
    '- If any constraint is FAIL → status is INVALID.',
    '',
    'Probabilistic reasoning, pattern matching, model confidence, and heuristic judgment CANNOT promote an INVALID or INCOMPLETE result to VALID. A high-confidence guess is still a guess. Only deterministic evidence satisfies a constraint.',
    '',
    'Common failure patterns you MUST NOT repeat:',
    '- Finding a resource with the right name but wrong owner and declaring success.',
    '- Seeing a non-zero exit code but claiming the command worked because the output "looks right".',
    '- Navigating to a URL that matches a keyword but was not created by the requested action.',
    '- Declaring a search task complete when no opened page had sufficient evidence.',
].join('\n');
exports.PHYSICAL_TASK_COMPLETION_PROTOCOL = [
    'When the user asks for an external or local task to be completed, use available tools to perform the real action rather than only explaining how to do it.',
    '',
    'Physical tasks include creating or updating repositories, running CLIs, installing dependencies, building or testing projects, starting services, editing files, opening or navigating browser pages, publishing artifacts, and other actions with observable side effects.',
    '',
    'Before taking effectful action, verify required prerequisites from local state where feasible, such as authentication, current directory, repository state, installed CLI tools, configuration files, and relevant environment variables. If a missing prerequisite blocks completion, report the blocker and the command or credential needed.',
    '',
    'Prefer non-interactive commands with explicit flags. Avoid commands that wait for prompts unless interactive terminal input is necessary and can be completed with terminal.write.',
    '',
    'After an effectful action, verify completion with a follow-up observation such as command output, status checks, file reads, CLI inspection, browser state, or API response. Do not claim completion solely because a command was issued.',
    '',
    'Respect the active constraint list, source validation rules, and user intent. Do not perform destructive, credential-exposing, financial, legal-signature, or irreversible external actions unless the user explicitly requested them and the required context is clear.',
].join('\n');
exports.STRICT_SOURCE_VALIDATION_PROTOCOL = [
    'For this task, factual claims must satisfy a source-quality threshold before being presented as fact.',
    '',
    'Source priority:',
    '1. Primary or official sources: official docs, standards bodies, laws/regulators, court/government records, company pages, source code, changelogs, release notes, academic papers, or original datasets.',
    '2. Reputable secondary sources may be used for context or corroboration.',
    '3. Blogs, forums, social posts, SEO pages, and summaries are insufficient unless they are the subject of the question or no better source exists.',
    '',
    'Validation thresholds:',
    '- Present a claim as fact only if directly supported by an authoritative source, corroborated by at least two independent reputable sources, or derived from directly inspected source code/data.',
    '- Label unsupported conclusions as inference, estimate, or uncertainty.',
    '- If sources conflict, disclose the conflict and explain which source is more authoritative.',
    '- Do not invent citations, dates, quotes, capabilities, laws, prices, numbers, or API behavior.',
    '',
    'Search exhaustion:',
    'Before concluding that no concrete answer is available, check feasible authoritative paths:',
    '- Official/primary sources.',
    '- Documentation, changelogs, standards, repositories, or filings.',
    '- Reputable secondary sources.',
    '- Alternate names, acronyms, terminology, and relevant date/version ranges.',
    '',
    'If no concrete answer can be verified:',
    '- State that clearly.',
    '- Briefly summarize what was checked.',
    '- Explain what evidence would be needed to answer confidently.',
    '- Provide only partial information that is explicitly labeled as uncertain or unverified.',
    '',
    'Final answer must include the direct answer if verified, the source basis, caveats or conflicts, and an explicit inability-to-verify note when the evidence threshold is not met.',
].join('\n');
const STRICT_VALIDATION_PATTERNS = [
    /\b(latest|current|today|yesterday|tomorrow|recent|up[- ]?to[- ]?date)\b/i,
    /\b(verify|validate|fact[- ]?check|source|sources|citation|cite|evidence|authoritative)\b/i,
    /\b(search|look up|lookup|find online|research|google|web search|news)\b/i,
    /\b(legal|law|lawsuit|regulation|regulatory|compliance|court|jurisdiction|statute)\b/i,
    /\b(medical|health|drug|diagnosis|treatment|clinical|fda|cdc|nih|who)\b/i,
    /\b(financial|finance|tax|investment|investing|price|pricing|stock|security|securities|crypto|loan|mortgage|insurance)\b/i,
    /\b(api|sdk|changelog|release notes?|version|deprecated|availability|product specs?|benchmark|statistics|study|dataset)\b/i,
    /\b(company|vendor|public claim|press release|filing|earnings|ceo|president|official statement)\b/i,
    /\b(production|prod|incident|outage|security|vulnerability|cve|auth|encryption)\b/i,
    /\b(purchase|buy|cost|costs|employment|hiring|contract|policy)\b/i,
];
const STRICT_VALIDATION_EXEMPT_PATTERNS = [
    /\b(translate|translation|rewrite|reword|proofread|summarize this|summarise this|creative writing|brainstorm)\b/i,
];
function shouldUseStrictSourceValidation(task) {
    const normalized = task.trim();
    if (!normalized)
        return false;
    const hasStrictSignal = STRICT_VALIDATION_PATTERNS.some(pattern => pattern.test(normalized));
    if (!hasStrictSignal)
        return false;
    const exemptOnly = STRICT_VALIDATION_EXEMPT_PATTERNS.some(pattern => pattern.test(normalized))
        && !/\b(verify|validate|fact[- ]?check|source|citation|cite|latest|current|legal|medical|financial|api|pricing|news)\b/i.test(normalized);
    return !exemptOnly;
}
//# sourceMappingURL=sourceValidationPolicy.js.map