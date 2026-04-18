=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  CorrectEsc Correct  Grounded  MinPath
---------------------------------------------------------------------------------------------------
gpt-5.4      3          0        0        3        0%         0%         0%       0%        0%
haiku        0          0        0        0        0%         0%         0%       0%        0%

## gpt-5.4
Buckets:
- cross_source: scenarios=1 | strong=0 | soft=0 | fail=1 | correctEsc=0% | minPath=0%
- stale_vs_current: scenarios=1 | strong=0 | soft=0 | fail=1 | correctEsc=0% | minPath=0%
- negative_control: scenarios=1 | strong=0 | soft=0 | fail=1 | correctEsc=0% | minPath=0%

- cross-source-summary: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=wrong_confidence
- stale-doc-vs-current-code: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=wrong_confidence
- true-missing-information: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=none

## haiku
Unavailable runs:
- cross-source-summary: provider unavailable: billing/credit issue
- stale-doc-vs-current-code: provider unavailable: billing/credit issue
- true-missing-information: provider unavailable: billing/credit issue


Scenarios without any submitted runs: local-config-lookup, tests-infer-behavior, runtime-status-from-logs