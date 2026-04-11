export type CompressionTier = 'none' | 'light' | 'moderate' | 'aggressive';

export class TokenBudget {
  private _cumulativeInput = 0;
  private _cumulativeOutput = 0;
  private _turnCount = 0;

  constructor(private readonly maxInputTokens: number) {}

  recordTurn(inputTokens: number, outputTokens: number): void {
    this._cumulativeInput += inputTokens;
    this._cumulativeOutput += outputTokens;
    this._turnCount++;
  }

  get cumulativeInput(): number {
    return this._cumulativeInput;
  }

  get cumulativeOutput(): number {
    return this._cumulativeOutput;
  }

  get turnCount(): number {
    return this._turnCount;
  }

  get fillRatio(): number {
    return this._cumulativeInput / this.maxInputTokens;
  }

  get exceeded(): boolean {
    return this._cumulativeInput > this.maxInputTokens;
  }

  get compressionTier(): Exclude<CompressionTier, 'none'> {
    const ratio = this.fillRatio;
    if (ratio < 0.4) return 'light';
    if (ratio < 0.7) return 'moderate';
    return 'aggressive';
  }

  get averageBurnRate(): number {
    return this._turnCount === 0 ? 0 : this._cumulativeInput / this._turnCount;
  }

  get estimatedRemainingTurns(): number {
    const rate = this.averageBurnRate;
    if (rate === 0) return Infinity;
    return Math.floor((this.maxInputTokens - this._cumulativeInput) / rate);
  }
}
