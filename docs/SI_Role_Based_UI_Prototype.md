# SI — Service Inside
## Role-Based UI Prototype
**Version 1.0 · July 22, 2026 · UI prototype specification — no code**
**Roles covered:** Requester · Technician · Supervisor · Maintenance Manager · Administrator

---

## 0. How Role Shapes the Screen

SI shows one product, not five products — every role shares the same design system (Section-referenced throughout: Navy/Orange/Green/Red, Inter, 12px radius, badge and card conventions from the SI Design System guide). What changes per role is:

1. **Which sidebar items appear at all** — a role never sees a nav item it has no permission to open.
2. **What the default landing screen shows** — the Dashboard is role-aware, not one-size-fits-all.
3. **Which action buttons render on a shared screen** — e.g., Requester and Technician both open a Work Order Detail page, but only Supervisor+ sees Approve & Close.
4. **Desktop vs. mobile bias** — Requester and Technician are designed mobile-first (shop floor); Supervisor, Manager, and Administrator are desktop-first (office/control room), with mobile as a capable secondary surface.

---

## 1. Requester

**Who:** Production operators, line workers — anyone who needs to report a problem but has no maintenance responsibilities.
**Primary surface:** Mobile (also available on a floor-mounted kiosk/tablet).

### 1.1 Sidebar / Navigation

Requester has no sidebar in the traditional sense — the mobile app opens straight to a **2-tab bottom bar**: **Report** and **My Requests**. On desktop/kiosk, this becomes a single-item minimal top nav ("New Request" / "My Requests") — no Assets, Work Orders, Reports, or Settings ever appear.

### 1.2 Screens

**① Requester Home**
- One large Orange (Accent) button, full-width, centered: **"Report a Problem."** This is the only button on the screen competing for attention — everything else is secondary text.
- Below it, a compact list: "My Recent Requests" (last 5), each row showing the machine name, a Status badge (Section 7 status colors), and relative time.
- No KPIs, no charts, no plant-wide data — a Requester's world is "what have I reported and what's the status."

**② Report a Problem (simplified Raise Work Order)**
A stripped-down version of the full Raise Work Order form — Requester never sees Priority, SLA, or downtime-estimate fields (those are triage/planning concerns):
- **Scan or select machine** — camera-first QR scan button, with a manual dropdown fallback.
- **What's wrong?** — a single required text area.
- **Add a photo or video** — same evidence dropzones as the full system, camera-first on mobile.
- **Submit** — single Accent button. On submit, the system silently runs the same auto-priority classification used in the full form, but the Requester never sees or sets it — they get a confirmation screen instead: "Request submitted — a technician will be assigned shortly," with the auto-assigned request number.

