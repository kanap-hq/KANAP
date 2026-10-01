#!/usr/bin/env python3
"""Build KANAP fast-track cheat sheets as compact A4 PDFs."""

from weasyprint import HTML
from pathlib import Path

OUT = Path(__file__).parent / "output"
OUT.mkdir(exist_ok=True)

CSS = """
@page {
    size: A4;
    margin: 8mm 10mm;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 8pt;
    line-height: 1.3;
    color: #1a1a1a;
}
h1 {
    font-size: 13pt;
    color: #1e3a5f;
    border-bottom: 2.5pt solid #1e3a5f;
    padding-bottom: 3pt;
    margin-bottom: 5pt;
}
h2 {
    font-size: 9.5pt;
    color: #1e3a5f;
    margin-top: 6pt;
    margin-bottom: 2pt;
}
h3 {
    font-size: 8.5pt;
    color: #2a5a8a;
    margin-top: 4pt;
    margin-bottom: 1.5pt;
}
p { margin-bottom: 2pt; }
ul { padding-left: 12pt; margin-bottom: 2pt; }
li { margin-bottom: 1pt; }
table {
    width: 100%;
    border-collapse: collapse;
    margin: 3pt 0;
    font-size: 7.5pt;
}
th, td {
    border: 0.4pt solid #bbb;
    padding: 2pt 4pt;
}
th {
    background: #1e3a5f;
    color: white;
    font-weight: 600;
}
tr:nth-child(even) td { background: #f5f7fa; }
.box {
    background: #e8f0fe;
    border-left: 2.5pt solid #1e3a5f;
    padding: 3pt 5pt;
    margin: 3pt 0;
    font-size: 7.5pt;
}
.box-warn {
    background: #fff3e0;
    border-left-color: #e65100;
}
.box-tip {
    background: #e6f4ea;
    border-left-color: #34a853;
}
.chain {
    text-align: center;
    font-size: 10pt;
    font-weight: bold;
    color: #1e3a5f;
    margin: 5pt 0;
}
.cols { column-count: 2; column-gap: 12pt; }
.nb { break-inside: avoid; }
.pb { break-before: page; }
.sub { font-size: 8pt; color: #555; margin-bottom: 4pt; }
.foot {
    margin-top: 6pt;
    padding-top: 3pt;
    border-top: 0.4pt solid #ccc;
    font-size: 6.5pt;
    color: #999;
    text-align: center;
}
.foot a {
    color: #1e3a5f;
    text-decoration: none;
}
"""

# ── IT OPS ──
itops = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>

<h1>🖥️ IT ops: from application to server</h1>
<p class="sub">KANAP cheat sheet</p>
<div class="chain">Application → Deployment (environment) → Server (asset)</div>

<div class="cols">

<div class="nb">
<h2>① Create your application</h2>
<p><b>IT landscape → Applications → New app / service</b></p>
<table>
<tr><th>Field</th><th>What to enter</th><th>Example</th></tr>
<tr><td>Name</td><td>Clear, recognizable name</td><td>Salesforce CRM</td></tr>
<tr><td>Category</td><td>Primary purpose</td><td>Line-of-business</td></tr>
<tr><td>Supplier</td><td>Supplier (from master data)</td><td>Salesforce Inc</td></tr>
<tr><td>Business criticality</td><td>A level your organization defined</td><td>Critical</td></tr>
<tr><td>Lifecycle</td><td>Current status</td><td>Active</td></tr>
</table>
<div class="box box-tip">💡 Description, version, publisher, licensing: all useful, all optional at this stage. Get the app in first. You can add the rest later.</div>
</div>

<div class="nb">
<h2>② Add deployments (environments)</h2>
<p>Open your app → <b>Deployments</b> tab → <b>Add deployment</b></p>
<ul>
<li>Choose the environment: <b>Prod</b>, Pre-prod, QA, Test, Dev, Sandbox</li>
<li>Set lifecycle, base URL, SSO enabled, MFA supported</li>
<li>Add notes for context (e.g. "Primary EU instance")</li>
</ul>
<div class="box box-tip">💡 Each environment can be added once per app. Repeat <b>Add deployment</b> for QA, Dev and the others.</div>
</div>

