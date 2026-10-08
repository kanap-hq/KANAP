---
title: "Getting Started: Your First 10 Minutes in KANAP"
description: A quick onboarding guide for all users. Dashboard, profile, tasks, notifications, and key concepts to feel at home fast.
---

# Getting Started: Your First 10 Minutes in KANAP

Welcome to KANAP. This guide walks you through everything you need to feel productive on day one — regardless of your role. No admin knowledge required, no module-specific deep dives. Just the essentials to get comfortable.

!!! tip "Prefer a one-page summary? :material-file-pdf-box:"
    All the key steps on a single A4 page — print it, pin it, share it with your team.

    [:material-download: Download the cheat sheet (PDF)](downloads/kanap-getting-started.pdf){ .md-button .md-button--primary }

For role-specific workflows, see the [Portfolio Fast Track](index.md) and [IT Ops Fast Track](apps-and-assets.md).

---

## The Big Picture

KANAP is organized around a simple structure. The top bar shows the sections you have access to:

| Area | What it contains |
|------|-----------------|
| **Dashboard** | Your personal hub — click the KANAP logo or navigate to `/` |
| **Portfolio** | Tasks, Requests, Projects, Planning, Reporting, Contributors |
| **IT Landscape** | Applications, Interfaces, Interface Map, Assets, Connections, Connection Map, Locations |
| **Knowledge** | Documents and templates with review workflows |
| **Budget Management** | OPEX, CAPEX, Contracts, Reporting, Administration (currencies, budget columns, freeze and copy operations) |
| **Master Data** | Companies, Departments, Cost centers, Suppliers, Contacts, Charts of Accounts, Working-day calendars, Analytics Dimensions, Business Processes |
| **Admin** | Users, Roles, Audit Log, Billing, Authentication, Branding (admin-only) |

You don't need access to everything. Your role determines which sections and actions are available to you. If something is missing from your menu, ask your administrator.

---

## Step 1: Explore Your Dashboard

After logging in, you land on the **Dashboard**. This is your personal command center.

### What you'll see

A grid of tiles, each showing a different aspect of your work. Here are the most common ones:

| Tile | What it shows |
|------|--------------|
| **My Tasks** | Your assigned tasks, grouped by urgency (Overdue, Due This Week, Later) |
| **Projects I Lead** | Projects where you're IT Lead, Business Lead, or Sponsor |
| **Projects I Contribute To** | Projects where you're a team member |
| **My Time Last Week** | Hours logged, breakdown by category, top projects |
| **Recently Viewed** | Items you recently opened across the app |
| **New Requests** | Portfolio requests created recently |
| **Knowledge** | Documents awaiting your review, plus your recently accessed docs |
| **Team Activity** | Recent project activity on projects you're involved with |
| **Project Status Changes** | Latest project status changes |
| **Stale Tasks** | Tasks that haven't been updated in a while |

### Quick Actions

At the top of the dashboard, you'll find shortcut buttons for common actions:

- **Create Task** — open a quick dialog to create a task without leaving the dashboard
- **Log Time** — log hours against a project in seconds
- **New Document** — start a blank Knowledge document or create one from a template

### Customize it

Click the **Settings** icon (gear) to choose which tiles appear. Only tiles you have permission to view are shown. Start with the defaults for a few days, then adjust to your needs.

!!! tip "Make it yours"
    The dashboard is designed to answer "what should I focus on today?" at a glance. If a tile isn't useful to you, hide it. If you're missing something, check the gear icon — it might just be disabled.

---

## Step 2: Set Up Your Profile

Click your **avatar** (top-right) → **My Profile**, or navigate to `/settings/profile`.

### Profile tab

Update your personal information:

- **First Name** / **Last Name**
- **Job Title**
- **Business Phone** / **Mobile Phone**

!!! info "SSO users"
    If your organization uses Microsoft Entra ID (SSO), some fields are synced automatically and can't be edited in KANAP.

