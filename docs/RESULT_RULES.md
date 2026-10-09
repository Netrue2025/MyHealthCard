# Result display rule 1.0

- Grey: draft, unconfirmed, incomplete, missing unit, ambiguous/conflicting context, unsupported comparator or feature disabled.
- Red: confirmed row with an explicit laboratory-reported critical flag. Netrue defines no generic critical thresholds.
- Green: confirmed numeric value within the applicable reported interval, with a unit and no conflicting flag.
- Amber: confirmed numeric value outside that interval, or an explicit non-critical abnormal flag.

Inclusive boundaries use `lower <= value <= upper`; explicit exclusive and one-sided bounds are respected. Qualitative values are not assigned universal colours. Every result retains raw text, unit, reported interval and source flag. Corrections require a new clinical version and invalidate previous evaluations.
