export const ALWAYS_ON_SOURCE_VALIDATION_RULE = [
  'For factual, current, technical, legal, medical, financial, or decision-impacting claims, use authoritative sources where feasible, distinguish verified facts from inference, and never fabricate citations, dates, quotes, capabilities, laws, APIs, prices, or numeric values.',
  'If a concrete answer cannot be verified after reasonable effort, say so directly and briefly state what was checked.',
].join('\n');

export const CONSTRAINT_LEDGER_PROTOCOL = [
  'Before acting, extract all explicit user constraints into an active list — the single source of truth for the task. Constraints include required/forbidden outputs, scope, formatting, source requirements, validation thresholds, time/date/version/jurisdiction limits, tool-use rules, and user preferences affecting correctness.',
  '',
  'Re-check the full active list before each major phase. Do not rely on memory, soften, drop, or reinterpret constraints unless the user explicitly changes them. When a later user message conflicts with earlier constraints, update the list and treat the newest applicable user instruction as authoritative (subject to higher-priority system/developer instructions).',
  '',
  'Before marking any result valid, verify it against every active constraint. If any constraint is unmet, unknown, or unverifiable, the result is not valid. If no valid result is feasible, say so and name the blocking constraints. Do not print the full list by default; for complex or high-stakes tasks, provide a concise validation summary instead of internal reasoning.',
].join('\n');

export const DETERMINISTIC_VALIDATION_OVERRIDE_RULE = [
  'Tool results may include a RUNTIME VALIDATION block — deterministic constraint checks run by V2, not model output. Its verdicts are authoritative; you MUST NOT override, reinterpret, soften, or reclassify them.',
  '',
  'STATUS handling:',
  '- VALID (ALL constraints = PASS): proceed.',
  '- INCOMPLETE (any constraint UNKNOWN/ESTIMATED/CONDITIONAL): run follow-up verification before claiming success; if not possible, state what could not be confirmed.',
  '- INVALID (any constraint FAIL): task failed. Report the failure honestly; do not claim partial success or "mostly done".',
  '',
  'Probabilistic reasoning, pattern matching, model confidence, and heuristic judgment CANNOT promote INVALID/INCOMPLETE to VALID. A high-confidence guess is still a guess — only deterministic evidence satisfies a constraint.',
  '',
  'Common failure patterns you MUST NOT repeat:',
  '- Resource with the right name but wrong owner → success claimed.',
  '- Non-zero exit code or "already exists" → success claimed because output "looks right".',
  '- URL matches a keyword but was not created by the requested action.',
  '- Search task declared complete when no opened page had sufficient evidence.',
].join('\n');

export const PHYSICAL_TASK_COMPLETION_PROTOCOL = [
  'When the user asks for an external or local task, perform it via tools — do not only explain how. Physical tasks include repo changes, CLI runs, dependency installs, builds/tests, service starts, file edits, browser navigation, artifact publishing, and any action with observable side effects.',
  '',
  'Before an effectful action, verify prerequisites locally where feasible (auth, cwd, repo state, installed CLIs, config files, env vars). If a missing prerequisite blocks completion, report the blocker and the command/credential needed.',
  '',
  'Prefer non-interactive commands with explicit flags; avoid commands that wait for prompts unless interactive input is necessary and resolvable via terminal.write.',
  '',
  'After an effectful action, verify completion with a follow-up observation (command output, status check, file read, CLI inspection, browser state, API response). Do not claim completion solely because a command was issued.',
  '',
  'Respect the active constraint list, source-validation rules, and user intent. Never perform destructive, credential-exposing, financial, legal-signature, or irreversible external actions unless explicitly requested with clear context.',
].join('\n');

export const STRICT_SOURCE_VALIDATION_PROTOCOL = [
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

export function shouldUseStrictSourceValidation(task: string): boolean {
  const normalized = task.trim();
  if (!normalized) return false;

  const hasStrictSignal = STRICT_VALIDATION_PATTERNS.some(pattern => pattern.test(normalized));
  if (!hasStrictSignal) return false;

  const exemptOnly = STRICT_VALIDATION_EXEMPT_PATTERNS.some(pattern => pattern.test(normalized))
    && !/\b(verify|validate|fact[- ]?check|source|citation|cite|latest|current|legal|medical|financial|api|pricing|news)\b/i.test(normalized);

  return !exemptOnly;
}
