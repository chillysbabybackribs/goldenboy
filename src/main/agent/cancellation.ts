const USER_CANCELLATION_MESSAGE = 'Task cancelled by user.';

export class AgentCancellationError extends Error {
  constructor(message = USER_CANCELLATION_MESSAGE) {
    super(message);
    this.name = 'AgentCancellationError';
  }
}

export function isAgentCancellationError(error: unknown): boolean {
  return error instanceof AgentCancellationError
    || (error instanceof Error && error.message === USER_CANCELLATION_MESSAGE);
}

export function getAgentCancellationMessage(): string {
  return USER_CANCELLATION_MESSAGE;
}
