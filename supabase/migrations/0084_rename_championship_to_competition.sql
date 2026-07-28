-- Site rebrand: "Kata Championship" -> "Kata Competition" everywhere the
-- event name is stored, to match the header/branding wording change.
update competitions
set name = replace(name, 'Kata Championship', 'Kata Competition')
where name like '%Kata Championship%';
