-- Video testimonials can now be uploaded from an existing file (not just
-- recorded live) -- the most common phone-native format missing from the
-- original allow-list is iPhone's default video/quicktime (.mov).
update storage.buckets
set allowed_mime_types = array['video/webm', 'video/mp4', 'video/quicktime', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg']
where id = 'testimonials';