<div class="nb">
<h2>③ Assign owners</h2>
<p>Open app → <b>Properties</b> panel (right side)</p>
<ul>
<li><b>Business owners</b>: stakeholders accountable for the application</li>
<li><b>IT owners</b>: the technical team in charge of operations and support</li>
<li><b>Audience</b>: the companies and departments that use the app. KANAP derives the user count from master data.</li>
</ul>
<div class="box box-warn">⚠️ <b>Owners = communication.</b> Planned maintenance, outages, upgrades, license renewals: you need to reach the right people fast. Owners also drive the "My apps" and "My team's apps" filters. No owner means nobody feels responsible.</div>
</div>

<div class="nb">
<h2>④ Operations and compliance</h2>
<p><b>Operations</b> tab</p>
<ul>
<li>Access methods: 🌐 Web · 💻 Locally installed · 📱 Mobile · 🖥️ VDI / Remote desktop · ⌨️ Terminal / CLI · 🏭 HMI · 🖧 Kiosk</li>
<li>External facing? Data integration / ETL?</li>
<li>Support contacts and support notes</li>
</ul>
<p><b>Compliance</b> tab</p>
<table>
<tr><th>Field</th><th>Example</th></tr>
<tr><td>Data confidentiality</td><td>Confidential</td></tr>
<tr><td>Contains personal data</td><td>Yes</td></tr>
<tr><td>Data residency</td><td>France, Germany</td></tr>
<tr><td>Last recovery test</td><td>2026-05-15</td></tr>
</table>
<div class="box">ℹ️ Confidentiality levels, criticality levels and access methods are set in <b>IT landscape settings</b> (IT landscape → Settings).</div>
</div>

<div class="nb">
<h2>⑤ Link relations</h2>
<p>Open app → <b>Relations</b> tab. Connect the app to the rest of your IT data:</p>
<table>
<tr><th>Link</th><th>Why</th></tr>
<tr><td>OPEX items</td><td>Recurring costs (licenses, SaaS fees)</td></tr>
<tr><td>CAPEX items</td><td>Investment tracking</td></tr>
<tr><td>Contracts</td><td>Supplier agreements, renewal dates</td></tr>
<tr><td>Relevant websites</td><td>Documentation, wikis, runbooks</td></tr>
</table>
<div class="box box-tip">💡 Relations help, but nothing depends on them. Add them when you have the data.</div>
</div>

<div class="nb">
<h2>⑥ Create your server (asset)</h2>
<p><b>IT landscape → Assets → Add asset</b></p>
<table>
<tr><th>Field</th><th>What to enter</th><th>Example</th></tr>
<tr><td>Name</td><td>Hostname or identifier</td><td>PROD-WEB-01</td></tr>
<tr><td>Asset type</td><td>Server type</td><td>Virtual Machine</td></tr>
<tr><td>Location</td><td>Where it is hosted</td><td>Paris datacenter</td></tr>
<tr><td>Lifecycle</td><td>Current status</td><td>Active</td></tr>
</table>
<div class="box">ℹ️ <b>Location is the key.</b> Hosting type, provider, country and city come from it. Set up locations once in IT landscape → Locations.</div>
<p><b>Technical tab, Identity:</b> Hostname, Domain, FQDN (computed), Aliases, Operating system.</p>
<p><b>Technical tab, IP addresses:</b> use <b>Add IP address</b> for each one (host, management, backup network…). Each has its own type and subnet. Network zone and VLAN come from the subnet.</p>
</div>

