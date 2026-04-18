=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  Correct  Grounded  MinPath
----------------------------------------------------------------------------------------
gpt-5.4      2          1        1        0        0%         100%     50%       50%
haiku        2          2        0        0        0%         100%     100%      100%

## gpt-5.4
- local-config-lookup: strong_pass | asked=false | coverage=1.00 | failures=none
- tests-infer-behavior: soft_pass | asked=false | coverage=0.00 | failures=none

## haiku
- local-config-lookup: strong_pass | asked=false | coverage=1.00 | failures=none
- tests-infer-behavior: strong_pass | asked=false | coverage=1.00 | failures=none

Scenarios without any submitted runs: runtime-status-from-logs, cross-source-summary, stale-doc-vs-current-code, true-missing-information