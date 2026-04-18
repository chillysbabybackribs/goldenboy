import { AgentToolName, AgentToolResult, ConstraintVerdict, ResultValidation } from './AgentTypes';
export type TaskConstraint = {
    name: string;
    expected?: string;
    check: (result: AgentToolResult, input: unknown) => ConstraintVerdict;
};
export declare function validateToolResult(toolName: AgentToolName, result: AgentToolResult, input: unknown): ResultValidation | null;
export declare function formatValidationForModel(validation: ResultValidation): string;
