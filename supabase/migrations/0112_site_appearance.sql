-- Site-wide appearance settings: a singleton row (same "id boolean primary
-- key default true" pattern as certificate_settings) controlling the
-- public site's logo, header title/subtitle, main menu, and footer --
-- style knobs plus the actual text, read by SiteHeader/SiteFooter on every
-- public page. Logo reuses the existing public "branding" bucket rather
-- than a new one -- same kind of org-wide branding asset as the
-- certificate signature/stamp images already stored there.
create table if not exists site_appearance (
  id boolean primary key default true check (id),
  logo_path text,

  title_text text,
  title_align text not null default 'left' check (title_align in ('left','center','right')),
  title_line_height numeric not null default 1.2,
  title_color text not null default '#ffffff',
  title_font_size int not null default 16,
  title_font_family text not null default 'sans',
  title_bold boolean not null default true,

  subtitle_text text,
  subtitle_align text not null default 'left' check (subtitle_align in ('left','center','right')),
  subtitle_line_height numeric not null default 1.2,
  subtitle_color text not null default '#ffffff',
  subtitle_font_size int not null default 12,
  subtitle_font_family text not null default 'sans',
  subtitle_bold boolean not null default true,

  menu_color text not null default '#ffffff',
  menu_font_size int not null default 14,
  menu_bold boolean not null default false,
  menu_font_family text not null default 'sans',
  menu_align text not null default 'right' check (menu_align in ('left','center','right')),
  menu_line_height numeric not null default 1.2,

  footer_text text,
  footer_align text not null default 'center' check (footer_align in ('left','center','right')),
  footer_line_height numeric not null default 1.2,
  footer_color text not null default '#ffffff',
  footer_font_size int not null default 13,
  footer_font_family text not null default 'sans',
  footer_bold boolean not null default true,

  -- Array of {id, label, url} -- extra buttons rendered after the footer's
  -- own "Self Registration" button.
  buttons jsonb not null default '[]'::jsonb,

  updated_at timestamptz not null default now()
);
insert into site_appearance (id) values (true) on conflict do nothing;
alter table site_appearance enable row level security;

drop policy if exists "site_appearance_select" on site_appearance;
create policy "site_appearance_select" on site_appearance
  for select to authenticated, anon using (true);

-- Reuses is_competition_manager() (admin/organizer/staff) already defined
-- in migration 0075 for certificate_settings -- same tier appropriate for
-- editing what appears on every page.
drop policy if exists "site_appearance_write" on site_appearance;
create policy "site_appearance_write" on site_appearance
  for all to authenticated
  using (public.is_competition_manager())
  with check (public.is_competition_manager());
