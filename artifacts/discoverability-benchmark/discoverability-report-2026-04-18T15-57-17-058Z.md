=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  Correct  Grounded  MinPath
----------------------------------------------------------------------------------------
gpt-5.4      1          0        0        1        0%         0%       0%        0%
haiku        1          0        0        1        0%         0%       100%      100%

## gpt-5.4
- runtime-status-from-logs: fail | asked=false | coverage=0.00 | failures=wrong_confidence

## haiku
- runtime-status-from-logs: fail | asked=false | coverage=1.00 | failures=missed_synthesis

Scenarios without any submitted runs: local-config-lookup, tests-infer-behavior, cross-source-summary, stale-doc-vs-current-code, true-missing-information