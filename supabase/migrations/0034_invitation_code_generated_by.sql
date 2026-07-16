-- Records who generated each invitation code (auto-filled from the
-- generating admin's own signed-in name/email — never manually typed).

alter table invitation_codes add column if not exists generated_by text;