**③ My Requests (list)**
- Card-per-request list (not a dense table — Requester volume per person is low, so a friendlier card layout fits better than the Supervisor's table view).
- Each card: machine name + photo thumbnail if provided, Status badge, submitted date, and a one-line description preview.
- Tapping a card opens Request Detail — **read-only**.

**④ Request Detail (read-only)**
- Same Status Timeline component used everywhere else in SI, so a Requester sees exactly the same progression (New → Triaged → Assigned → In Progress → Completed → Closed) a Supervisor sees — transparency without edit rights.
- No Assignment tab, no Approval tab, no cost data. A "Add a comment" field is available so the Requester can add context if a technician asks a follow-up question.

**⑤ Notifications**
- Only notifications about the Requester's own submissions (status changes on their requests) — never plant-wide alerts.

### 1.3 What a Requester never sees
Assets register, Work Order list (other than their own), technician assignment, cost figures, priority/SLA controls, PM schedules, inventory, reports, settings, user management.

---

## 2. Technician

**Who:** Maintenance craftsmen executing assigned work.
**Primary surface:** Mobile, built for gloved, one-handed, sometimes-offline use.

### 2.1 Sidebar / Navigation

Bottom tab bar: **Tasks** (home) · **Scan** · **Notifications** · **Profile**. No Assets register, no Reports, no Settings tab. A Technician reaches an asset only through a task or a QR scan — never through a standalone browse-all-assets screen.

### 2.2 Screens

**① My Tasks (home)**
- Filter chips across the top: **Today / This Week / Overdue / All** — large, thumb-sized tap targets.
- Task cards, each showing: WO number (small, tabular), machine name (prominent), Priority badge, Status badge, and an SLA countdown chip that turns Red when breached.
- Pull-to-refresh syncs with the server; a small colored dot in the app bar shows Green (synced) / Orange (pending sync) / Red (offline) at all times — the Technician always knows if their work is actually saved.

**② Work Order Execution**
This is the Technician's main working screen, and the most detailed in the whole mobile experience:
- Asset info card at top (photo, name, location, criticality).
- Description of the issue.
- **Checklist** — large Pass/Fail tap targets (not small radio buttons), number-entry fields with a numeric keypad, camera-capture buttons for photo-required items.
- **Parts used** — barcode/QR scan-to-add, with quantity stepper.
- **Labor timer** — one big Start/Stop button; hours log automatically.
- **Evidence** — photo/video capture, camera-first.
- **Signature pad** — appears only if the work order requires Permit-to-Work sign-off.
- A **sticky primary button at the bottom of the screen**, always reachable without scrolling, whose label changes with state: *Acknowledge → Start Job → Mark Complete → Submit for Review* — mirroring the desktop state machine exactly, one tap at a time.
- Secondary actions above the sticky button: **Put On Hold**, **Add Comment**, **Call Supervisor** (tap-to-dial).
- A Technician can **reassign or approve nothing** — no Assignment tab, no Approval tab with Approve/Reject/Reopen options. Their lifecycle stops at "Submit for Review."

**③ Asset Quick View (via Scan)**
- Full-screen camera viewfinder; on successful scan, a bottom sheet slides up with the asset's name, status, and last PM date, and two buttons: **View Full History** and **Report a Breakdown** (which opens Work Order creation pre-filled with this asset, same as a Requester's flow but the Technician's version also lets them self-assign immediately).

**④ Notifications**
- New assignment, SLA approaching, parts now in stock (if they were waiting on a part), comments from a Supervisor on one of their jobs.

**⑤ Profile**
- Sync status detail, logout, and language/notification preferences — no admin-level settings.

### 2.3 What a Technician never sees
Full Asset Register (browse-all), cost/budget figures beyond their own job, other technicians' workload, Approval (Approve & Close / Reject), PM schedule creation, Reports, User management.

---

## 3. Supervisor

**Who:** Frontline maintenance leads — triage, assign, and sign off on their team's work.
**Primary surface:** Desktop, with the same mobile app as Technicians for floor walks.

### 3.1 Sidebar / Navigation

Full sidebar appears, but scoped: **Dashboard · Assets · Work Orders · PM Schedules**. **Inventory, Procurement, Reports** appear in a reduced form (view-only, no configuration); **Users & Roles** and **Settings** are hidden entirely.

### 3.2 Screens

**① Supervisor Dashboard**
A team-scoped version of the full KPI Dashboard:
- KPI tiles limited to what a Supervisor acts on day-to-day: **Open Work Orders, SLA at Risk, Team Utilization, PM Due This Week** — the plant-wide financial and Pareto charts (Maintenance Cost by Category, Downtime Pareto) are present but secondary, placed lower on the page rather than above the fold.
- **"Needs Triage"** widget — new/unassigned work orders awaiting a Supervisor's attention, front and center, since triage is this role's first daily task.
- **Team roster strip** — each technician's name, current job count, and a small utilization bar.

**② Work Order List (team-scoped)**
- Identical table to the full system, but default-filtered to the Supervisor's plant/department.
- The **"Needs Triage"** saved view is pinned first in the filter presets.
- Row-level quick actions include **Reassign** and **Change Priority** directly from the list, in addition to opening full detail.

**③ Work Order Detail**
- All tabs visible: Overview, Technician Assignment, Attachments, Status Timeline, **Approval**.
- In Approval, a Supervisor sees **Acknowledge, Start Job, Put On Hold/Resume, Mark Complete, Submit for Review, Reopen, and Approve & Close** for P2–P4 work orders.
- For **P1 work orders**, the Approve & Close button is visible but disabled with a small inline note — *"P1 closures require Maintenance Manager sign-off"* — so the Supervisor understands the boundary without hitting a dead end.

**④ Maintenance Planner (Scheduler Board)**
- The Gantt-style technician timeline is a Supervisor-primary screen — drag-and-drop assignment, skill-match suggestions, conflict warnings when double-booking a technician.

**⑤ PM Schedule List & Calendar**
- Full view and the ability to **Generate Now** or **toggle Active/Paused**, but creating brand-new PM schedules or checklist templates is Manager+ territory — the "Create PM Schedule" button is replaced with a note directing them to request one from their Manager, keeping the screen honest about the boundary rather than hiding the whole module.

**⑥ Asset Register (view + limited edit)**
- Full register and Asset Detail are visible (a Supervisor needs downtime and history context), but **Decommission** and full asset creation are hidden — a Supervisor can edit operational fields (e.g., updating a meter reading) but not the asset's core registration.

**⑦ Reports (team subset)**
- SLA Compliance, PM Compliance, Technician Productivity, Work Order Summary — all scoped to their team. Maintenance Cost and Custom Report Builder are hidden (budget visibility is a Manager-level concern).

### 3.3 What a Supervisor never sees
User & Role management, Permission Matrix, plant/SLA-matrix Settings, Checklist Template creation, Custom Report Builder, P1 closure authority.

---

## 4. Maintenance Manager

**Who:** Owns plant-wide maintenance performance, budget, and compliance.
**Primary surface:** Desktop.

### 4.1 Sidebar / Navigation

Full sidebar, everything visible except **Users & Roles** and the deepest **Settings** panels (Permission Matrix, org-level configuration) — a Manager configures maintenance rules, not system security.

### 4.2 Screens

**① Manager Dashboard**
The complete KPI Dashboard exactly as designed: all trend charts, both gauges, the Downtime Pareto, Cost-by-Category donut, Planned vs. Unplanned ratio, Technician Utilization — nothing scoped down. Date range selector and Export PDF are front-row actions here; this is the screen a Manager takes into a weekly ops review.

**② Work Order List & Detail (full authority)**
- Everything a Supervisor has, plus: **Approve & Close is always enabled, including for P1 work orders.**
- Cost figures are visible on every work order (Supervisors and Technicians never see per-job cost; the Manager does).

**③ Asset Register — full CRUD**
- Create, Edit, and **Decommission** are all live. Asset Detail's cost and downtime figures roll up directly into the Manager Dashboard's charts, so this is where the numbers a Manager reports upward originate.

**④ PM Schedules — full CRUD + Checklist Template Builder**
- Manager is the role that actually builds and versions checklist templates, sets frequencies, and assigns default teams — the screens a Supervisor could only view are fully editable here.

**⑤ Inventory & Procurement (approval authority)**
- Views low-stock alerts and inventory valuation; **approves Purchase Requisitions** and converts them to Purchase Orders — a Manager signs off on spend, a Storekeeper (not modeled as a separate role here but implied by the module) executes the mechanics.

**⑥ Reports Center — full access + Custom Report Builder**
- Every standard report, unscoped, plus the Custom Report Builder and the ability to **Save as View** and **Schedule Email** — a Manager is the audience for recurring, board-ready reporting.

**⑦ Settings (maintenance configuration subset)**
- **Priority Matrix** and **SLA Matrix** configuration, **Failure Codes**, **Shifts** — a Manager tunes how the plant classifies and responds to problems. Plant-level org settings (adding a new plant entirely) and the Permission Matrix remain Administrator-only.

### 4.3 What a Maintenance Manager never sees
User invitation/deactivation, role/permission configuration, cross-plant organization settings (adding/removing plants), raw audit log (Manager sees compliance *reports*, not the raw immutable log itself).

---

## 5. Administrator

**Who:** IT/platform owner — configures the system itself, not the maintenance work inside it.
**Primary surface:** Desktop.

### 5.1 Sidebar / Navigation

Full sidebar, every item visible — Administrator is the only role with **Users & Roles** and the complete **Settings** tree, including Permission Matrix and organization-level (plant) configuration. Administrator technically *can* open every operational screen (Work Orders, Assets, PM) for support/debugging purposes, but the Dashboard defaults to a system-health view rather than a maintenance-KPI view.

### 5.2 Screens

**① Admin Dashboard (system-health view)**
Distinct from the Manager's maintenance-KPI dashboard — this one shows:
- Active users / seats used, plants connected, integration status (ERP/SCADA/SSO — Green/Orange/Red dot per connector).
- A compact "recent audit activity" feed rather than maintenance charts.
- No MTTR/MTBF/downtime charts here — those belong to the Manager Dashboard; an Administrator's dashboard is about the platform, not the plant floor.

**② User & Role Management**
- User list: name, email, role, plant(s), status, last login — with **Invite User**, **Edit**, **Deactivate**, **Reset Password**, and **Bulk Import (CSV)**.
- Role list alongside it: **Create Role**, **Duplicate Role**, and a link into the Permission Matrix for any role selected.

**③ Permission Matrix Configuration**
- The module × action (Create/Read/Update/Delete/Approve) grid, one role at a time via a selector — this is the screen that actually produces the boundaries described in Sections 1–4 above. Changing a checkbox here is what turns a Supervisor's disabled "Approve & Close" button on P1s into an enabled one, system-wide.

**④ Settings — full tree**
- **Plants** (create/edit plants, addresses, timezones), **Shifts**, **Priority Matrix**, **SLA Matrix**, **Failure Codes** — Administrator has every panel a Manager has, plus the ability to add or retire an entire plant, which is an organizational action above a Manager's scope.

**⑤ Checklist Templates (global oversight)**
- Same builder Managers use, but an Administrator can see and edit templates marked **"Global"** (applying across all plants) versus a Manager's plant-scoped ones.

**⑥ Audit Log Viewer**
- The one screen unique to Administrator: a read-only, filterable feed of every create/update/delete/status-change/approve action system-wide, with entity type, actor, timestamp, and an expandable field-level diff. No edit or delete capability exists on this screen by design — it is the system's record of truth.

**⑦ Notification Center**
- System-level notifications only an Administrator needs: failed integration syncs, license/seat thresholds, security events — separate in kind from the maintenance-operational notifications every other role sees.

### 5.3 What an Administrator's default view emphasizes
Everything is *reachable*, but the Administrator's own home screen and notification stream are about **keeping the system running**, not about fixing machines — a deliberate distinction from the Manager, who owns the opposite half of the same platform.

---

## 6. Screen-by-Role Access Matrix

A quick-reference cross-check of every screen against every role. **●** = full access, **◐** = view/limited, **—** = not visible.

| Screen | Requester | Technician | Supervisor | Manager | Administrator |
|---|---|---|---|---|---|
| Dashboard (role-appropriate variant) | ◐ (My Requests only) | ◐ (My Tasks only) | ◐ (team-scoped) | ● (full KPI) | ● (system-health) |
| Report a Problem / Raise Work Order | ● (simplified) | ● (from asset scan) | ● (full form) | ● | ● |
| My Requests / Work Order List | ◐ (own only) | ◐ (assigned only) | ● (team-scoped) | ● (plant-wide) | ● |
| Work Order Detail — view | ◐ (read-only) | ◐ (execution only) | ● | ● | ● |
| Work Order Approval (P2–P4) | — | — | ● | ● | ● |
| Work Order Approval (P1) | — | — | ◐ (disabled) | ● | ● |
| Technician Assignment | — | — | ● | ● | ● |
| Asset Register | — | ◐ (via scan only) | ● (view + limited edit) | ● (full CRUD) | ● |
| Asset Decommission | — | — | — | ● | ● |
| PM Schedules — view | — | ◐ (assigned tasks) | ● | ● | ● |
| PM Schedules — create/edit | — | — | — | ● | ● |
| Checklist Template Builder | — | — | ◐ (view) | ● | ● (incl. global) |
| Maintenance Planner (Scheduler) | — | — | ● | ● | ● |
| Inventory | — | ◐ (parts on own WO) | ◐ (view) | ● (approve) | ● |
| Procurement | — | — | — | ● | ● |
| Reports Center | — | — | ◐ (team subset) | ● (full + builder) | ● |
| Custom Report Builder | — | — | — | ● | ● |
| User & Role Management | — | — | — | — | ● |
| Permission Matrix | — | — | — | — | ● |
| Settings — maintenance config | — | — | — | ● | ● |
| Settings — plants/org | — | — | — | — | ● |
| Audit Log Viewer | — | — | — | ◐ (compliance reports only) | ● |
| Notification Center | ◐ (own requests) | ◐ (own tasks) | ● (team) | ● (plant) | ● (system) |

---

## 7. Prototype Notes

- Every screen listed reuses components already defined in the SI Design System (badges, cards, tables, sidebar, top nav, notification panel) — role differences are expressed through **visibility and permission**, never through a parallel design language.
- No new colors, type styles, or corner-radius values are introduced for any role — a Requester's simplified form and an Administrator's Permission Matrix are visually the same product at different zoom levels of responsibility.
- This document defines *what exists per role*; it does not yet contain markup or component code, per your instruction.
