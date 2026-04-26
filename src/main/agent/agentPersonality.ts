import { buildTaskProfile } from './taskProfile';

type PersonalityProfile = {
  matches: (task: string) => boolean;
  addendum: string;
};

const BROWSER_TASK_RE = /\b(search(?: the web| online)?|look up|lookup|find online|research|latest|current|browser|tab|tabs|page|pages|url|navigate|visit|click|type|form|login|upload|download|automation)\b/;
const REVIEW_TASK_RE = /\b(review|regression|pull request|diff|requested changes|code review)\b/;
const AUDIT_TASK_RE = /\b(audit|architecture review|system review|workflow review|prompt review|tool review)\b/;
const DEBUG_TASK_RE = /\b(debug|diagnose|investigate|troubleshoot|root cause|failing|crash|error|exception)\b/;

const PERSONALITY_PROFILES: PersonalityProfile[] = [
  {
    matches: (task) => buildTaskProfile(task).kind === 'orchestration',
    addendum: [
      'For orchestration and complex planning tasks:',
      '1. Keep the plan compact and executable.',
      '2. Separate objective, tracks, delegation, validation, and immediate next action.',
      '3. Keep the parent on the critical path and delegate only bounded independent subtasks.',
      '4. Do not produce long speculative strategy text.',
    ].join('\n'),
  },
  {
    matches: (task) => BROWSER_TASK_RE.test(task.toLowerCase()),
    addendum: [
      'For browser, research, and web tasks:',
      '1. Do not open by echoing or paraphrasing the user request.',
      '2. If the first obvious step is a browser tool call, make it before emitting any assistant text.',
      '3. Do not narrate your plan or restate obvious tool actions.',
      '4. Keep interim text to zero or one short sentence before tool calls; prefer no interim text when the next step is obvious from the tool call.',
      '5. As soon as observed browser evidence or verified tool results satisfy the task, stop calling tools and produce the final answer immediately.',
      '6. Do not add an extra recap after the task is complete.',
      '7. Keep the final answer concise and focused on the result, not the tool trace.',
    ].join('\n'),
  },
  {
    matches: (task) => REVIEW_TASK_RE.test(task.toLowerCase()),
    addendum: [
      'For review and audit tasks, produce the final answer in this order:',
      '1. Findings first, ordered by severity.',
      '2. Each finding must include a file reference when available.',
      '3. Keep the change summary brief and only after findings.',
      '4. If no findings were found, say that explicitly.',
      'Do not narrate the tool trace in the final answer.',
    ].join('\n'),
  },
  {
    matches: (task) => AUDIT_TASK_RE.test(task.toLowerCase()),
    addendum: [
      'For audit tasks that are not code-review requests, produce the final answer in this order:',
      '1. Current state and the main tensions or conflicts.',
      '2. Concrete recommendations, ordered by leverage.',
      '3. Risks, open questions, or follow-up changes.',
      'Use findings-first severity ordering only when the user is explicitly asking for code review, regressions, or defects.',
      'Do not narrate the tool trace in the final answer.',
    ].join('\n'),
  },
  {
    matches: (task) => DEBUG_TASK_RE.test(task.toLowerCase()),
    addendum: [
      'For debugging tasks, produce the final answer in this order:',
      '1. Root cause or strongest current hypothesis.',
      '2. Evidence from observed files, commands, or runtime state.',
      '3. Fix or next action.',
      'Prefer `terminal.build_repo` over raw `terminal.exec` when the task is to verify the repository build after code changes.',
      'Prefer `terminal.test_repo` over raw `terminal.exec` when the task is to verify the repository test suite.',
      'Do not narrate the tool trace in the final answer.',
    ].join('\n'),
  },
];

export function buildResponseStyleAddendum(task: string): string {
  for (const profile of PERSONALITY_PROFILES) {
    if (profile.matches(task)) return profile.addendum;
  }
  return '';
}
