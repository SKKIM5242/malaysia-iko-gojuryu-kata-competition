-- Organizer moderation of an inappropriate winner testimonial. Soft delete,
-- not hard delete: the row (and its unique registration_id constraint)
-- stays in place -- media_path/message are cleared so nothing plays back,
-- but the row's continued existence is exactly what keeps the Winner
-- Certificate download and reward payout unlocked (both gates just check
-- "does a row exist for this registration") and keeps the winner from
-- submitting a second testimonial (insert would collide on the unique
-- constraint). See app/actions/admin.ts's deleteTestimonial.
alter table winner_testimonials
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null,
  add column if not exists delete_reason text;
