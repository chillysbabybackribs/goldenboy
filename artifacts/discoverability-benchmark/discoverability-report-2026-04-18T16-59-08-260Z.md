=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  CorrectEsc Correct  Grounded  MinPath
---------------------------------------------------------------------------------------------------
gpt-5.4      6          2        2        2        0%         0%         67%      67%       33%
haiku        6          0        0        6        0%         0%         0%       0%        0%

## gpt-5.4
- local-config-lookup: strong_pass | asked=false | correctEscalation=false | coverage=1.00 | failures=none
- tests-infer-behavior: strong_pass | asked=false | correctEscalation=false | coverage=1.00 | failures=none
- runtime-status-from-logs: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=wrong_confidence
- cross-source-summary: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=none
- stale-doc-vs-current-code: soft_pass | asked=false | correctEscalation=false | coverage=0.50 | failures=none
- true-missing-information: soft_pass | asked=false | correctEscalation=false | coverage=0.00 | failures=none

## haiku
- local-config-lookup: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=wrong_confidence
- tests-infer-behavior: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=wrong_confidence
- runtime-status-from-logs: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=wrong_confidence
- cross-source-summary: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=wrong_confidence
- stale-doc-vs-current-code: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=wrong_confidence
- true-missing-information: fail | asked=false | correctEscalation=false | coverage=0.00 | failures=none

All defined scenarios have at least one submitted run.