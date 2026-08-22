-- The testimonials bucket rejected audio/wav with "mime type audio/wav is
-- not supported", while the upload screen told winners WAV was fine. The
-- screen was wrong: the bucket only ever allowed webm/mp4/aac/ogg.
--
-- Widened rather than narrowed, because these are formats people genuinely
-- arrive with: a voice memo off an iPhone is audio/mp4 or audio/x-m4a, a
-- Windows recorder gives audio/wav, and anything exported from an editor is
-- usually audio/mpeg. Refusing them meant telling a winner to go and convert
-- a file, which is the last thing to ask of someone who has just recorded a
-- testimonial.
--
-- The x- and vnd- spellings matter: there is no single agreed MIME string
-- for WAV or M4A, and which one a browser reports depends on the OS's own
-- registry. audio/wav, audio/x-wav, audio/wave and audio/vnd.wave are all
-- the same file; missing one means a rejection that looks arbitrary to the
-- person hitting it.
update storage.buckets
set allowed_mime_types = array[
  -- video
  'video/webm',
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  -- audio
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave'
]
where id = 'testimonials';

-- Same treatment for kata-videos: the "upload a recording you saved" panel
-- already accepts .m4v and .mov by name, but the bucket only listed
-- quicktime, so an .m4v was picked happily and then refused on upload.
update storage.buckets
set allowed_mime_types = array[
  'video/webm',
  'video/mp4',
  'video/quicktime',
  'video/x-m4v'
]
where id = 'kata-videos';
