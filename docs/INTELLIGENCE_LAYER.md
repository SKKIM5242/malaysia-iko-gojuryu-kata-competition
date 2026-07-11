# Intelligence Layer

## Messy Inputs
- Handwritten registration forms scanned/emailed
- Mixed belt-rank naming conventions across schools
- Age eligibility edge cases per category

## Auto-Structure Schema (v1 rule-based)
```json
{
  "participant_name": "Ahmad Faris bin Razali",
  "derived_age": 14,
  "suggested_category": "Junior Male Kyu",
  "suggestion_source": "dob+belt_rank rule",
  "suggestion_confidence": 0.91,
  "review_status": "unreviewed"
}
```

## Events to Track
- Registration submitted
- Payment status changed
- Participant category changed by admin
- Announcement published

## Scoring Rules (rule-based first)
- Age bracket match: exact → confidence 1.0; boundary (±1 yr) → 0.7
- Belt group match: exact → 1.0; adjacent → 0.6
- Combined confidence = average of above

## What Gets Ranked
- Registrations flagged for admin review (low confidence category match)
- Schools with most participants (dashboard stat)

## v1 vs Later
- **v1:** Rule-based category suggestion, admin reviews all
- **Later:** ML model trained on historical placements; automated draw seeding
