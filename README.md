# Visitor Flow

Visitor Flow is a Firebase-powered visitor management web app built with HTML, CSS, and JavaScript.

It supports a full visitor lifecycle from host invitation to admin approval, check-in, live monitoring, checkout, and CSV reporting.

## Core Flow (Start to End)

1. Staff sign in from `index.html` using Firebase Auth.
2. Role-based routing sends users to Host or Admin dashboard.
3. Host creates a pre-registration and gets a unique invitation code.
4. Visitor submits a request from `visitor.html` (with or without invite code).
5. Admin reviews pending requests and approves/rejects.
6. Approved visitors become checked in and appear in Currently Inside.
7. Parking is reserved/occupied/released automatically by workflow.
8. Admin checks visitor out, which updates logs, prereg status, and stats.
9. Logs remain searchable/sortable and can be exported to CSV.

## Highlights

- Role-based access: `host`, `management`, `admin`
- Public visitor request submission (no account needed)
- Host pre-registration with copyable invitation code panel
- Invitation code TTL (expires after configured window)
- Auto-fill visitor form from valid host invitation code
- Automatic name and vehicle formatting (name casing, uppercase plate)
- Dynamic parking slots loaded from Firestore (`P01` to `P14`)
- Preferred slot + automatic fallback assignment
- Pending request approval/rejection by admin
- Real-time admin dashboard updates using Firestore listeners
- Accurate inside/checked-out counters after checkout
- Overnight parking request support (shown as Yes/No)
- Vehicle-first display in Currently Inside, Parking, and Logs

## Tech Stack

- HTML
- CSS
- JavaScript (Vanilla)
- Firebase Authentication (Email/Password)
- Cloud Firestore

## Project Structure

- `index.html` - landing page, staff login, host registration prompt flow
- `visitor.html` - public visitor request form
- `host.html` - host pre-registration dashboard
- `admin.html` - admin/management dashboard
- `logs.html` - searchable visitor logs view
- `app.js` - main app logic (auth, Firestore, rendering, workflow)
- `styles.css` - UI styling and responsive layout
- `firebase-config.js` - Firebase client config
- `firestore.rules` - Firestore security rules
- `FIREBASE_SETUP.md` - Firebase setup guide

## Setup (Local)

1. Complete `FIREBASE_SETUP.md`.
2. Update `firebase-config.js` with your Firebase project credentials.
3. Ensure Firestore has role profiles under `users/{uid}`.
4. Run a local static server:

```powershell
python -m http.server 5500
```

5. Open `http://localhost:5500`.

## Deployment (GitHub Pages)

1. Push project to GitHub.
2. Open repository Settings -> Pages.
3. Configure:
	 - Source: Deploy from a branch
	 - Branch: `main` (or `master`)
	 - Folder: `/ (root)`
4. Save and wait for deployment.
5. Open the published site URL.

## Firestore Data Model

### 1) `users/{uid}`

Stores staff profile and role.

```json
{
	"role": "management",
	"name": "Security Team A",
	"unitNumber": "A-12-08",
	"phone": "0123456789",
	"createdAt": "serverTimestamp",
	"updatedAt": "serverTimestamp"
}
```

### 2) `visitor_requests/{requestId}`

Public visitor submissions waiting for admin action.

```json
{
	"inviteCode": "VF-AB12CD",
	"visitorName": "John Tan",
	"hostName": "A-12-08",
	"purpose": "delivery",
	"phone": "0123456789",
	"expectedDate": "2026-04-17",
	"expectedClock": "10:30",
	"expectedTime": "2026-04-17 10:30",
	"idNumber": "A1234567",
	"vehicleNo": "ABC1234",
	"parkingRequested": true,
	"preferredParkingSlot": "P03",
	"status": "pending",
	"source": "public",
	"createdAt": "serverTimestamp",
	"bookingTimestamp": "serverTimestamp"
}
```

### 3) `preregistrations/{visitCode}`

Host/admin pre-registration records (also used during approval/check-in state transitions).

