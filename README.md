# Visitor Flow

Visitor Flow is a Firebase-powered visitor management web app built with HTML, CSS, and JavaScript.

It is designed for static deployment (for example, GitHub Pages) while using Firebase Auth + Firestore for all live data.

## Features

- Staff sign-in with role-based routing (`host`, `management`, `admin`)
- Public visitor request form (no account required)
- Host pre-registration with generated visit code
- Management check-in by visit code
- Management manual walk-in check-in
- Optional preferred parking slot selection (`P01` to `P14`)
- Automatic parking assignment fallback when preferred slot is unavailable
- Parking lifecycle persisted in Firestore (`available`, `reserved`, `occupied`, `released`)
- Live visitor logs with search and sort
- Admin summary insights and CSV export

## Tech Stack

- HTML
- CSS
- JavaScript
- Firebase Authentication (Email/Password)
- Cloud Firestore

## Project Structure

- `index.html` - landing page for staff sign-in + visitor entry
- `visitor.html` - public visitor request form
- `host.html` - host pre-registration dashboard
- `admin.html` - management/admin operations dashboard
- `logs.html` - searchable visitor logs page
- `app.js` - app logic (auth, Firestore CRUD, rendering, parking flow)
- `styles.css` - UI and responsive styling
- `firebase-config.js` - Firebase client config
- `firestore.rules` - Firestore security rules
- `FIREBASE_SETUP.md` - setup guide

## Local Setup

1. Complete `FIREBASE_SETUP.md`.
2. Update `firebase-config.js` with your Firebase project values.
3. Ensure Firestore has role docs for staff accounts at `users/{uid}`.
4. Run a local static server:

```powershell
python -m http.server 5500
```

5. Open `http://localhost:5500`.

## GitHub Pages Deployment

1. Push this project to a GitHub repository.
2. Open repository `Settings` -> `Pages`.
3. Set:
- `Source`: Deploy from a branch
- `Branch`: `main` (or `master`)
- `Folder`: `/ (root)`
4. Save and wait for deployment.
5. Open your published Pages URL.

## Firestore Data Model

### 1) `users/{uid}`

Staff user profile and role.

```json
{
	"role": "management",
	"displayName": "Security Team A",
	"status": "active",
	"createdAt": "serverTimestamp"
}
```

Supported role values:
- `host`
- `management`
- `admin` (legacy-compatible route to admin dashboard)

### 2) `visitor_requests/{requestId}`

Public visitor submissions.

```json
{
	"visitorName": "John Tan",
	"hostName": "Unit A-12-08",
	"purpose": "Delivery",
	"phone": "0123456789",
	"expectedDate": "2026-04-17",
	"expectedClock": "10:30",
	"expectedTime": "2026-04-17 10:30",
	"idNumber": "A1234567",
	"vehicleNo": "ABC1234",
	"preferredParkingSlot": "P03",
	"status": "pending",
	"source": "public",
	"createdAt": "serverTimestamp"
}
```

### 3) `preregistrations/{visitCode}`

Host-created pre-registration entries.

```json
{
	"visitCode": "VF-AB12CD",
	"visitorName": "John Tan",
	"hostName": "Unit A-12-08",
	"purpose": "Delivery",
	"expectedDate": "2026-04-17",
	"expectedClock": "10:30",
	"expectedTime": "2026-04-17 10:30",
	"idNumber": "A1234567",
	"phone": "0123456789",
	"vehicleNo": "ABC1234",
	"preferredParkingSlot": "P03",
	"parkingSlotId": "P03",
	"parkingSlotLabel": "P03",
	"parkingStatus": "reserved",
	"status": "pending",
	"createdAt": "serverTimestamp",
	"createdBy": "uid"
}
```

### 4) `visitor_logs/{visitCode}`

Actual check-in/check-out records.

```json
{
	"visitCode": "VF-AB12CD",
	"visitorName": "John Tan",
	"hostName": "Unit A-12-08",
	"purpose": "Delivery",
	"source": "prereg",
	"status": "inside",
	"preferredParkingSlot": "P03",
	"parkingSlotId": "P03",
	"parkingSlotLabel": "P03",
	"parkingStatus": "occupied",
	"checkedInAt": "serverTimestamp",
	"checkedOutAt": null
}
```

### 5) `parking_slots/{slotId}`

Parking slot master records (`P01` to `P14`).

```json
{
	"slotNo": 1,
	"label": "P01",
	"status": "available",
	"assignedVisitCode": "",
	"updatedAt": "serverTimestamp"
}
```

## Parking Logic

1. The app ensures 14 slots exist (`P01` to `P14`).
2. If a preferred slot is provided and available, that slot is assigned.
3. If preferred slot is unavailable, the next available slot is auto-assigned.
4. Slot status transitions:
- `available` -> `reserved` (pre-registration)
- `reserved` -> `occupied` (check-in)
- `occupied` -> `available` (checkout/delete)

## Required Firebase Rules

This project expects:
- Public create access for `visitor_requests`
- Authenticated read for logs/prereg/parking
- Management/host write access for prereg + parking
- Management write access for logs

Publish `firestore.rules` before production use.

## Verification Checklist

- Staff login routes to correct page by role
- Visitor request can be submitted without login
- Host pre-registration generates a visit code
- Management check-in by code creates/upgrades log record
- Parking slot is reserved/occupied/released correctly in Firestore
- Logs display parking slot and status
- CSV export includes parking columns

## Troubleshooting

- `Permission denied`:
	- Re-publish `firestore.rules`
	- Verify `users/{uid}.role` exists and is valid
- Login redirects incorrectly:
	- Check role value in `users/{uid}`
- No parking assigned:
	- Ensure `parking_slots` contains `P01` to `P14`
	- Ensure at least one slot has `status: "available"`

## Security Note

`firebase-config.js` is public by design for client-side Firebase apps. Actual security is enforced by Firebase Authentication and Firestore Rules.
