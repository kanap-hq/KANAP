---
title: "Task Types Fast Track: Run, Build & Tasks"
description: Understand the different work item types in KANAP — incidents, problems, requests, projects, bugs, and tasks — and how to work with tasks day-to-day.
---

# Task Types Fast Track: Run, Build & Tasks

This guide explains the different types of work items tracked in KANAP and how to tell them apart. It covers the Run (keeping things running), the Build (making things better), and the transversal Task that bridges both. The second half is a practical cheat sheet for working with tasks every day.

!!! tip "Prefer a one-page summary? :material-file-pdf-box:"
    All the key definitions on a single A4 page — print it, pin it, share it with your team.

    [:material-download: Download the cheat sheet (PDF)](downloads/kanap-task-types-fast-track.pdf){ .md-button .md-button--primary }

---

## The Big Picture

Everything your IT department does falls into one of two categories — plus a universal work unit that crosses both:

| Category | Purpose | Work Items |
|----------|---------|------------|
| **Run** | Keep existing systems operational and secure | Incident, Problem |
| **Build** | Evolve and construct the IT landscape | Request, Project, Bug |
| **Transversal** | Atomic unit of work across Run and Build | Task |

---

## Run — Keeping the Lights On

Everyone participates in the Run. It ensures **operational continuity** (MCO) and **security maintenance** (MCS) of existing systems.

### Incident

An **unplanned interruption or degradation** of a production service.

- Has a significant impact on the functioning of the information system
- The objective is **service restoration** — get things working again, fast
- Reactive by nature: something broke, and users are affected

!!! example "Examples"
    - MES system outage
    - Unexpected VM restart
    - Company-wide VPN access failure

### Problem

A **root cause investigation** triggered by recurring incidents.

- Typically identified by IT after detecting a **pattern of similar incidents**
- The objective is a **permanent resolution** — fix the underlying cause, not just the symptoms
- Proactive: IT opens a Problem to prevent future incidents

!!! example "Examples"
    - Recurring internet access performance degradation
    - Repeated errors on a data interface

---

## Build — Evolving the Landscape

The Build covers all **evolutions and construction** of the information system. Everyone participates.

### Request (Change Request)

A **planned solicitation to modify** the information system.

- Can be technical, functional, originating from the business or from IT
- Rarely urgent
- Triggers a **validation workflow** and, if approved, becomes a Task or Project
- Meets at least one of these criteria:
    - Significant workload (>3 days)
    - Involves multiple IT or business teams
    - Requires significant change management effort

!!! example "Examples"
    - New field to synchronize between SAP and PLM
    - New line-of-business application
    - Remote site integration

### Project

A **coordinated set of tasks** organized around a defined objective, with a scope, timeline, budget, and identified deliverables.

- Same criteria as a Request — normally originates from an approved Request
- **Fast-track**: some projects are imposed without going through the Request stage (executive decision, urgent regulatory change...). They enter directly as a Project.

!!! example "Examples"
    - S4/HANA upgrade
    - Firewall migration

### Bug

A **defect found in a system under development**.

- Too complex to be handled within a simple ticket — requires in-depth analysis
- Strictly a Build concept: the system is not yet in production (or the defect is in a component still being built)

!!! example "Examples"
    - Insufficient access rights on a new SAP tile
    - Incorrect firewall rule in a new server deployment

!!! warning "Incident vs Bug"
    This is the most common confusion. The rule is simple:

    - **It's running in production and it breaks?** → **Incident** (Run)
    - **It's under construction and it doesn't work?** → **Bug** (Build)

    The distinction matters because Incidents prioritize **service restoration** while Bugs prioritize **root cause fix within the development cycle**.

---

## Transversal — The Task

Tasks are the **atomic unit of work** in KANAP. They cross the Run/Build boundary.

### Task

A **clearly scoped action** with a defined responsible person, status, and deadline.

- Can be **standalone** or linked to a **Project**, **OPEX line**, **Contract**, or **CAPEX line**
- Carries a concrete effort
- Impact on users or services is contained and well-understood
- Does not require coordination across multiple teams — even if it takes a long time, it remains carried by a single person without requiring cross-functional analysis

!!! example "Examples"
    - Install a new domain controller
    - Document the new Notilus to S4/HANA interface
    - Renew the SSL certificate on the intranet portal

!!! info "Task vs Request/Project"
    If the work meets **any** of these criteria, it's a Request (and potentially a Project), not a Task:

    - Significant workload (>3 days) **AND** involves cross-functional analysis
    - Requires coordination across multiple teams
    - Needs significant change management

    A Task can last 10 days if it's carried by one person with no particular cross-functional complexity.

---

## Summary Table

| Type | Category | Key Criterion | Example |
|------|----------|---------------|---------|
| **Incident** | Run | Unplanned interruption/degradation in production | MES outage |
| **Problem** | Run | Root cause of recurring incidents | Recurring internet performance issues |
| **Request** | Build | Planned SI modification (>3d / multi-team / change mgmt) | New SAP to PLM field |
| **Project** | Build | Coordinated set of tasks with scope, timeline, budget | S4/HANA upgrade |
| **Bug** | Build | Defect in a system under development | Incorrect firewall rule on new server |
| **Task** | Transversal | Scoped action, one owner, no multi-team coordination | Renew an SSL certificate |

