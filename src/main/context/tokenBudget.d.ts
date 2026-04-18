export type CompressionTier = 'none' | 'light' | 'moderate' | 'aggressive';
export declare class TokenBudget {
    private readonly maxInputTokens;
    private _cumulativeInput;
    private _cumulativeOutput;
    private _turnCount;
    constructor(maxInputTokens: number);
    recordTurn(inputTokens: number, outputTokens: number): void;
    get cumulativeInput(): number;
    get cumulativeOutput(): number;
    get turnCount(): number;
    get fillRatio(): number;
    get exceeded(): boolean;
    get compressionTier(): Exclude<CompressionTier, 'none'>;
    get averageBurnRate(): number;
    get estimatedRemainingTurns(): number;
}
