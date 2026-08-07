# UI/UX Wireframe Specification
## Enterprise CMMS System
**Version:** 1.0 | **Date:** July 22, 2026 | **Companion to:** SRS v1.0 & Firestore Schema v1.0
**Scope:** Complete page inventory, field-level detail, button-level detail, and workflow description for Web (desktop/tablet) + Mobile app. No code — wireframes described structurally.

---

## 0. Global UI Conventions

- **Layout shell (Web):** Left sidebar navigation (collapsible) + top bar (search, notifications bell, user avatar/profile menu, plant selector dropdown) + main content area + optional right-side detail drawer.
- **Layout shell (Mobile):** Bottom tab bar (Home, Work Orders, Scan, Notifications, Profile) + top app bar (screen title, back button).
- **Standard buttons appearing across most list screens:** `+ Create`, `Filter`, `Export`, `Refresh`, row-level `⋮` (more actions) menu.
- **Standard field validation pattern:** Required fields marked with `*`; inline error text below field; submit button disabled until required fields valid.
- **Color coding convention:** Priority — P1 red, P2 orange, P3 yellow, P4 grey/blue. Status — New (blue), In Progress (amber), On Hold (grey), Completed (teal), Closed (green), Rejected/Overdue (red).
- **Toast notifications** confirm every create/update/delete action ("Work Order WO-2026-000123 created").

---

## 1. Login / SSO Screen

**Purpose:** Authenticate user via email/password or corporate SSO.

**Fields:**
| Field | Type | Validation |
|---|---|---|
| Email | text input | required, email format |
| Password | password input (show/hide toggle) | required, min 8 chars |

**Buttons:**
| Button | Action |
|---|---|
| Log In | Validates credentials via `/auth/login`; on success routes to Dashboard; on failure shows inline error "Invalid email or password" |
| Sign in with SSO | Redirects to corporate IdP (Azure AD/Okta) OAuth flow; on callback, creates session |
| Forgot Password? (link) | Navigates to Reset Password screen |
| Remember Me (checkbox) | Persists session token in secure storage |

**Workflow:** User lands on Login → enters credentials or taps SSO → system validates → on first login, custom claims (role/plantIds) are fetched and cached → redirected to role-based Dashboard. Failed attempts >5 within 15 min trigger temporary lockout with message.

---

## 2. Dashboard (Role-Based Home)

**Purpose:** Landing page after login; content varies by role (Manager sees KPIs, Technician sees "My Tasks").

**Layout regions:**
1. Greeting bar: "Good morning, {Name}" + current plant + date
2. KPI tile row (Manager/Planner/Supervisor view): MTTR, MTBF, SLA Compliance %, PM Compliance %, Open WOs, Downtime Hours — each tile clickable, drilling into filtered report
3. "My Open Work Orders" widget (Technician/Supervisor view): mini-list, top 5, with `View All` link
4. "PM Due This Week" widget (Planner view): mini-calendar strip
5. "Low Stock Alerts" widget (Storekeeper view)
6. Recent Activity feed (Auditor/Manager view)

**Buttons:**
| Button | Action |
|---|---|
| Plant Selector (dropdown, top bar) | Switches active plant context, reloads dashboard data scoped to selected plant |
| KPI Tile (click) | Navigates to Reports Center pre-filtered by that KPI |
| View All (per widget) | Navigates to corresponding list screen (Work Orders, PM Calendar, Inventory) |
| + Quick Create (floating action button) | Opens modal to select: New Work Order / New Breakdown Request / New PM Schedule |

**Workflow:** On load, dashboard queries `/dashboardMetrics/{plantId}_{today}` for fast KPI reads (per schema design) rather than live-aggregating; widgets below load their own scoped queries. Auto-refreshes every 5 minutes or on manual `Refresh`.

---

## 3. Asset Register (List View)

**Purpose:** Browse/search all assets in hierarchy or flat list.

**Fields (Filter Panel):**
| Field | Type |
|---|---|
| Search by name/code | text input |
| Plant | dropdown (if multi-plant user) |
| Department | dropdown |
| Category | multi-select dropdown |
| Criticality | multi-select (High/Medium/Low) |
| Status | multi-select (Active/Maintenance/Decommissioned/Disposed) |

