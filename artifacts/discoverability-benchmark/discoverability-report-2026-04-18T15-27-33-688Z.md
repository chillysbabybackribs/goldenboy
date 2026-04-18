=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  Correct  Grounded  MinPath
----------------------------------------------------------------------------------------
haiku        1          0        1        0        0%         100%     100%      0%

## haiku
- local-config-lookup: soft_pass | asked=false | coverage=0.50 | failures=none

Scenarios without any submitted runs: tests-infer-behavior, runtime-status-from-logs, cross-source-summary, stale-doc-vs-current-code, true-missing-information