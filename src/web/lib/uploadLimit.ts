/**
 * The one upload limit, shared by every layer that stores or reads an uploaded file:
 * this page, the `raw-uploads` and `snapshots` buckets (migration 20261106000000), hosted
 * Supabase's global limit (50 MB on the Free plan) and the miner's MAX_PAYLOAD_BYTES.
 * Change them together; see docs/deployment-plan.md.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "50 MB";