**Table Columns:** Asset Code, Name, Category, Criticality (colored badge), Status, Last PM Date, Next PM Due (highlighted red if overdue), Actions.

**Buttons:**
| Button | Action |
|---|---|
| + Create Asset | Opens Create Asset form (modal or dedicated page) |
| Toggle: List / Hierarchy Tree View | Switches table to expandable parent-child tree |
| Filter | Opens/collapses filter panel |
| Export | Downloads CSV/Excel of current filtered view |
| Row → View | Navigates to Asset Detail screen |
| Row → ⋮ menu: Edit / Decommission / Create Work Order / View QR Code | Contextual actions |
| Bulk select checkboxes + "Bulk Update Status" | Batch status change with confirmation dialog |

**Workflow:** User filters/searches → selects asset row → navigates to Detail. From Hierarchy Tree, expanding a Line shows its Machines, expanding a Machine shows Components — reflects `parentAssetId` self-referencing structure.

---

## 4. Create / Edit Asset (Form)

**Fields:**
| Field | Type | Validation |
|---|---|---|
| Asset Name * | text | required |
| Asset Code * | text | required, unique per plant |
| Parent Asset | searchable dropdown | optional |
| Plant * | dropdown | required |
| Department | dropdown | |
| Category * | dropdown (Machine/Line/Utility/Vehicle...) | required |
| Criticality * | radio (High/Medium/Low) | required |
| Manufacturer | text | |
| Model | text | |
| Serial Number | text | |
| Install Date | date picker | |
| Warranty Expiry | date picker | |
| Meter Unit | dropdown (Hours/Cycles/Km) | |
| Initial Meter Reading | number | ≥ 0 |
| Photo | image upload | max 5MB |
| Spec Sheet / Manual | file upload | pdf/doc, max 10MB |

**Buttons:**
| Button | Action |
|---|---|
| Save | Validates and writes to `/assets/{assetId}`; generates QR code; shows success toast |
| Save & Add Another | Saves and clears form for rapid batch entry |
| Cancel | Discards changes, confirmation dialog if dirty |
| Generate QR Code (after save) | Opens printable QR label preview |

**Workflow:** Planner/Admin fills form → on Save, Cloud Function assigns `qrCode`, sets `status = Active`, `createdAt`. Redirects to Asset Detail.

---

## 5. Asset Detail Screen

**Layout Tabs:** Overview | Maintenance History | PM Schedules | Documents | Downtime Log | Meter Readings

**Overview Tab fields displayed (read-only):** all Create Asset fields, plus computed: Downtime Hours YTD, Total Maintenance Cost YTD, Open Work Orders count.

