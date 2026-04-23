import type { WorkflowDefinition } from '../types';

export const browserAutomationResearchWorkflow: WorkflowDefinition = {
  id: 'browser-automation-research',
  version: '1.0.0',
  description: 'Search the web from the embedded Chromium browser, extract live evidence about browser automation, and pin a grounded finding into task memory.',
  allowedTools: [
    'browser.research_search',
    'browser.extract_page',
    'browser.record_finding',
  ],
  inputs: {
    query: 'browser automation in chromium browser',
    findingTitle: 'Browser automation research result',
    findingSeverity: 'info',
  },
  heartbeat: {
    intervalMs: 3000,
    include: ['step', 'url', 'retryCount', 'lastError'],
  },
  checkpoint: {
    saveAfterEveryStep: true,
  },
  escalation: {
    maxRetriesPerStep: 1,
    conditions: ['search_failed', 'insufficient_live_evidence', 'page_extraction_failed', 'finding_persist_failed'],
  },
  steps: [
    {
      id: 'search_browser_automation',
      kind: 'tool',
      tool: 'browser.research_search',
      input: {
        query: '{{inputs.query}}',
        mode: 'workflow',
        resultLimit: 5,
        maxPages: 2,
        stopWhenAnswerFound: true,
        minEvidenceScore: 8,
      },
      onFailure: 'retry',
    },
    {
      id: 'extract_active_result',
      kind: 'tool',
      tool: 'browser.extract_page',
      input: {
        maxLength: 2500,
      },
      onFailure: 'escalate',
    },
    {
      id: 'record_research_finding',
      kind: 'tool',
      tool: 'browser.record_finding',
      input: {
        title: '{{inputs.findingTitle}}',
        summary: '{{steps.search_browser_automation.data.openedPages.0.answerEvidence.0}}',
        severity: '{{inputs.findingSeverity}}',
        evidence: [
          'Query: {{inputs.query}}',
          'Source: {{steps.search_browser_automation.data.openedPages.0.url}}',
          'Page title: {{steps.extract_active_result.data.metadata.title}}',
          '{{steps.search_browser_automation.data.openedPages.0.summary}}',
        ],
      },
      onFailure: 'escalate',
    },
  ],
};
