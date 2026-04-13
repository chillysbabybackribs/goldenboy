import type { AgentTaskKind } from '../../shared/types/model';

export function shouldPrimeResearchBrowserSurface(taskKind: AgentTaskKind, browserSurfaceReady: boolean): boolean {
  return taskKind === 'research' && browserSurfaceReady;
}

export function buildStartupStatusMessages(input: {
  taskKind: AgentTaskKind;
  browserSurfaceReady: boolean;
}): string[] {
  const statuses = ['Starting task...'];

  if (input.taskKind === 'research') {
    statuses.push('Routing web search for fast browser-first execution.');
    statuses.push(
      input.browserSurfaceReady
        ? 'Opening a dedicated search tab while the first tool call is prepared.'
        : 'Browser search will open on the first tool call.',
    );
    return statuses;
  }

  if (input.taskKind === 'browser-automation') {
    statuses.push('Preparing the browser workflow.');
  }

  return statuses;
}
