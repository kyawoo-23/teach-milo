# Local setup

Local dev needs JDK 21 or newer. Start Firestore with `pnpm emulators`, then `pnpm dev` in a second terminal. `pnpm doctor` checks the setup. Host, port, and the `demo-teach-milo` project flag are in `firebase.json` and the `emulators` script.

The app reads `GOOGLE_CLOUD_PROJECT` for the Firebase project id (`demo-teach-milo` on the emulator). It does not read `.firebaserc`; that file is for the Firebase CLI. `GEMINI_API_KEY` is a separate setting.

## Browser origin and Google sign-in

`pnpm dev` binds `127.0.0.1`. Set `APP_ORIGIN` in `.env.local` to that origin, usually `http://127.0.0.1:3000`. `localhost` is a different origin and breaks Google OAuth.

The redirect URI is `{APP_ORIGIN}/api/auth/google/callback`. Authorize that same origin on the Web client. Local client id and secret are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Sign-in is email and password. Google OAuth is optional.

## Local Gemini models

When iterating on lesson or chat latency, `gemini-3-flash-preview` can stand in for the repo default. `gemini-3.5-flash-lite` can stand in when structured JSON and PDF OCR stay reliable. Leave the production `_GEMINI_MODEL` substitution unchanged.
