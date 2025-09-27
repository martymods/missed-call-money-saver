# Teams, Roles, and Warehouse Missions API

The `/api/teams` routes let account holders organize warehouse crews, assign
responsibilities, manage payroll preferences, and spin up gig-style missions
that can be funded through Stripe/Apple Pay. All routes require an authenticated
session (the same JWT + session cookie that `/api/users` issues).

## Create a team

```
POST /api/teams
```

Body:

```json
{
  "name": "Inbound Stars",
  "description": "Receiving + cycle counts",
  "payroll": {
    "payThroughPlatform": true,
    "defaultProvider": "stripe",
    "platformCutPercent": 12.5
  }
}
```

Returns the created team plus the leader's membership record. The caller is
marked as `leader` with all privileges.

## List teams for the current user

```
GET /api/teams
```

Returns `[{ team, membership }]` for each roster the user belongs to.

## Team detail

```
GET /api/teams/:teamId
```

Returns the team, members (with user profile metadata), invites, active gigs,
and recent shifts.

## Invite teammates

```
POST /api/teams/:teamId/invite
```

Leader/manager only. Body accepts:

```json
{
  "email": "alicia@example.com",
  "role": "floor lead",
  "responsibilities": ["Cycle counts", "Shift huddles"],
  "privileges": ["assign_roles", "manage_gigs"]
}
```

Invites are stored until the recipient (matching email) accepts via
`POST /api/teams/invites/:token/accept`.

## Manage roles & payroll

```
POST /api/teams/:teamId/members/:memberId/roles
POST /api/teams/:teamId/members/:memberId/payroll
```

Leaders can set titles, privileges, and pay preferences (Stripe / Apple Pay /
manual; hourly vs per-service).

## Clock-in / clock-out

```
POST /api/teams/:teamId/clock-in
POST /api/teams/:teamId/clock-out
GET  /api/teams/:teamId/shifts
```

Members track shifts which are stored in `team_shifts` with minute totals.

## Freelance "mission" board

```
POST /api/teams/:teamId/gigs
GET  /api/teams/:teamId/gigs
POST /api/teams/:teamId/gigs/:gigId/apply
POST /api/teams/:teamId/gigs/:gigId/assign
POST /api/teams/:teamId/gigs/:gigId/release
```

Leaders post missions with rates and optional escrow. When `escrowAmount` is
sent and Stripe is configured, a manual-capture PaymentIntent is generated. Once
leader and freelancer confirm completion the funds are captured and marked as
released (the platform cut is recorded in the gig payload).

All data persists in MongoDB if configured, or falls back to JSON files in
`data/mongo-fallback` for local demos.