<div class="nb">
<h2>⑦ Link server ↔ application</h2>
<p><b>From the app:</b> Deployments tab → <b>Add server</b> on the deployment card → choose the asset → set the role (e.g. Web server).</p>
<p><b>From the asset:</b> Overview tab → <b>Assignments</b> section → <b>Add assignment</b> → choose application, environment, role and since date.</p>
<div class="chain" style="font-size:9pt; margin: 4pt 0;">Salesforce CRM → Prod → PROD-WEB-01 ✅</div>
</div>

<div class="nb">
<h2>The bigger picture</h2>
<p><b>Application landscape</b>: a live register of every app with its deployments, criticality, hosting and owners. Filter on any attribute.</p>
<p><b>Infrastructure mapping</b>: which servers support this critical app? What is affected if a server goes down? How many apps run in each datacenter?</p>
<p><b>Connection map</b>: see network flows and dependencies between servers.</p>
<p><b>Interfaces and interface map</b>: document data flows between applications (protocols, direction, middleware) and see the full application architecture.</p>
<p><b>Compliance</b>: data confidentiality, personal data and residency are recorded per app and can be reviewed. Ready for the auditor.</p>
</div>

<div class="nb">
<h2>Quick reference</h2>
<table>
<tr><th>I want to…</th><th>Go to…</th></tr>
<tr><td>Create an application</td><td>IT landscape → Applications → New app / service</td></tr>
<tr><td>Add environments</td><td>App → Deployments tab → Add deployment</td></tr>
<tr><td>Assign owners</td><td>App → Properties panel</td></tr>
<tr><td>Set access methods</td><td>App → Operations tab</td></tr>
<tr><td>Link budgets / contracts</td><td>App → Relations tab</td></tr>
<tr><td>Add compliance info</td><td>App → Compliance tab</td></tr>
<tr><td>Create a server</td><td>IT landscape → Assets → Add asset</td></tr>
<tr><td>Link server ↔ app</td><td>Deployment card → Add server <i>or</i> Asset → Overview → Assignments</td></tr>
<tr><td>View the connection map</td><td>IT landscape → Connection map</td></tr>
<tr><td>View the interface map</td><td>IT landscape → Interface map</td></tr>
<tr><td>Configure dropdowns</td><td>IT landscape → Settings</td></tr>
</table>
</div>

</div>

