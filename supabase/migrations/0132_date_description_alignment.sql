-- The Date description's own text alignment, independent of date_alignment
-- (which stays controlling only the big date number's position) -- the
-- organizer specifically asked for the description to be separately
-- alignable, e.g. a long description could stay left-aligned while the
-- date number itself stays centered. Defaults to 'center', matching
-- today's look exactly.
alter table certificate_templates
  add column date_description_alignment text not null default 'center'
    check (date_description_alignment in ('left', 'center', 'right'));