### Notifications tab

Control which email notifications you receive. The master toggle at the top turns all notifications on or off.

You can fine-tune notifications by workspace:

| Workspace | What you can toggle |
|-----------|-------------------|
| **Portfolio** | Status changes, team additions, team changes on items you lead, comments |
| **Tasks** | Assignment notifications (as assignee, requestor, or viewer), status changes, comments |
| **Budget** | Expiration warnings, status changes, comments |

### The Weekly Review Email

This is a periodic summary of your activity and upcoming items — like a personal digest.

Configure it in the Notifications tab:

| Setting | What to set |
|---------|------------|
| **Day** | Which day of the week (e.g., Monday) |
| **Time** | What hour (in your timezone) |
| **Timezone** | Your local timezone |

Click **Preview email** to send yourself a test and see what it looks like.

!!! tip "Don't skip this"
    The weekly email is surprisingly useful. It surfaces tasks you might have forgotten, upcoming deadlines, and recent activity. Set it up once and let it work for you.

### Appearance tab

Choose your preferred theme mode:

- **Light** — bright interface
- **Dark** — reduced glare for low-light environments
- **System** — follows your operating system preference

You can also toggle the theme quickly from the top bar using the theme icon (sun/moon) next to the help button.

---

## Step 3: Understand Scope Filters

This is the single most important concept for new users. Every major list in KANAP (Tasks, Apps, Projects, Requests) has a **scope filter** at the top:

| Scope | What it shows |
|-------|--------------|
| **My [items]** | Items where you are directly assigned (owner, assignee, lead…) |
| **My Team's [items]** | Items owned or assigned to anyone on your Portfolio team |
| **All [items]** | Everything in the organization |

### Why this matters

The Tasks page opens on "All Tasks", so you see the full picture. Choose "My Tasks" to narrow the list to tasks assigned to you or created by you.

The scope filter **remembers your last selection** across sessions. So if you switch to "My Tasks", it stays on "My Tasks" next time you visit.

!!! warning "No team = no 'My Team's' filter"
    The "My Team's" option only works if you've been assigned to a Portfolio team via the Contributors page. If it's grayed out, ask your admin or project manager to set up your Contributor profile.

### Where scope filters appear

- **Portfolio → Tasks** — My Tasks / My Team's Tasks / All Tasks
- **IT Landscape → Applications** — My Apps / My Team's Apps / All Apps
- **Portfolio → Projects** — My Projects / My Team's Projects / All Projects
- **Portfolio → Requests** — My Requests / My Team's Requests / All Requests

The logic is always the same: ownership and team assignment determine what you see.

---

## Step 4: Work With Tasks

Tasks are your daily workhorse. They track action items, deliverables, follow-ups, and anything that needs doing.

### Find your tasks

Navigate to **Portfolio → Tasks**. The page opens on **All Tasks**. Choose **My Tasks** to see the items assigned to you or created by you, sorted by priority score.

### Create a task

Two ways:

1. **From the Dashboard** — click **Create Task** (quick dialog, minimal fields)
2. **From the Tasks page** — click **New** (full workspace with all options)

The minimum you need:

| Field | What to enter |
|-------|--------------|
| **Title** | What needs to be done |
| **Assignee** | Who's responsible (defaults to you) |
| **Due Date** | When it's needed |

### Link tasks to projects, contracts, or budgets

When creating a task, you can link it to a **Project**, **OPEX item**, **Contract**, or **CAPEX item**. This makes the task appear in both the Tasks list and the parent workspace.

!!! tip "Create from context"
    The fastest way to create a linked task is from within the parent workspace. Open a project → Tasks tab → New. The link is pre-filled.

### Track progress

Move tasks through statuses as work advances:

| Status | When to use |
|--------|------------|
| **Open** | Not started yet (default) |
| **In Progress** | Work has begun |
| **Done** | Completed (requires time logged for project tasks) |
| **Cancelled** | No longer needed |