---

## Working with Tasks — Cheat Sheet

The rest of this guide covers the practical essentials. For full detail, see [Tasks](../tasks.md).

### Where tasks live

| Context | What it means | Where to create |
|---------|---------------|-----------------|
| **Standalone** | Independent work, not linked to anything | **Portfolio > Tasks > New** |
| **Project** | Deliverable within a project | Project workspace **Tasks** tab, or **Timeline** phase shortcut |
| **OPEX** | Action tied to an OPEX line | Budget line workspace, **Tasks** panel on the **Overview** tab |
| **Contract** | Action tied to a contract | Contract workspace **Tasks** tab |
| **CAPEX** | Action tied to a CAPEX line | Budget line workspace, **Tasks** panel on the **Overview** tab |

All tasks appear in the central **Portfolio > Tasks** list regardless of context, so you always have one place to see everything.

### Statuses at a glance

| Status | Color | Meaning |
|--------|-------|---------|
| **Open** | Gray | Not started yet |
| **In Progress** | Orange | Someone is working on it |
| **Pending** | Blue | Blocked — waiting on input or a decision |
| **In Testing** | Purple | Implementation done, awaiting validation |
| **Done** | Green | Completed (requires logged time for project tasks) |
| **Cancelled** | Red | No longer needed |

### Priority levels

| Priority | When to use |
|----------|-------------|
| **Blocker** | Blocking other work — immediate attention |
| **High** | Important and time-sensitive |
| **Normal** | Standard priority (default) |
| **Low** | Can be deferred |
| **Optional** | Nice-to-have |

### The task workspace — key areas

When you open a task, you get a sidebar on the left and a main content area on the right.

**Sidebar sections**:

- **Context** — what the task is linked to (or Standalone)
- **Task Details** — type, priority, status
- **Classification** — Source, Category, Stream, Company (standalone and project tasks only; defaults from organization settings or parent project)
- **Time** — total time spent and Log Time button (standalone and project tasks only)
- **People** — requestor, assignee, viewers
- **Dates** — start and due dates
- **Knowledge** — link knowledge articles to the task

**Main content**:

- **Description** — a markdown editor with support for formatting, lists, code blocks, links, and pasted images
- **Import / Export** — import a `.docx` file into the description, or export it as PDF, DOCX, or ODT
- **Attachments** — drag-and-drop file uploads (up to 20 MB per file)
- **Activity** — Comments, History, and Time Log tabs

### Quick actions worth knowing

| Action | How |
|--------|-----|
| **Save** | Click **Save** or press **Ctrl+S** (Cmd+S on Mac) |
| **Convert to Request** | Header toolbar — promotes a task into a formal portfolio request when the scope grows |
| **Send link** | Header toolbar — email a link to colleagues or external contacts |
| **Log time inline** | In the Comments tab, combine a comment + status change + time entry in one submit |
| **Copy reference** | Click the reference chip (e.g., T-42) to copy it to your clipboard |

### What varies by context

Not every feature is available in every context. Here is what changes:

| Feature | Standalone | Project | OPEX / Contract / CAPEX |
|---------|:----------:|:-------:|:-----------------------:|
| Classification fields | Yes | Yes (defaults from project) | No |
| Time tracking | Yes | Yes (feeds project actuals) | No |
| Phase assignment | No | Yes | No |
| Priority score badge | Fixed by priority | Calculated from project + priority | Fixed by priority |
| Done requires time logged | No | Yes | No |

### Classification defaults

When you create a **standalone task**, KANAP pre-fills classification fields (Source, Category, Stream, Company) from your organization's default settings — saving you a few clicks. For **project tasks**, classification defaults come from the parent project but can be changed independently on each task.

---

## Customizing Task Types

All work item types are **configurable** in **Portfolio > Settings**. You can:

- **Add** new types to match your organization's processes
- **Disable** existing types you don't need
- **Rename** types to fit your terminology

The list in this guide is a starting point. Adapt it to how your IT department actually works.

---

## Where to Go Next

- [Tasks](../tasks.md) — full reference for statuses, CSV import/export, time tracking, and every workspace feature
- [Budget lines](../budget-lines.md): managing OPEX and CAPEX lines and their tasks
- [Contracts](../contracts.md) — managing contracts and their tasks
- [Portfolio Projects](../portfolio-projects.md) — project delivery, phases, effort tracking, and project-level tasks
- [Getting Started](getting-started.md) — if you're new to KANAP

!!! success "You're ready"
    You now understand how KANAP categorizes work and how to use tasks day-to-day. When in doubt about the right work item type, ask yourself: **is it keeping things running (Run), or making things better (Build)?** Then pick the matching type. For everything else, there's a Task.
