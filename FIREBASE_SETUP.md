# Firebase Setup Guide (Step by Step)

This project is now pure static frontend:
- HTML: `index.html`
- CSS: `styles.css`
- JavaScript: `app.js`
- Firebase config: `firebase-config.js`

You can host it directly on GitHub Pages.

## 1) Create Firebase project

1. Go to Firebase Console.
2. Click **Create project**.
3. Name it (example: `visitor-flow-campus`).
4. Skip Google Analytics if not needed.

## 2) Enable Authentication (Email/Password)

1. In Firebase Console, open **Authentication**.
2. Click **Get started**.
3. Enable **Email/Password** provider.
4. Create accounts for your team (admin/guard/host) in **Users** tab.

## 3) Create Firestore Database

1. Open **Firestore Database**.
2. Click **Create database**.
3. Start in production mode.
4. Choose region close to your users.

## 4) Add Web app and copy Firebase config

1. In Project settings, click **Add app** and choose web (`</>`).
2. Register app.
3. Copy config values into `firebase-config.js`.
4. Save file.

## 5) Add role documents in Firestore

Create collection: `users`

For each authenticated Firebase user, create one document:
- Document ID must be the exact Firebase Auth `uid`
- Example fields:
  - `role`: `admin` or `guard` or `host`
  - `displayName`: optional string

How to find `uid`:
- Firebase Console > Authentication > Users > click user > copy UID.

## 6) Deploy Firestore security rules

1. In Firestore, open **Rules**.
2. Replace with content from `firestore.rules`.
3. Publish rules.

## 7) Required Firestore collections used by app

App will create/read:
- `visitor_logs/{visitCode}`
- `preregistrations/{visitCode}`
- `users/{uid}`

You usually create only `users` manually. Others are created through app actions.

## 8) Local test

Because this app uses JS modules, run with a local server (not opening file directly):

Option A (Python installed):
```bash
python -m http.server 5500
```
Then open `http://localhost:5500`

Option B (VS Code extension):
- Install Live Server extension
- Right click `index.html` > Open with Live Server

## 9) GitHub Pages deployment

1. Push project to GitHub repo.
2. Repo settings > Pages.
3. Source: deploy from branch `main` (or `master`), folder `/ (root)`.
4. Save and wait for URL.

Your app is now online and connected to Firebase.

## 10) First-run checklist

- Can admin log in?
- Can guard perform manual check-in?
- Can host generate pre-registration code?
- Can guard check in with that code?
- Can guard direct check-out from current visitors?
- Can admin delete old logs?
- Can admin export CSV?

## 11) Common errors and fixes

- Error: `Firebase config missing`
  - Fix: update `firebase-config.js` placeholders.

- Error: permission denied
  - Fix: ensure `users/{uid}` exists and has correct `role`.
  - Also verify rules are published.

- Empty dashboard
  - Fix: perform at least one check-in to create `visitor_logs` data.

## 12) Optional hardening for production

- Add Firebase App Check.
- Add Cloud Functions for server-side report generation.
- Add input validation rules for max field lengths.
- Add daily backup export from Firestore.
