-- One upload limit across the stack: 50 MB, the Supabase Free plan's per-file cap.
-- Matches MAX_UPLOAD_BYTES in src/web/lib/uploadLimit.ts and the miner's MAX_PAYLOAD_BYTES.
update storage.buckets
set file_size_limit = 52428800
where id in ('raw-uploads', 'snapshots');
