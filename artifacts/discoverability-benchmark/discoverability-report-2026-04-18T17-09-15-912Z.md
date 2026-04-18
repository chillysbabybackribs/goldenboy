=== Discoverability Audit ===

Provider     Scenarios  Strong   Soft     Fail     UnneededQ  CorrectEsc Correct  Grounded  MinPath
---------------------------------------------------------------------------------------------------
gpt-5.4      0          0        0        0        0%         0%         0%       0%        0%
haiku        0          0        0        0        0%         0%         0%       0%        0%

## gpt-5.4
Unavailable runs:
- cross-source-summary: benchmark unavailable: invocation timeout
- stale-doc-vs-current-code: benchmark unavailable: invocation timeout
- true-missing-information: benchmark unavailable: invocation timeout


## haiku
Unavailable runs:
- cross-source-summary: provider unavailable: billing/credit issue
- stale-doc-vs-current-code: provider unavailable: billing/credit issue
- true-missing-information: provider unavailable: billing/credit issue


Scenarios without any submitted runs: local-config-lookup, tests-infer-behavior, runtime-status-from-logs