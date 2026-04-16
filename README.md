# Visitor Flow

Visitor Flow is a role-based visitor management web app built with pure frontend technologies and Firebase.

It is designed to run well on GitHub Pages (no backend server required).

## Tech Stack

- HTML
- CSS
- JavaScript
- Firebase Authentication (Email/Password)
- Cloud Firestore

## What This System Does

- Secure login with role-based access (`guard`, `host`, `admin`)
- Guard check-in by pre-registration code
- Guard manual walk-in check-in
- Direct visitor check-out from active list/logs
- Host pre-registration with generated visit code
- Host expected arrival date + time input
- Searchable logs for host/admin/log pages
- Admin summary tiles and top-host insights
- Admin log deletion
- Admin CSV export

## Project Structure

- `index.html` - landing + role selection + sign-in
- `guard.html` - guard dashboard (check-in/check-out)
- `host.html` - host dashboard (pre-registration)
- `admin.html` - admin dashboard (reports + controls)
- `logs.html` - log viewer page
- `styles.css` - complete UI styling system
- `app.js` - all app logic (auth, data, rendering, actions)
- `firebase-config.js` - your Firebase project credentials
- `firestore.rules` - Firestore authorization rules
- `FIREBASE_SETUP.md` - detailed Firebase setup guide

## Setup (Local)

1. Follow `FIREBASE_SETUP.md` fully.
2. Update `firebase-config.js` with your Firebase config values.
3. Ensure user role documents exist in Firestore: `users/{uid}`.
4. Serve the project using a local web server.

Example:

```powershell
python -m http.server 5500
```

Open `http://localhost:5500`.

## Deploy to GitHub Pages

1. Push this project to a GitHub repository.
2. Go to repository `Settings` -> `Pages`.
3. Under `Build and deployment`, set:
	 - `Source`: Deploy from a branch
	 - `Branch`: `main` (or `master`)
	 - `Folder`: `/ (root)`
4. Save and wait for GitHub Pages to publish.
5. Open your Pages URL.

## Firebase Requirements Before Production

- Enable `Email/Password` in Firebase Authentication.
- Create Firestore database.
- Publish the rules in `firestore.rules`.
- Create `users/{uid}` documents with valid roles:
	- `admin`
	- `guard`
	- `host`

## Role-Based Access Notes

- Guard and admin can check in/out visitors.
- Host and admin can create pre-registrations.
- Admin can delete logs and export CSV.
- All authenticated roles can view logs according to app routing.

## Quick Verification Checklist

- Admin can log in and view summary + top hosts.
- Host can create pre-registration and receive visit code.
- Guard can check in visitor using that code.
- Guard can manually check in a walk-in visitor.
- Guard/admin can check out a visitor.
- Admin can search, delete, and export logs.

## Troubleshooting

- `Permission denied` in Firestore:
	- Confirm rules are published.
	- Confirm role document exists at `users/{uid}`.
- Login works but wrong page access:
	- Check the user's `role` value in Firestore.
- Empty dashboard/log list:
	- Create at least one check-in record first.

## Security Note

Firebase web config in `firebase-config.js` is expected to be public in frontend apps. Security is enforced by Authentication + Firestore Rules, not by hiding client config.