<div class="foot">KANAP &nbsp;|&nbsp; IT department management &nbsp;|&nbsp; <a href="https://kanap.net">kanap.net</a> &nbsp;|&nbsp; <a href="https://doc.kanap.net">doc.kanap.net</a></div>
</body></html>"""

# ── PORTFOLIO ──
portfolio = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>

<h1>📋 Portfolio — From Request to Delivery</h1>
<p class="sub">KANAP Cheat Sheet</p>
<div class="chain">Request → Analyze &amp; Score → Approve → Project → Deliver</div>

<div class="cols">

<div class="nb">
<h2>① Submit a Request</h2>
<p><b>Portfolio → Requests → + New Request</b></p>
<table>
<tr><th>Field</th><th>What to enter</th><th>Example</th></tr>
<tr><td>Name</td><td>Clear, concise title</td><td>CRM Migration</td></tr>
<tr><td>Source</td><td>Where it came from</td><td>Sales department</td></tr>
<tr><td>Category</td><td>Type of initiative</td><td>New Application</td></tr>
<tr><td>Requestor</td><td>Who is asking</td><td>Jane Doe</td></tr>
<tr><td>Target Delivery Date</td><td>When is this needed?</td><td>2026-06-01</td></tr>
</table>
<p><b>Summary tab:</b> use the managed <b>Purpose</b> document to explain the need and expected outcome.</p>
<div class="box box-tip">💡 Keep it lean — deeper analysis, linked knowledge, and supporting evidence can come later. The goal is to get the request into governed intake. New requests start in <b>Pending Review</b>.</div>
</div>

<div class="nb">
<h2>② Analyze & Score</h2>
<p>Open request → work across the <b>Analysis</b> and <b>Scoring</b> tabs</p>

<h3>Analysis</h3>
<p>Capture <b>Impacted Business Processes</b>, a 7-dimension <b>Feasibility Review</b>, <b>Risks &amp; Mitigations</b>, and the formal <b>Analysis Recommendation</b>.</p>

<h3>Feasibility (7 dimensions)</h3>
<p>Technical Feasibility · Integration &amp; Compatibility · Infrastructure Needs · Security &amp; Compliance · Resource &amp; Skills · Delivery Constraints · Change Management.</p>

<h3>Scoring</h3>
<p>Weighted priority criteria are configured in <b>Portfolio → Settings</b>. KANAP calculates the score automatically, and some tenants use mandatory bypass for must-do work.</p>

<p><b>Analysis Recommendation:</b> a short verdict that is published into <b>Activity</b> as the formal decision record.</p>

<div class="box box-warn">⚠️ <b>Don't score alone.</b> Committee: IT Functional + IT Technical + Cybersecurity + Business. One person's score = opinion. A committee's score = decision framework.</div>
</div>

<div class="nb">
<h2>③ Approve & Convert</h2>
<ul>
<li>Review scoring, feasibility, and the recommendation</li>
<li>Use <b>Candidate</b>, <b>On Hold</b>, or <b>Rejected</b> while the request is still under review</li>
<li>Set status to <b>Approved</b> when it is ready for delivery</li>
<li>Click <b>Convert to Project</b> and confirm name, planned dates, and starting effort</li>
</ul>
<div class="box box-tip">💡 Transparent scoring means you can answer "why was my request rejected?" with data, not opinions.</div>
</div>

<div class="nb">
<h2>④ Set Up the Project</h2>
<p>Open project from <b>Portfolio → Projects</b></p>

<h3>Project Properties sidebar</h3>
<table>
<tr><th>Role</th><th>Purpose</th></tr>
<tr><td>Business Sponsor</td><td>Accountable for business outcomes</td></tr>
<tr><td>IT Sponsor</td><td>Removes delivery blockers and backs the initiative</td></tr>
<tr><td>IT Lead</td><td>Drives IT delivery</td></tr>
<tr><td>Business Lead</td><td>Drives business readiness & adoption</td></tr>
<tr><td>IT / Business Contributors</td><td>Team members doing the work</td></tr>
</table>

<div class="box box-warn">⚠️ Contributors must be set up in <b>Portfolio → Contributors</b> with team, availability (days/month), and skills. Without this, capacity planning and roadmap generation won't work.</div>

<p><b>Progress tab:</b> validate IT Effort (MD) + Business Effort (MD), then allocate work across the team.</p>
<p><b>Timeline tab:</b> Apply a Phase Template for instant scaffolding, or set dates manually.</p>
<p><b>Summary / Activity:</b> keep the overall project picture and decision trail visible while the sidebar stays available.</p>
</div>

<div class="nb">
<h2>⑤ Track Execution</h2>

<h3>Progress & Status</h3>
<ul>
<li><b>Execution Progress</b> slider (0–100%) on Progress tab</li>
<li>Typical flow: Waiting List / Planned → In Progress → In Testing → Done (also: On Hold, Cancelled)</li>
</ul>

<h3>Time Logging</h3>
<p><b>Progress tab</b> (overhead) + <b>Tasks</b> (task-specific time).</p>
<div class="box box-warn">⚠️ <b>Time logging powers the roadmap.</b> Logged time → historical capacity → accurate scheduling. Without it, you're guessing. Log weekly, even rough entries.</div>
</div>

<div class="nb">
<h2>⑥ Structure (Advanced)</h2>
<p><b>Phases</b> — logical stages (Analysis, Dev, Test, Deploy). Use templates or create manually.</p>
<p><b>Tasks</b> — assignable work items with priority, due date, time logging.</p>
<p><b>Milestones</b> — key checkpoints visible on timeline and reports.</p>
<div class="box box-tip">💡 Start simple. Add structure only when the project needs it.</div>
</div>

<div class="nb">
<h2>The Bigger Picture</h2>
<p><b>Automatic Roadmap</b> — Effort estimates + contributor availability + historical time data = auto-scheduled project timeline. No more manual Gantt charts.</p>
<p><b>Capacity Heatmaps</b> — See who's overloaded and who has bandwidth, across teams and time periods. Prevents the "5 projects at 100%" trap.</p>
<p><b>Bottleneck Analysis</b> — When projects compete for the same people or skills, KANAP highlights it before it becomes a crisis.</p>
<p><b>Executive Reporting</b> — Scores, status, progress, budget, and timeline roll up into portfolio-level dashboards. No PowerPoint needed.</p>
</div>

<div class="nb">
<h2>Quick Reference</h2>
<table>
<tr><th>I want to…</th><th>Go to…</th></tr>
<tr><td>Submit a new idea</td><td>Portfolio → Requests → + New</td></tr>
<tr><td>Score a request</td><td>Open request → Analysis + Scoring</td></tr>
<tr><td>Set the project team</td><td>Open project → Project Properties sidebar → Team</td></tr>
<tr><td>See the project pipeline</td><td>Portfolio → Planning</td></tr>
<tr><td>Check team capacity</td><td>Portfolio → Planning → Capacity view</td></tr>
<tr><td>Log time on a project</td><td>Open project → Progress tab or Tasks</td></tr>
<tr><td>Generate a roadmap</td><td>Portfolio → Planning → Generate</td></tr>
<tr><td>View reports</td><td>Portfolio → Reporting</td></tr>
<tr><td>Configure scoring weights</td><td>Portfolio → Settings</td></tr>
<tr><td>Set up contributors</td><td>Portfolio → Contributors</td></tr>
</table>
</div>

</div>

<div class="foot">KANAP — IT Department Management &nbsp;|&nbsp; <a href="https://kanap.net">kanap.net</a> &nbsp;|&nbsp; <a href="https://doc.kanap.net">doc.kanap.net</a></div>
</body></html>"""

