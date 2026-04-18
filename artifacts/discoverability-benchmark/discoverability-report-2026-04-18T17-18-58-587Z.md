=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  CorrectEsc Correct  Grounded  MinPath
---------------------------------------------------------------------------------------------------
gpt-5.4      1          0        1        0        0%         0%         100%     100%      0%

## gpt-5.4
Unavailable runs:
- cross-source-summary: benchmark unavailable: invocation timeout
- stale-doc-vs-current-code: benchmark unavailable: invocation timeout

Buckets:
- negative_control: scenarios=1 | strong=0 | soft=1 | fail=0 | correctEsc=0% | minPath=0%

- true-missing-information: soft_pass | asked=true | correctEscalation=false | coverage=0.00 | failures=none

Scenarios without any submitted runs: local-config-lookup, tests-infer-behavior, runtime-status-from-logs