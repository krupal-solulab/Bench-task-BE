# Demo Walkthrough Script

A step-by-step script for the recorded demo the brief asks for (§9 Deliverables: "Short demo (Loom/
screen recording) or a live walkthrough covering auth, role differences, task flow, and the
dashboard"). Read this while recording, or use it as a live-walkthrough checklist — each step names
exactly what to click/type and what to say. Total run time: roughly 8–10 minutes.

**Before you start recording:**
- Both apps running locally: backend (`npm run start:dev`, port 3000) and frontend (`npm run dev`,
  port 5173), or the deployed URLs if you're demoing the hosted version.
- Fresh browser profile or an incognito window, so you start logged out.
- Have this checklist open on a second screen/window.

---

## 1. Introduction (30s)

> "This is a Jira/Trello-style Project & Task Management system — a NestJS/MongoDB/Redis backend
> and a React frontend. It's multi-tenant: every company gets its own isolated organization, plus a
> separate Platform Admin tier that manages organizations themselves. I'll walk through
> registration, the role differences, the task workflow, the dashboard, and the Platform Admin area."

## 2. Self-service organization registration (1 min)

1. Open the app at `/register`.
2. Fill in: Organization name, your name, email, password.
3. Submit — point out you're immediately logged in and landed on the dashboard.

> "Registering doesn't just create a user — it creates a brand-new organization, and you become
> that organization's Admin automatically. There's no separate 'sign up as an employee' path
> anymore — an org's other users are added by that org's own Admin, which I'll show next."

## 3. Role differences: Admin creates a Manager and a Developer (1.5 min)

1. As the Admin you just registered, go to **Admin → Users** (sidebar).
2. Create a user with role **Manager** (note the role dropdown only ever offers Admin/Manager/
   Developer — never "Platform Admin", even though that role exists in the system).
3. Create a second user with role **Developer**.

> "Only an Admin can create users and assign roles. Notice the role picker never shows Platform
> Admin as an option — that's a completely separate tier, on purpose, which I'll come back to."

## 4. Task flow: project → task → status → comment (3 min)

1. Go to **Projects → New Project**. Create one, add the Manager as owner if prompted, add the
   Developer as a member.
2. Open the project, add a task (any priority), assign it to the Developer.
3. **Log out, log back in as the Manager.** Show the Manager can see/manage this project (it's
   theirs) but — open a second incognito tab and log in as a Developer from a *different* project if
   you have one, or just narrate: "a Manager only manages their own projects, an Admin manages
   every project in the org."
4. **Log out, log back in as the Developer.** Open the task, change its status Todo → In Progress →
   Review → Done. Add a comment on the task.
5. Point out the Developer **cannot** create projects or delete tasks (nav items are hidden, and if
   you want to prove the API itself gates it, open dev tools and show a direct `DELETE /tasks/:id`
   call as the Developer returning 403).

> "Status changes, comments, and viewing are the Developer's job; creating/deleting projects and
> tasks is Admin/Manager only — enforced both in the UI and, more importantly, at the API layer."

## 5. Dashboard (1.5 min)

1. Log back in as the Admin.
2. Go to **Dashboard**. Walk through: the stat cards, projects-by-status chart, tasks-by-priority
   chart, developer workload chart, overdue tasks.
3. Refresh the page once and mention: "these numbers are cached in Redis for a minute — refreshing
   right away serves the cached version; the response includes an `X-Cache: HIT` header to prove it."

## 6. Platform Admin: organization management (2 min)

1. Log out. Log in as the seeded Platform Admin (`PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`
   from your `.env`).
2. Point out you land on **/platform/organizations**, not the regular dashboard — a completely
   different app shell (different sidebar, no Projects/Tasks/Dashboard nav at all).
3. Click **New Organization** — create one, with its own Admin.
4. Open that organization's detail page. Show **Suspend** — toggle it to Suspended.
5. Switch to that new org's Admin (or narrate it): a suspended org's users are logged out
   immediately and can't log back in until reactivated.
6. Reactivate the organization.
7. Try navigating to `/dashboard` or `/projects` as the Platform Admin — show the 403/redirect,
   proving the Platform Admin genuinely cannot see any organization's project/task data, even their
   own newly-created one.

> "That's the core boundary: a Platform Admin manages organizations, never their content; an
> Organisation Admin manages their org's content, never another org's, and never the platform
> itself. Both directions are enforced at the API, not just hidden in the UI."

## 7. Close (15s)

> "That covers auth, the role hierarchy including the platform/org split, the task lifecycle, the
> dashboard, and organization management. Thanks for watching."

---

**If recording with Loom/OBS:** aim for one continuous take following this script top to bottom;
re-record a section rather than trying to edit mid-video. Save the link and add it to the root
README under a new "Demo" heading (or wherever your team tracks it) once it's up.
