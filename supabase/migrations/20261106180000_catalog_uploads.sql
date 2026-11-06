-- Catalog PDFs routinely exceed the original 10 MB image-oriented limit.
-- The application still enforces a 25 MB per-file and 50 MB per-project cap.
update storage.buckets
set file_size_limit = 26214400
where id = 'project-assets';