# ── GETTING STARTED ──
getting_started = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>

<h1>🏠 Getting Started — Your First 10 Minutes</h1>
<p class="sub">KANAP Cheat Sheet</p>
<div class="chain">Dashboard → Profile → Scope Filters → Tasks → Contributor Profile</div>

<div class="cols">

<div class="nb">
<h2>① Your Dashboard</h2>
<p><b>Dashboard</b> — your personal landing page.</p>
<table>
<tr><th>Tile</th><th>What it shows</th></tr>
<tr><td>My Tasks</td><td>Assigned tasks by urgency (overdue, this week, later)</td></tr>
<tr><td>Projects I Lead</td><td>Projects where you're Lead or Sponsor</td></tr>
<tr><td>Projects I Contribute To</td><td>Projects where you're a team member</td></tr>
<tr><td>My Time Last Week</td><td>Hours logged, breakdown, top projects</td></tr>
<tr><td>Recently Viewed</td><td>Items you recently opened</td></tr>
<tr><td>New Requests</td><td>Recent portfolio requests</td></tr>
</table>
<p><b>Quick Actions:</b> Create Task · Log Time (top of dashboard).</p>
<p><b>Customize:</b> click ⚙️ to show/hide tiles.</p>
</div>

<div class="nb">
<h2>② Profile & Notifications</h2>
<p><b>Avatar (top-right) → Settings</b></p>
<p><b>Profile tab:</b> Name, Job Title, Phone.</p>
<p><b>Notifications tab:</b> Master toggle + per-workspace controls (Portfolio, Tasks, Budget).</p>
<h3>Weekly Review Email</h3>
<p>A periodic digest of your activity and upcoming items.</p>
<table>
<tr><th>Setting</th><th>What to configure</th></tr>
<tr><td>Day</td><td>Which day (e.g. Monday)</td></tr>
<tr><td>Time</td><td>What hour</td></tr>
<tr><td>Timezone</td><td>Your local timezone</td></tr>
</table>
<p>Click <b>Preview email</b> to test it.</p>
<div class="box box-tip">💡 The weekly email surfaces forgotten tasks and upcoming deadlines. Set it up once, let it work for you.</div>
</div>

