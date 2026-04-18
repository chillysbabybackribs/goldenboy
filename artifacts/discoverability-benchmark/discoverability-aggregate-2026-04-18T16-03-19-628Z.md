=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  Correct  Grounded  MinPath
----------------------------------------------------------------------------------------
gpt-5.4      3          2        0        1        0%         67%      67%       67%
haiku        3          2        0        1        0%         67%      100%      100%

## gpt-5.4
- local-config-lookup: strong_pass | asked=false | coverage=1.00 | failures=none
- tests-infer-behavior: strong_pass | asked=false | coverage=1.00 | failures=none
- runtime-status-from-logs: fail | asked=false | coverage=0.00 | failures=wrong_confidence

## haiku
- local-config-lookup: strong_pass | asked=false | coverage=1.00 | failures=none
- tests-infer-behavior: strong_pass | asked=false | coverage=1.00 | failures=none
- runtime-status-from-logs: fail | asked=false | coverage=1.00 | failures=missed_synthesis

Scenarios without any submitted runs: cross-source-summary, stale-doc-vs-current-code, true-missing-information