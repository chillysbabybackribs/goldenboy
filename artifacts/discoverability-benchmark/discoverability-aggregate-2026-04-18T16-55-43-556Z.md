=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  CorrectEsc Correct  Grounded  MinPath
---------------------------------------------------------------------------------------------------
gpt-5.4      3          2        0        1        0%         0%         67%      67%       67%
haiku        3          2        0        1        0%         0%         67%      100%      100%

## gpt-5.4
Buckets:
- workspace_local: scenarios=2 | strong=2 | soft=0 | fail=0 | correctEsc=0% | minPath=100%
- runtime_observable: scenarios=1 | strong=0 | soft=0 | fail=1 | correctEsc=0% | minPath=0%

- local-config-lookup: strong_pass | asked=false | correctEscalation=false | coverage=1.00 | failures=none
- tests-infer-behavior: strong_pass | asked=false | correctEscalation=false | coverage=1.00 | failures=none
- runtime-status-from-logs: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=wrong_confidence

## haiku
Buckets:
- workspace_local: scenarios=2 | strong=2 | soft=0 | fail=0 | correctEsc=0% | minPath=100%
- runtime_observable: scenarios=1 | strong=0 | soft=0 | fail=1 | correctEsc=0% | minPath=100%

- local-config-lookup: strong_pass | asked=false | correctEscalation=false | coverage=1.00 | failures=none
- tests-infer-behavior: strong_pass | asked=false | correctEscalation=false | coverage=1.00 | failures=none
- runtime-status-from-logs: fail | asked=false | correctEscalation=false | coverage=1.00 | failures=missed_synthesis

Scenarios without any submitted runs: cross-source-summary, stale-doc-vs-current-code, true-missing-information