**Maintenance History Tab:** Table of past Work Orders (WO#, Type, Priority, Status, Closed Date, Cost) with link to each WO Detail.

**PM Schedules Tab:** List of active PM schedules on this asset with Next Due Date; button `+ Add PM Schedule`.

**Documents Tab:** Grid of uploaded manuals/drawings/certificates; button `+ Upload Document`.

**Downtime Log Tab:** Table of downtime events (Start, End, Duration, Cause, Linked WO).

**Meter Readings Tab:** Line chart of meter trend + table; button `+ Log Reading`.

**Buttons (page header):**
| Button | Action |
|---|---|
| Edit | Opens Edit Asset form pre-filled |
| Create Work Order | Opens Create WO form pre-filled with this asset |
| Decommission | Confirmation dialog → sets status = Decommissioned, requires reason text |
| Print QR Label | Generates printable label |
| Back to Asset Register | Navigation |

**Workflow:** Used by Technicians (scanning QR routes here directly on mobile), Planners (to add PM), and Managers (to review cost/downtime history before capex decisions).

---

## 6. Work Order List

**Purpose:** Central hub for all work orders; different default filters per role (Technician defaults to "Assigned to Me").

**Filter Fields:** Plant, Status (multi-select), Priority (multi-select), Type (PM/Breakdown/Inspection/Project), Assigned To, Date Range, Asset, SLA Status (On Track/At Risk/Breached).

**Table Columns:** WO#, Asset, Type, Priority (badge), Status (badge), Assigned To (avatar), Created Date, SLA Due (countdown/overdue indicator), Cost, Actions.

**Buttons:**
| Button | Action |
|---|---|
| + Create Work Order | Opens Create WO form |
| Filter | Toggle filter panel |
| Saved Views (dropdown: "My Open WOs", "Overdue", "P1 Only") | Applies preset filter combination |
| Export | CSV/Excel export |
| Row → Open | Navigates to WO Detail |
| Row → ⋮: Reassign / Change Priority / Cancel | Quick actions with confirmation |
| Bulk Actions: Assign Technician / Change Status | For multi-selected rows (Supervisor/Manager only) |

**Workflow:** List auto-refreshes on status-change events (real-time Firestore listener). Clicking SLA countdown badge shows tooltip with breach time and escalation level.

---

## 7. Create Work Order / Breakdown Request

**Fields:**
| Field | Type | Validation |
|---|---|---|
| Asset * | searchable dropdown (or QR scan on mobile) | required |
| Type * | dropdown (PM/Breakdown/Inspection/Project) | required |
| Priority | dropdown (auto-suggested from Priority Matrix based on asset criticality + impact, overridable) | required |
| Description * | multi-line text | required, min 10 chars |
| Failure Code | dropdown (only shown if Type = Breakdown) | optional |
| Requested By | auto-filled (current user), editable by Supervisor+ | |
| Attach Photo/Video | file upload | optional, max 3 files |
| Permit Required? | toggle | if Yes, reveals Permit Type dropdown |
| Preferred Schedule Date | date/time picker | optional |

**Buttons:**
| Button | Action |
|---|---|
| Submit | Creates WO with `status = New`; triggers `onWorkOrderCreate` Cloud Function (assigns WO number, computes SLA due dates); routes to WO Detail |
| Submit & Report Another | For operators reporting multiple issues quickly |
| Cancel | Discards, confirmation if fields filled |
| Scan Asset QR (mobile only, camera icon) | Opens camera, auto-fills Asset field on successful scan |

**Workflow:** Any Requester can submit → system auto-classifies priority per matrix → notification fires to Supervisor/Planner queue → WO enters Triage.

---

## 8. Work Order Detail / Execution Screen

**Layout Tabs/Sections:** Header (WO#, status badge, priority badge, SLA countdown) | Details | Checklist | Labor | Parts | Attachments | Comments | Status History

**Header Buttons (visibility role/status-dependent):**
| Button | Visible When | Action |
|---|---|---|
| Acknowledge | Status = New/Triaged, viewer = assignee | Sets status = Assigned, stamps `ackAt` |
| Start Job | Status = Scheduled/Assigned, viewer = Technician | Sets status = InProgress, stamps `startedAt` |
| Put On Hold | Status = InProgress | Opens reason dialog (Waiting Parts/Approval/Safety); sets status = OnHold |
| Resume | Status = OnHold | Sets status = InProgress, resumes SLA clock |
| Mark Complete | Status = InProgress, checklist fully filled | Validates checklist required items; sets status = Completed, stamps `completedAt` |
| Submit for Review | Auto after Mark Complete | Routes to Supervisor queue, status = PendingReview |
| Approve & Close | Status = PendingReview, viewer = Supervisor/Manager | Sets status = Closed, stamps `closedAt`, finalizes cost rollup |
| Reopen | Status = PendingReview or Closed (Manager only), viewer = Supervisor/Manager | Requires reason text; sets status = Reopened → back to Assigned |
| Reject | Status = New, viewer = Supervisor | Requires reason; sets status = Rejected |
| Reassign | Status ≠ Closed | Opens technician picker with skill-match suggestions |
| Change Priority | Viewer = Supervisor/Manager | Opens priority dropdown, requires justification note, recalculates SLA due dates |
| Print Job Card | Any status | Generates printable PDF summary |

**Details section fields (editable by Planner/Supervisor before Assigned status):** Asset, Type, Priority, Description, Scheduled Start/End, Assigned To, Supervisor, Permit Required toggle.

**Checklist tab:** Renders items from linked `checklistTemplateId`; each item type-specific input (boolean toggle / number field / text / photo capture button); required items marked; progress bar "6/8 items completed."

**Labor tab:**
- Table of logged entries (Technician, Start, End, Hours, Notes)
- Button `+ Log Time`: opens form (Technician auto-filled, Start/End time pickers or "Start/Stop Timer" live button, Notes text)
- Running total hours & calculated labor cost displayed

**Parts tab:**
- Table of parts used (Part, Qty, Unit Cost, Line Total)
- Button `+ Add Part`: searchable part dropdown, Qty input (validated against available stock), Warehouse dropdown; on save triggers stock deduction via Cloud Function
- Running total parts cost displayed

**Attachments tab:**
- Grid of photos/videos/docs with uploader name/date
- Button `+ Upload` (camera capture or file picker)
- Button `Delete` per item (Supervisor+ only)

**Comments tab:**
- Threaded comments list
- Text input + `Post` button for internal notes/collaboration

**Status History tab:** Read-only timeline of all status transitions with actor and timestamp (from `statusHistory` subcollection).

**Workflow:** Full lifecycle traversal as defined in SRS Section 5. Every button click writes to `statusHistory`, fires relevant notifications (per Notification Flow), and — on Close — triggers cost rollup, asset downtime update, and dashboard metric increment Cloud Functions.

---

## 9. PM Schedule List & Calendar

**Two view toggles:** List View | Calendar View (month/week/day)

**List View Filter Fields:** Plant, Asset, Trigger Type (Time/Meter/Condition), Active/Inactive.

**List Table Columns:** PM Title, Asset, Trigger Type, Frequency, Last Completed, Next Due (red if overdue), Assigned Team, Actions.

**Calendar View:** Color-coded event blocks per day representing due PMs; clicking a block opens quick-view popover with "Generate WO Now" button.

**Buttons:**
| Button | Action |
|---|---|
| + Create PM Schedule | Opens Create PM form |
| Toggle List/Calendar | Switches view |
| Row → Generate Now | Manually triggers WO creation ahead of schedule |
| Row → Deactivate | Confirmation dialog; sets `isActive = false` |
| Row → Edit | Opens edit form |

**Workflow:** Planner reviews upcoming PMs, can manually accelerate or defer; scheduled Cloud Function (`onPmScheduleDue`) auto-generates WOs daily so this screen mainly serves as visibility + manual override.

---

## 10. Create / Edit PM Schedule (Form)

**Fields:**
| Field | Type | Validation |
|---|---|---|
| Title * | text | required |
| Asset * | dropdown | required |
| Trigger Type * | radio (Time/Meter/Condition) | required |
| Frequency Value * | number | required, > 0 |
| Frequency Unit * | dropdown (Days/Weeks/Months/Hours/Cycles) | required, contextual to trigger type |
| Checklist Template * | dropdown (or `+ New Template` shortcut) | required |
| Assigned Team | multi-select user picker | optional |
| Start Date | date picker | required |
| Active? | toggle | default On |

**Buttons:**
| Button | Action |
|---|---|
| Save | Writes to `/pmSchedules`, computes initial `nextDueDate` |
| Save & Create Another | |
| Cancel | |

---

## 11. Checklist Template Builder

**Purpose:** Design reusable checklists for PM/Safety/Inspection WOs.

**Fields:**
| Field | Type |
|---|---|
| Template Name * | text |
| Category * | dropdown (PM/Safety/Inspection) |
| Applicable Plant | dropdown (or "Global") |

**Checklist Item Builder (repeatable rows):**
| Field | Type |
|---|---|
| Item Label * | text |
| Input Type * | dropdown (Boolean/Number/Text/Photo) |
| Required? | toggle |
| Help Text | text (optional tooltip shown to technician) |

**Buttons:**
| Button | Action |
|---|---|
| + Add Item | Appends new item row |
| Drag handle (per row) | Reorder items |
| Delete (per row) | Removes item, confirmation if template already in use |
| Save Template | Persists to `/checklistTemplates`, increments `version` if editing existing |
| Preview | Renders read-only mobile-style preview of the checklist |

---

## 12. Maintenance Planner (Scheduler Board)

**Purpose:** Visual Gantt-style resource scheduling.

**Layout:** Left: Technician list with avatar + current utilization %. Right: Horizontal timeline (day/week toggle) with draggable WO blocks per technician row.

**Fields (Filter bar):** Plant, Date Range, Department, Skill Filter.

**Buttons:**
| Button | Action |
|---|---|
| Day / Week Toggle | Switches timeline granularity |
| Unassigned WOs Tray (side panel) | Lists WOs pending assignment; drag onto a technician's timeline row to assign |
| Auto-Suggest Assignment (button per unassigned WO) | Runs skill-match algorithm, highlights best-fit technicians |
| Save Schedule | Persists scheduledStart/End + assignedTo updates in bulk |
| Conflict Warning icon | Appears if a technician is double-booked; hover shows conflicting WO details |

**Workflow:** Planner drags WO card from "Unassigned" tray onto a technician's row at desired time slot → system checks availability/shift hours → on drop, WO status moves to Scheduled, notification sent to technician.

---

## 13. Inventory / Parts Catalog

**Filter Fields:** Warehouse, Category, Stock Status (Below Reorder / Normal / Overstock), Search by Part Code/Description.

**Table Columns:** Part Code, Description, UOM, Qty On Hand (per warehouse, or total), Min/Max/Reorder Qty, Unit Cost, Status badge (Low Stock in red), Actions.

**Buttons:**
| Button | Action |
|---|---|
| + Create Part | Opens Create Part form |
| Filter | |
| Export | |
| Row → View/Edit | Opens Part Detail |
| Row → ⋮: Issue Stock / Return Stock / Adjust / Cycle Count | Opens respective Stock Transaction form |
| Low Stock banner (if any parts below reorder) → "Create Requisitions" | Bulk-generates draft Purchase Requisitions for all flagged parts |

**Workflow:** Storekeeper monitors list; low-stock parts trigger automatic notification (per Cloud Function) but this screen also allows manual bulk-requisition creation.

---

## 14. Create / Edit Part (Form)

**Fields:**
| Field | Type | Validation |
|---|---|---|
| Part Code * | text | required, unique |
| Description * | text | required |
| Category | dropdown | |
| UOM * | dropdown | required |
| Unit Cost * | number | required, ≥ 0 |
| Min Qty / Max Qty / Reorder Qty * | number | required, Min < Max |
| Preferred Vendor | dropdown | |
| Warehouse & Initial Stock | repeatable rows (Warehouse dropdown + Qty) | |
| Bin Location | text (per warehouse) | |

**Buttons:** `Save`, `Save & Add Another`, `Cancel`.

---

## 15. Stock Transaction Screen (Issue/Return/Adjust/Cycle Count)

**Fields (varies by transaction type via tab/dropdown selector):**

*Issue:* Part * (dropdown/search), Warehouse *, Qty *, Reference Work Order (dropdown), Performed By (auto-filled).
*Return:* Same as Issue plus Reason dropdown.
*Adjustment:* Part *, Warehouse *, New Counted Qty *, Reason * (text, required for audit).
*Cycle Count:* Bulk table — Part, System Qty (read-only), Counted Qty (editable input) for a selected warehouse; discrepancies highlighted.

**Buttons:**
| Button | Action |
|---|---|
| Submit | Writes `/stockTransactions` doc, updates `parts.warehouseStock` atomically (Cloud Function) |
| Cancel | |
| Cycle Count: Save Draft / Finalize Count | Draft allows partial save; Finalize locks and posts adjustment transactions for all discrepancies |

---

## 16. Purchase Requisition List & Detail

**List Filter Fields:** Status (Draft/PendingApproval/Approved/Rejected/ConvertedToPO), Requested By, Date Range.

**List Columns:** PR#, Requested By, Item Count, Estimated Cost, Status, Actions.

**PR Detail Fields:**
| Field | Type |
|---|---|
| Items table (repeatable) | Part, Qty, Estimated Unit Cost, Line Total |
| Justification/Notes | text |

**Buttons:**
| Button | Action |
|---|---|
| + Create Requisition | Opens PR form |
| + Add Line Item (in detail) | Adds row to items table |
| Submit for Approval | Status → PendingApproval, notifies Approver |
| Approve / Reject (Approver only) | Requires comment on Reject |
| Convert to PO (after Approved) | Pre-fills Create PO form with PR items |

---

## 17. Purchase Order List & Detail

**List Filter Fields:** Status, Vendor, Plant, Date Range.

**List Columns:** PO#, Vendor, Status, Total Amount, Expected Delivery, Actions.

**PO Detail Fields:**
| Field | Type |
|---|---|
| Vendor * | dropdown |
| Expected Delivery Date | date picker |
| Line Items table | Part, Qty Ordered, Unit Cost, Line Total (+ `+ Add Line Item`) |
| Total Amount | auto-calculated, read-only |

**Buttons:**
| Button | Action |
|---|---|
| + Create PO | Opens PO form (blank or pre-filled from PR) |
| Send to Vendor | Status → Sent; generates PDF PO document; (optionally emails vendor) |
| + Receive Goods (GRN) | Opens Goods Receipt form: per line item, Qty Received input; on submit creates `stockTransactions` (Receipt type), updates `parts.warehouseStock`, updates PO status (PartiallyReceived/Received) |
| Cancel PO | Confirmation dialog, requires reason |
| Print / Download PDF | |

---

## 18. Vendor Master

**Filter Fields:** Category Supplied, Active/Inactive, Search by Name.

**List Columns:** Name, Contact, Rating (stars), Lead Time (days), Categories, Actions.

**Create/Edit Vendor Fields:** Name *, Contact Person, Email, Phone, Address, Categories Supplied (multi-select), Lead Time Days, Rating (read-only, computed from historical PO performance).

**Buttons:** `+ Create Vendor`, row `Edit`, row `Deactivate`, `View PO History` (per vendor).

---

## 19. User & Role Management

**User List Filter Fields:** Plant, Role, Status, Search by Name/Email.

**User List Columns:** Name, Email, Role, Plant(s), Status, Last Login, Actions.

**Create/Edit User Fields:**
| Field | Type | Validation |
|---|---|---|
| Name * | text | required |
| Email * | text | required, unique, email format |
| Phone | text | |
| Role * | dropdown | required |
| Plant(s) * | multi-select | required, at least 1 |
| Department | dropdown | |
| Skill Tags | multi-select tag input | |
| Shift | dropdown | |
| Status | toggle (Active/Inactive) | |

**Buttons:**
| Button | Action |
|---|---|
| + Invite User | Opens Create User form; on save sends email invite with temp password/SSO link |
| Row → Edit / Deactivate / Reset Password | |
| Bulk Import (CSV upload) | For onboarding many users at once |

**Roles sub-tab:** List of Roles with `+ Create Role`, `Edit`, `Duplicate`; editing opens the Permission Matrix Configuration screen scoped to that role.

---

## 20. Permission Matrix Configuration

**Purpose:** Define CRUD+Approve permissions per role per module (as in SRS Section 13).

**Layout:** Table — rows = modules (Assets, Work Orders, PM, Inventory, Procurement, Reports, User Mgmt, Settings, Audit Logs), columns = Create/Read/Update/Delete/Approve, each cell a checkbox, scoped to the role selected in a top dropdown.

**Buttons:**
| Button | Action |
|---|---|
| Role selector (dropdown) | Loads that role's current permission map |
| Save Changes | Writes updated `permissions` map to `/roles/{roleId}` |
| Reset to Default | Reverts to system default template for that role |
| Duplicate Role As... | Creates new custom role pre-filled from current selection |

---

## 21. Notification Center

**Layout:** List of notifications, unread bolded, grouped by Today/Earlier.

**Fields (per item):** Icon (type-based), Title, Body snippet, Timestamp, Read/Unread dot.

**Buttons:**
| Button | Action |
|---|---|
| Mark as Read (per item, or auto on click) | Updates `status = Read` |
| Mark All as Read | Bulk update |
| Click notification | Navigates to referenced entity (WO Detail, PO Detail, etc.) |
| Filter by Type (dropdown: All/SLA/PM/Stock/Approval) | |
| Settings (gear icon) → Notification Preferences | Opens sub-screen to toggle channels (push/email/SMS) per notification type |

---

## 22. Reports Center

**Layout:** Left panel lists standard report categories (Work Order Summary, SLA Compliance, PM Compliance, Asset Downtime, Maintenance Cost, Inventory Valuation, Technician Productivity, Failure Analysis, Audit Trail, Procurement). Main panel renders selected report with its own filter bar and result table/chart.

**Common Buttons per report:**
| Button | Action |
|---|---|
| Run Report | Executes query with current filters |
| Export PDF / Excel / CSV | Downloads formatted output |
| Save as Custom View | Persists filter combination for quick re-access |
| Schedule Email (optional) | Sets up recurring emailed report (daily/weekly/monthly) |

**Report-specific filter fields:** Date Range, Plant, Asset Category, Priority, Technician, Vendor (contextual to report type).

---

## 23. Custom Report Builder

**Fields:**
| Field | Type |
|---|---|
| Data Source | dropdown (Work Orders / Assets / Inventory / Purchase Orders) |
| Columns to Include | multi-select checklist of available fields |
| Filters (repeatable rows) | Field dropdown + Operator dropdown (=, !=, >, <, contains) + Value input |
| Group By | dropdown (optional) |
| Sort By | dropdown + Asc/Desc toggle |

**Buttons:**
| Button | Action |
|---|---|
| Preview | Runs query, shows result table |
| Save Report | Persists definition for reuse, appears in Reports Center |
| Export | PDF/Excel/CSV |

---

## 24. KPI Dashboard (Manager View — expanded)

Expanded version of Dashboard KPI tiles (Section 2) with full chart set:

**Charts/Widgets:** MTTR trend line, MTBF trend line, SLA Compliance % gauge, PM Compliance % gauge, Open WO by Priority (bar chart), Downtime by Asset (Pareto chart, top 10 offenders), Maintenance Cost by Category (pie chart), Planned vs Unplanned ratio (donut chart), Technician Utilization (bar chart), Inventory Fill Rate (gauge).

**Buttons:**
| Button | Action |
|---|---|
| Date Range Selector | Reloads all widgets for selected period |
| Plant Filter | Scopes all widgets |
| Drill-down (click any chart segment) | Navigates to underlying filtered list (e.g., clicking a Pareto bar opens Asset Detail or filtered WO list) |
| Export Dashboard as PDF | Snapshot export for board/management reporting |

---

## 25. Audit Log Viewer

**Filter Fields:** Entity Type (dropdown), Entity ID/search, Performed By, Date Range, Plant.

**Table Columns:** Timestamp, Entity Type, Entity ID (link to entity), Action, Performed By, Diff (expandable row showing old→new values).

**Buttons:**
| Button | Action |
|---|---|
| Filter | |
| Export | For compliance audit packages |
| Row expand (▶) | Shows field-level diff |

*(Read-only screen; no create/edit — enforced both in UI and Firestore security rules.)*

---

## 26. Settings (Plants, Shifts, Priority/SLA Config, Failure Codes)

**Sub-tabs:**

**Plants tab:** List + Create/Edit Plant form (Name, Code, Address, Timezone, Status).

**Shifts tab:** List + Create/Edit Shift form (Name, Start Time, End Time) per plant.

**Priority Matrix tab:** Editable grid — rows = Criticality (High/Med/Low) × Impact (Safety/Production/Quality/Cost), each cell assigns a Priority (P1–P4) dropdown. Button `Save Matrix`.

**SLA Matrix tab:** Table — rows = P1–P4, columns = Acknowledge/Response/Resolution SLA (number + unit inputs), Escalation Level 1/2 (user or role picker + threshold %). Button `Save SLA Config`.

**Failure Codes tab:** List + Create/Edit form (Code, Description, Category dropdown).

**Buttons (common):** `+ Add`, `Edit`, `Delete` (with usage-check confirmation), `Save`.

---

## 27. Mobile: Technician Task List (Home)

**Purpose:** Technician's primary mobile screen — offline-capable.

**Layout:** Top: Today's date + sync status icon (green=synced, orange=pending sync, red=offline). List of assigned WOs as cards.

**Card fields displayed:** WO#, Asset Name + thumbnail, Priority badge, Status badge, SLA countdown, Scheduled Time.

**Buttons:**
| Button | Action |
|---|---|
| Card tap | Opens Mobile WO Execution screen |
| Filter chip bar (Today / This Week / Overdue / All) | Filters card list |
| Pull-to-refresh | Manual sync trigger |
| Bottom Tab: Scan | Opens QR Scanner screen |
| Bottom Tab: Notifications | Opens mobile Notification Center |
| Bottom Tab: Profile | Opens profile/settings (logout, sync status detail) |

**Workflow:** App queries local cache first (offline-first), reconciles with server on connectivity; any WO created/updated offline queues with `clientUuid` for conflict-free sync per schema design.

---

## 28. Mobile: WO Execution Screen

**Purpose:** Streamlined single-column version of Web WO Detail, optimized for field use, glove-friendly large tap targets.

**Sections (scrollable, sticky action button at bottom):** Asset info card (photo, name, location) → Description → Checklist (large toggle switches, number pads, camera-button per photo item) → Parts Used (barcode scan-to-add) → Labor Timer (large Start/Stop button, auto-logs hours) → Signature Pad (for permit sign-off if required) → Notes (voice-to-text supported).

**Primary sticky button (context-sensitive label):** `Acknowledge` → `Start Job` → `Mark Complete` → `Submit for Review`, mirroring the Web workflow states exactly.

**Secondary buttons:** `Put On Hold`, `Add Comment`, `Call Supervisor` (tap-to-dial), `View Asset Manual` (opens cached PDF).

**Workflow:** Identical state machine to Web Section 8, executed offline-capable; on submit, if offline, shows "Queued — will sync when online" badge instead of blocking the technician.

---

## 29. Mobile: QR/Barcode Scanner

**Purpose:** Fast asset lookup or breakdown reporting from the shop floor.

**Layout:** Full-screen camera viewfinder with scan-target overlay; bottom sheet slides up on successful scan showing Asset quick-info (Name, Status, Last PM) with two large buttons: `View Asset Detail` and `Report Breakdown`.

**Buttons:**
| Button | Action |
|---|---|
| Flashlight toggle | For low-light plant environments |
| Manual Entry (fallback link) | Text input for asset code if QR is damaged/unreadable |
| Report Breakdown | Opens Create Work Order form pre-filled with scanned asset, Type=Breakdown |

---

## 30. Vendor Portal (External Contractor View)

**Purpose:** Restricted external access — vendor sees only WOs assigned to them as a contractor.

**Screens available:** Login (separate vendor auth) → Assigned Job List (same card pattern as Technician Task List, read-only asset info, no cost visibility) → Job Detail (Checklist + Attachments + Mark Complete only — no access to internal cost/labor rate fields) → Invoice Submission (upload invoice PDF against completed job).

**Buttons:**
| Button | Action |
|---|---|
| Mark Complete | Same as Technician flow, routes to internal Supervisor for review |
| Upload Invoice | Attaches PDF to PO/WO record for Procurement reconciliation |
| Message Supervisor | Simple threaded message box (maps to `comments` subcollection) |

---

## 31. Global Workflow Summary (Cross-Screen)

1. **Breakdown-to-Close:** Requester (Mobile Scan or Web Create WO) → Supervisor Triage (WO List) → Technician Execution (Mobile WO Execution) → Supervisor Review (Web WO Detail) → Manager Close (P1 only) → Reports/Dashboard reflect closure.
2. **PM-to-Close:** Cloud Function auto-creates WO from PM Schedule → appears in Technician Task List → same execution/review/close path → `nextDueDate` advances on `pmSchedules`.
3. **Low-Stock-to-Replenish:** Inventory screen flags part → auto-draft Purchase Requisition → Procurement reviews (PR Detail) → Approve → Convert to PO → Vendor delivers → Storekeeper Goods Receipt (PO Detail) → stock updated → Parts tab in WO reflects availability again.
4. **User Onboarding:** Admin invites user (User Management) → assigns Role (Permission Matrix determines access) → user receives email/SSO invite → completes first login → lands on role-scoped Dashboard.
5. **Escalation:** SLA countdown on WO Detail crosses threshold → Notification Center + email/SMS to next escalation level (per Settings → SLA Matrix config) → visible as red badge across Dashboard, WO List, and KPI Dashboard until resolved.

---

## Document Control

| Version | Date | Notes |
|---|---|---|
| 1.0 | 2026-07-22 | Full UI/UX wireframe spec — all screens, fields, buttons, workflows. No code produced, per instruction. |

**Next step options:** (a) High-fidelity visual mockups/design system (colors, typography, component library) via the frontend-design skill, or (b) begin frontend implementation (React components) screen-by-screen, or (c) API/backend implementation over the Firestore schema. Let me know which to proceed with.
