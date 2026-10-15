# Git-based deploys

This project now deploys to production from `main` on every push,
via Vercel's GitHub integration (connected 2026-10-15). The
previous failure mode — Vercel's dashboard "Redeploy" button
returning 404 — was caused by deployments having been created via
raw API file-upload instead of a Git source. Redeploy and env var
changes now behave normally.
