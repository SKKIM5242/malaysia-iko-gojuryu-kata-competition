# Agentic Layer

## Risk Levels & Actions

### Low — Auto (no approval needed)
- Tag a registration as `needs_review` when category confidence < 0.75
- Generate competition summary stats (participant count by school/category)
- Draft announcement copy from competition fields

### Medium — Light approval (owner confirms before save)
- Bulk update payment_status from a CSV import
- Move a participant to a different category

### High — Always approval (owner explicitly triggers)
- Send confirmation email to participant *(v2 only)*
- Publish/unpublish a competition

### Critical — Human only
- Delete a competition or registration record
- Issue refund or void payment record

## Named Tools (approved list)
- `insert_registration` — write one registration row
- `update_payment_status` — change status on a named registration id
- `publish_announcement` — flip `published = true` on named announcement
- `flag_for_review` — set `review_status = 'needs_review'` on a registration

## Audit Log Fields
`id, table_name, record_id, action, old_value, new_value, actor_id, ip_address, created_at`

## v1 vs Later
- **v1:** Manual admin actions + auto-flag low-confidence registrations
- **Later:** Bulk email tool, draw-seeding agent, payment reconciliation agent
