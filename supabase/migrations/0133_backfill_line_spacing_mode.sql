-- Data-only migration: certificate_templates.*_style used to store line
-- spacing as {"lineHeight": N} and/or {"tightSpacing": true}; the app now
-- reads {"lineSpacingMode": ..., "lineSpacingAt": N} instead (the Word-style
-- Single/1.5/Double/At least/Exactly/Multiple control). Translates any
-- already-saved value so it keeps rendering exactly as before, rather than
-- silently reverting to "Single" the moment this ships. tightSpacing:true
-- forced line-height to 1 -- "multiple" at 1 reproduces that precisely.
-- No column changes: TextStyle lives entirely inside these jsonb blobs.

do $$
declare
  col text;
begin
  foreach col in array array['header1_style', 'header2_style', 'body1_style', 'body2_style', 'body3_style']
  loop
    execute format(
      $f$
      update certificate_templates
      set %1$I = (
        (%1$I - 'tightSpacing' - 'lineHeight')
        || case
          when (%1$I ->> 'tightSpacing') = 'true'
            then jsonb_build_object('lineSpacingMode', 'multiple', 'lineSpacingAt', 1)
          when (%1$I -> 'lineHeight') is not null
            then jsonb_build_object('lineSpacingMode', 'multiple', 'lineSpacingAt', (%1$I -> 'lineHeight'))
          else '{}'::jsonb
        end
      )
      where (%1$I ->> 'tightSpacing') = 'true' or (%1$I -> 'lineHeight') is not null;
      $f$,
      col
    );
  end loop;
end $$;