### Log time

For project tasks, time logging is essential — it feeds the roadmap generator and capacity planning.

1. Open the task → click **Log Time** in the sidebar
2. Choose category: **IT** or **Business**
3. Enter the date, hours, and optional notes

### Share a task

Need to loop someone in? Click **Send Link** in the task header to email a direct link to any colleague — even people outside KANAP. Add a personal message if needed.

!!! info "Send Link works everywhere"
    This isn't just for tasks. You can send links to projects, requests, contracts, apps — any workspace object. It's the fastest way to point someone to the right place.

---

## Step 5: Set Up Your Contributor Profile

Your Contributor profile tells KANAP who you are in terms of project planning. It's separate from your user account — it's about **team, availability, and skills**.

Navigate to **Portfolio → Contributors** and find your name (or ask your admin to add you).

### What to configure

| Setting | What it does | Example |
|---------|-------------|---------|
| **Team** | Your organizational team | Infrastructure, Service Desk… |
| **Availability** | Days per month for project work (0–20) | 8 days/month |
| **Skills** | What you know and how well | "Docker — Autonomous" |

### Why this matters

- **Team** → enables the "My Team's" scope filters across the app
- **Availability** → feeds the roadmap generator and capacity heatmaps
- **Skills** → helps project managers find the right people for upcoming work

!!! tip "Be realistic with availability"
    Account for meetings, BAU work, and holidays. Most people have less project time than they think. Setting 20 days/month means you have zero non-project time — that's almost never true.

### Skills proficiency

Each skill has a proficiency level:

| Level | Meaning |
|-------|---------|
| 0 | No knowledge |
| 1 | Basic / Theoretical |
| 2 | Can execute with support |
| 3 | Autonomous |
| 4 | Expert — can mentor others |

Be honest. A realistic skills map is far more useful than one where everyone is an "expert".

---

## How It All Connects

Everything you set up in these first 10 minutes feeds into the bigger picture:

### Your Dashboard
Tiles pull from your task assignments, project roles, and time logs to give you a personalized overview every morning.

### Scope Filters
Your ownership assignments and team membership determine what surfaces in every list — making the app feel personal, not overwhelming.

### Capacity Planning
Your availability and time logs feed into the Portfolio module's roadmap generator and capacity heatmaps. Accurate data here means better planning for everyone.

### Notifications
The weekly email and real-time notifications keep you in the loop without checking the app constantly.

### Want to go further?

| If you work with… | Read the… |
|-------------------|-----------|
| Applications, servers, infrastructure | [IT Ops Fast Track](apps-and-assets.md) |
| Requests, projects, portfolio planning | [Portfolio Fast Track](index.md) |

---

## Quick Reference

| I want to… | Go to… |
|------------|--------|
| See my overview | Dashboard (click KANAP logo) |
| Create a task quickly | Dashboard → Create Task button |
| Log time quickly | Dashboard → Log Time button |
| Start a new document | Dashboard → New Document button |
| See all my tasks | Portfolio → Tasks (scope: My Tasks) |
| See everything in the org | Any list → scope filter → "All" |
| Update my profile | Avatar → My Profile → Profile tab |
| Set up notifications | Avatar → My Profile → Notifications tab |
| Configure weekly email | Avatar → My Profile → Notifications tab → Weekly Review |
| Change theme (light/dark) | Avatar → My Profile → Appearance tab |
| Set my availability | Portfolio → Contributors → your name |
| Add my skills | Portfolio → Contributors → your name → Skills tab |
| Share a link to anything | Open any workspace → Send Link |
| Customize my dashboard | Dashboard → Settings (gear icon) |

---

!!! success "You're ready"
    You now know how to navigate KANAP, manage your tasks, configure your profile and notifications, and set up your contributor profile. Start with your dashboard each morning, keep your tasks updated, and log time regularly — the rest will follow naturally.