<div class="nb">
<h2>③ Scope Filters — The Key Concept</h2>
<p>Every major list has a scope filter at the top:</p>
<table>
<tr><th>Scope</th><th>Shows</th></tr>
<tr><td><b>My [items]</b></td><td>Items you own or are assigned to</td></tr>
<tr><td><b>My Team's</b></td><td>Items from anyone on your Portfolio team</td></tr>
<tr><td><b>All [items]</b></td><td>Everything in the organization</td></tr>
</table>
<p>Works on: <b>Tasks</b> · <b>Apps</b> · <b>Projects</b> · <b>Requests</b>.</p>
<div class="box box-warn">⚠️ See nothing? You're probably on "My [items]" with nothing assigned yet. Switch to "All". The filter <b>remembers your last choice</b>.</div>
<div class="box">ℹ️ "My Team's" requires a team assignment via <b>Portfolio → Contributors</b>. If grayed out, ask your admin.</div>
</div>

<div class="nb">
<h2>④ Tasks</h2>
<p><b>Portfolio → Tasks</b></p>
<p><b>Create:</b> Dashboard quick action <i>or</i> Tasks page → New.</p>
<p><b>Minimum fields:</b> Title + Assignee + Due Date.</p>
<p><b>Link to context:</b> Project, OPEX, Contract, or CAPEX item. Or leave standalone.</p>
<h3>Statuses</h3>
<table>
<tr><th>Status</th><th>When</th></tr>
<tr><td>Open</td><td>Not started (default)</td></tr>
<tr><td>In Progress</td><td>Work has begun</td></tr>
<tr><td>Done</td><td>Completed (time must be logged for project tasks)</td></tr>
<tr><td>Cancelled</td><td>No longer needed</td></tr>
</table>
<p><b>Log Time:</b> Open task → Log Time → Category (IT/Business) + Date + Hours.</p>
<div class="box box-tip">💡 <b>Send Link</b> — click it in any workspace header to email a direct link to colleagues. Works on tasks, projects, apps, contracts — everything.</div>
</div>

<div class="nb">
<h2>⑤ Contributor Profile</h2>
<p><b>Portfolio → Contributors</b> → find your name.</p>
<table>
<tr><th>Setting</th><th>What it does</th></tr>
<tr><td>Team</td><td>Enables "My Team's" filters everywhere</td></tr>
<tr><td>Availability</td><td>Days/month for projects → feeds roadmap & capacity</td></tr>
<tr><td>Skills</td><td>What you know + proficiency (0–4)</td></tr>
</table>
<p>Proficiency: 0 No knowledge · 1 Basic · 2 With support · 3 Autonomous · 4 Expert.</p>
<div class="box box-warn">⚠️ Be realistic with availability. Account for meetings, BAU, holidays. 20 days/month = zero non-project time.</div>
</div>

<div class="nb">
<h2>How It All Connects</h2>
<p><b>Dashboard</b> — pulls from your tasks, project roles, and time logs.</p>
<p><b>Scope Filters</b> — ownership + team = personalized views everywhere.</p>
<p><b>Capacity Planning</b> — your availability + time logs feed the roadmap generator.</p>
<p><b>Notifications</b> — weekly email + real-time alerts keep you in the loop.</p>

<h3>Want to go further?</h3>
<table>
<tr><th>If you work with…</th><th>Read the…</th></tr>
<tr><td>Apps, servers, infra</td><td>IT Ops Fast Track</td></tr>
<tr><td>Requests, projects, planning</td><td>Portfolio Fast Track</td></tr>
</table>
</div>

