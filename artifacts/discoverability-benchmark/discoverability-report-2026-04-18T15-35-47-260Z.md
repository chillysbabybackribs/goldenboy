=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  Correct  Grounded  MinPath
----------------------------------------------------------------------------------------
gpt-5.4      1          1        0        0        0%         100%     100%      100%

## gpt-5.4
- local-config-lookup: strong_pass | asked=true | coverage=1.00 | failures=none

Scenarios without any submitted runs: tests-infer-behavior, runtime-status-from-logs, cross-source-summary, stale-doc-vs-current-code, true-missing-information