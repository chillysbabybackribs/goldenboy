"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenBudget = void 0;
class TokenBudget {
    maxInputTokens;
    _cumulativeInput = 0;
    _cumulativeOutput = 0;
    _turnCount = 0;
    constructor(maxInputTokens) {
        this.maxInputTokens = maxInputTokens;
    }
    recordTurn(inputTokens, outputTokens) {
        this._cumulativeInput += inputTokens;
        this._cumulativeOutput += outputTokens;
        this._turnCount++;
    }
    get cumulativeInput() {
        return this._cumulativeInput;
    }
    get cumulativeOutput() {
        return this._cumulativeOutput;
    }
    get turnCount() {
        return this._turnCount;
    }
    get fillRatio() {
        return this._cumulativeInput / this.maxInputTokens;
    }
    get exceeded() {
        return this._cumulativeInput > this.maxInputTokens;
    }
    get compressionTier() {
        const ratio = this.fillRatio;
        if (ratio < 0.4)
            return 'light';
        if (ratio < 0.7)
            return 'moderate';
        return 'aggressive';
    }
    get averageBurnRate() {
        return this._turnCount === 0 ? 0 : this._cumulativeInput / this._turnCount;
    }
    get estimatedRemainingTurns() {
        const rate = this.averageBurnRate;
        if (rate === 0)
            return Infinity;
        return Math.floor((this.maxInputTokens - this._cumulativeInput) / rate);
    }
}
exports.TokenBudget = TokenBudget;
//# sourceMappingURL=tokenBudget.js.map