```json
{
	"visitCode": "VF-AB12CD",
	"visitorName": "John Tan",
	"hostName": "A-12-08",
	"purpose": "delivery",
	"expectedDate": "2026-04-17",
	"expectedClock": "10:30",
	"expectedTime": "2026-04-17 10:30",
	"idNumber": "A1234567",
	"phone": "0123456789",
	"vehicleNo": "ABC1234",
	"parkingRequested": true,
	"overnightParkingRequested": false,
	"preferredParkingSlot": "P03",
	"parkingSlotId": "P03",
	"parkingSlotLabel": "P03",
	"parkingStatus": "reserved",
	"status": "pending",
	"expiresAt": "timestamp",
	"createdAt": "serverTimestamp",
	"bookingTimestamp": "serverTimestamp",
	"createdBy": "uid",
	"source": "host_prereg"
}
```

### 4) `visitor_logs/{visitCode}`

Operational check-in/check-out log records.

```json
{
	"visitCode": "VF-AB12CD",
	"visitorName": "John Tan",
	"hostName": "A-12-08",
	"purpose": "delivery",
	"vehicleNo": "ABC1234",
	"parkingRequested": true,
	"overnightParkingRequested": false,
	"parkingSlotId": "P03",
	"parkingSlotLabel": "P03",
	"parkingStatus": "occupied",
	"status": "inside",
	"source": "prereg",
	"checkedInAt": "serverTimestamp",
	"checkedOutAt": null,
	"checkedInBy": "uid",
	"checkedOutBy": ""
}
```

### 5) `parking_slots/{slotId}`

Parking slot master and occupancy state.

```json
{
	"slotNo": 1,
	"label": "P01",
	"status": "available",
	"assignedVisitCode": "",
	"updatedAt": "serverTimestamp",
	"releasedAt": "timestamp"
}
```

## Visit Code Behavior

- Codes are generated with format `VF-XXXXXX`.
- Characters exclude ambiguous ones for readability.
- Uniqueness check is performed against both:
	- `preregistrations/{visitCode}`
	- `visitor_logs/{visitCode}`
- If collision occurs, generation retries automatically.

## Parking Lifecycle

1. App seeds/maintains `P01` to `P14`.
2. Pre-registration can reserve a slot.
3. Check-in sets slot to occupied.
4. Checkout releases slot back to available.
5. If preferred slot is unavailable, auto-assign picks next available slot.

## Real-Time Behavior

Admin dashboard uses Firestore snapshot listeners for live updates in:

- Pending Visitor Requests
- Pre-registration-derived summaries
- Visitor Logs
- Currently Inside and stats rendering

No manual browser refresh is required for normal admin monitoring.

## Firestore Rules Expectations

This project expects rules that allow:

- Public create for `visitor_requests`
- Controlled read/write by authenticated staff roles
- Management/admin write for approval, check-in, checkout flows
- Secure access to parking and logs based on role

Publish `firestore.rules` before production use.

## QA Checklist

- Role login routes to the correct dashboard
- Host registration creates Auth + Firestore user profile
- Host pre-registration produces a valid invitation code
- Visitor invite-code auto-fill works for valid active code
- Pending requests appear and can be approved/rejected
- Approved request appears in Currently Inside immediately
- Checkout removes visitor from Currently Inside
- Inside now decreases and Checked out increases correctly
- Parking status transitions are reflected in Firestore
- Logs show vehicle number (not invitation code)
- CSV export contains complete records

## Troubleshooting

- Permission denied
	- Re-publish `firestore.rules`
	- Verify `users/{uid}.role` exists and is valid
- Wrong page after login
	- Validate role value in `users/{uid}`
- No parking slot assigned
	- Confirm `parking_slots` contains `P01` to `P14`
	- Ensure at least one slot is `available`
- Invitation code rejected
	- Check code format and expiry window
	- Confirm code exists in `preregistrations`

## Security Note

`firebase-config.js` is public in client-side Firebase apps by design.

Security is enforced by Firebase Authentication + Firestore Rules, not by hiding frontend config.
