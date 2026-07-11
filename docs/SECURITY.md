# Security

## Secrets
- Supabase service-role key: server-side only (Next.js API routes / server actions) — never in client bundle
- Supabase anon key: client-safe, combined with RLS
- All env vars in Vercel dashboard, never committed

## Permission Model
- **v1 (demo):** RLS permissive — anonymous read + write so the app is demoable
- **Lock-down sprint:** Replace with owner-only writes (`auth.uid() = user_id`); public read retained for competition/participant/announcement tables; registrations write open to any authenticated user (the registrant)
- Admin panel routes protected by Supabase Auth session check server-side

## Approved Tools Rule
- Agents may only call the named tools in AGENTIC_LAYER.md
- No `run_any`, `exec_sql`, or arbitrary fetch allowed
- Every tool call writes an audit_log row before returning

## Audit Principle
- Every state-changing action (registration insert, payment update, publish toggle, delete) is logged to `audit_logs` with actor, timestamp, old+new value
- Logs are append-only; no delete policy on audit_logs table

## Honest Gaps
- Payment verification is manual (no cryptographic proof of transfer) — owner must not mark paid without seeing bank confirmation
- If a real payment gateway is added later, engage a developer with PCI-DSS experience