<div class="nb">
<h2>Quick Reference</h2>
<table>
<tr><th>I want to…</th><th>Go to…</th></tr>
<tr><td>See my overview</td><td>Dashboard</td></tr>
<tr><td>Create a task</td><td>Dashboard → Create Task</td></tr>
<tr><td>Log time</td><td>Dashboard → Log Time</td></tr>
<tr><td>See all my tasks</td><td>Portfolio → Tasks (scope: My Tasks)</td></tr>
<tr><td>Update my profile</td><td>Avatar → Settings → Profile</td></tr>
<tr><td>Set up notifications</td><td>Avatar → Settings → Notifications</td></tr>
<tr><td>Weekly review email</td><td>Settings → Notifications → Weekly Review</td></tr>
<tr><td>Set my availability</td><td>Portfolio → Contributors → your name</td></tr>
<tr><td>Add my skills</td><td>Contributors → Skills tab</td></tr>
<tr><td>Share a link</td><td>Any workspace → Send Link</td></tr>
<tr><td>Customize dashboard</td><td>Dashboard → ⚙️</td></tr>
</table>
</div>

</div>

<div class="foot">KANAP — IT Department Management &nbsp;|&nbsp; <a href="https://kanap.net">kanap.net</a> &nbsp;|&nbsp; <a href="https://doc.kanap.net">doc.kanap.net</a></div>
</body></html>"""

# ── TASK TYPES ──
task_types = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>

<h1>📋 Run, Build & Tasks — Work Item Types</h1>
<p class="sub">KANAP Cheat Sheet</p>
<div class="chain">Run (Incident · Problem) &nbsp;|&nbsp; Build (Request · Project · Bug) &nbsp;|&nbsp; Transversal (Task)</div>

<div class="cols">

<div class="nb">
<h2>Run — Keeping the Lights On</h2>
<p>Ensures <b>operational continuity</b> (MCO) and <b>security maintenance</b> (MCS) of existing systems. Everyone participates.</p>

<h3>Incident</h3>
<ul>
<li><b>Unplanned interruption or degradation</b> of a production service</li>
<li>Significant impact on the information system</li>
<li>Objective: <b>service restoration</b></li>
</ul>
<p><i>Examples: MES outage, unexpected VM restart, company-wide VPN failure.</i></p>

<h3>Problem</h3>
<ul>
<li><b>Root cause investigation</b> of recurring incidents</li>
<li>Typically identified by IT after detecting a pattern of similar incidents</li>
<li>Objective: <b>permanent resolution</b></li>
</ul>
<p><i>Examples: recurring internet performance issues, repeated interface errors.</i></p>
</div>

<div class="nb">
<h2>Build — Evolving the Landscape</h2>
<p>Covers all <b>evolutions and construction</b> of the information system. Everyone participates.</p>

<h3>Request (Change Request)</h3>
<ul>
<li><b>Planned solicitation</b> to modify the SI</li>
<li>Can be technical, functional, from business or IT</li>
<li>Rarely urgent</li>
<li>Triggers a <b>validation workflow</b> → becomes Task or Project if approved</li>
<li>Meets <b>at least one</b> criterion:
  <ul>
  <li>Significant workload (&gt;3 days)</li>
  <li>Involves multiple IT or business teams</li>
  <li>Requires significant change management</li>
  </ul>
</li>
</ul>
<p><i>Examples: new SAP ↔ PLM field, new LoB application, remote site integration.</i></p>

<h3>Project</h3>
<ul>
<li><b>Coordinated set of tasks</b> with scope, timeline, budget, and deliverables</li>
<li>Same criteria as Request — normally originates from an approved Request</li>
<li><b>Fast-track:</b> projects imposed without Request stage (executive decision, urgent regulation…)</li>
</ul>
<p><i>Examples: S4/HANA upgrade, firewall migration.</i></p>

<h3>Bug</h3>
<ul>
<li><b>Defect in a system under development</b></li>
<li>Too complex for a simple ticket — requires in-depth analysis</li>
<li>Strictly a Build concept: system not yet in production</li>
</ul>
<p><i>Examples: insufficient access rights on a new SAP tile, incorrect firewall rule on a new server.</i></p>
</div>

<div class="nb">
<div class="box box-warn">⚠️ <b>Incident ≠ Bug</b><br>
Running in production and it breaks? → <b>Incident</b> (Run)<br>
Under construction and it doesn't work? → <b>Bug</b> (Build)<br>
Incidents prioritize <b>service restoration</b>. Bugs prioritize <b>root cause fix in the dev cycle</b>.</div>
</div>

<div class="nb">
<h2>Transversal — The Task</h2>
<p>Tasks are the <b>atomic unit of work</b> in KANAP. They cross the Run/Build boundary.</p>

<h3>Task</h3>
<ul>
<li>Can be <b>standalone or linked</b> to a Project</li>
<li>Has a responsible person, status, and deadline</li>
<li>Clearly scoped in terms of impact on users/services</li>
<li>Does <b>not</b> require coordination across multiple teams</li>
<li>Can last a long time if carried by one person without cross-functional analysis</li>
</ul>
<p><i>Examples: install a domain controller, document the Notilus ↔ S4/HANA interface, renew intranet SSL certificate.</i></p>

<div class="box box-tip">💡 <b>Task vs Request/Project</b> — If the work meets <b>any one</b> of these, it's a Request, not a Task:<br>
• Significant workload (&gt;3d) <b>AND</b> requires cross-functional analysis<br>
• Coordination across multiple teams<br>
• Significant change management needed</div>
</div>

<div class="nb">
<h2>Decision Flowchart</h2>
<img src="flowchart-task-types.png" style="height:260pt; margin: 1pt auto; display:block;" />
</div>

<div class="nb">
<h2>Summary</h2>
<table>
<tr><th>Type</th><th>Category</th><th>Key Criterion</th><th>Example</th></tr>
<tr><td><b>Incident</b></td><td>Run</td><td>Unplanned interruption in production</td><td>MES outage</td></tr>
<tr><td><b>Problem</b></td><td>Run</td><td>Root cause of recurring incidents</td><td>Recurring internet perf issues</td></tr>
<tr><td><b>Request</b></td><td>Build</td><td>Planned SI change (&gt;3d / multi-team / change mgmt)</td><td>New SAP ↔ PLM field</td></tr>
<tr><td><b>Project</b></td><td>Build</td><td>Coordinated tasks with scope, timeline, budget</td><td>S4/HANA upgrade</td></tr>
<tr><td><b>Bug</b></td><td>Build</td><td>Defect in a system under development</td><td>Incorrect firewall rule</td></tr>
<tr><td><b>Task</b></td><td>Transversal</td><td>Scoped action, one owner, no multi-team coordination</td><td>Renew SSL certificate</td></tr>
</table>
<div class="box box-tip">⚙️ All work item types are configurable in <b>Portfolio → Settings</b> — add, disable, or rename types to match your processes.</div>
</div>

</div>

<div class="foot">KANAP — IT Department Management &nbsp;|&nbsp; <a href="https://kanap.net">kanap.net</a> &nbsp;|&nbsp; <a href="https://doc.kanap.net">doc.kanap.net</a></div>
</body></html>"""

# ── Generate ──
for name, html in [("kanap-itops-fast-track", itops), ("kanap-portfolio-fast-track", portfolio), ("kanap-getting-started", getting_started), ("kanap-task-types-fast-track", task_types)]:
    doc = HTML(string=html)
    rendered = doc.render()
    print(f"{name}: {len(rendered.pages)} page(s)")
    doc.write_pdf(OUT / f"{name}.pdf")
    print(f"  ✅ {OUT / f'{name}.pdf'}")
