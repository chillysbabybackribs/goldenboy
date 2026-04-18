=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  Correct  Grounded  MinPath
----------------------------------------------------------------------------------------
gpt-5.4      1          0        0        1        0%         100%     0%        0%

## gpt-5.4
- local-config-lookup: fail | asked=false | coverage=0.00 | failures=wrong_confidence

Scenarios without any submitted runs: tests-infer-behavior, runtime-status-from-logs, cross-source-summary, stale-doc-vs-current-code, true-missing-information