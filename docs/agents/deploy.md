# Deploy

Production is Cloud Build and Cloud Run on GCP project `teach-milo`. Service name, runtime service account, Secret Manager ids, `_APP_ORIGIN`, and `_GEMINI_MODEL` live in `cloudbuild.yaml`. Cloud Run is deployed with `--allow-unauthenticated`.

`firebase.json` has no Hosting site. Publish Firestore config with `pnpm exec firebase deploy --only firestore:indexes`, and include `firestore:rules` when rules change. Wait until a new composite index is ready before paginated session history works in production.

The production image stage sets `ENV CI=true` and runs `pnpm prune --prod` with no extra flags. pnpm 11 rejects `--store-dir` and `--offline` on `prune`.
