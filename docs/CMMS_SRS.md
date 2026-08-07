# Software Requirements Specification (SRS)
## Enterprise CMMS (Computerized Maintenance Management System)
### Prepared for: Manufacturing Operations
**Version:** 1.0 | **Date:** July 22, 2026 | **Prepared by:** Senior Solution Architect

---

## 1. Business Objectives

| # | Objective | Success Metric |
|---|---|---|
| 1 | Reduce unplanned equipment downtime | ↓ 30% unplanned downtime within 12 months |
| 2 | Standardize preventive maintenance (PM) execution | ≥ 95% PM compliance rate |
| 3 | Increase maintenance workforce productivity | ↓ 20% mean time to repair (MTTR) |
| 4 | Improve spare parts availability & reduce inventory holding cost | ↓ 15% inventory carrying cost, ≥ 98% parts fill rate |
| 5 | Provide real-time visibility to plant/maintenance managers | 100% work orders tracked digitally (paperless) |
| 6 | Ensure regulatory & safety compliance (ISO 55000, OSHA, audit trails) | Zero critical audit non-conformances |
| 7 | Enable data-driven decisions via KPIs and analytics | Monthly KPI dashboard adoption by all plant managers |
| 8 | Extend equipment lifecycle and asset ROI | ↑ 10% mean time between failures (MTBF) |
| 9 | Lay foundation for predictive/AI-driven maintenance | Data pipeline ready for AI module by Phase 2 |

---

## 2. User Roles

| Role | Description |
|---|---|
| **Super Admin** | Full system control; manages org structure, licensing, master data, security config |
| **Plant/Maintenance Manager** | Oversees plant maintenance operations, approves budgets, views KPI dashboards, escalation authority |
| **Maintenance Planner/Scheduler** | Creates PM schedules, plans work orders, allocates resources & parts |
| **Supervisor** | Assigns/approves work orders, monitors technician performance, closes work orders |
| **Technician/Craftsman** | Executes work orders, logs time/parts/notes, updates job status, captures readings |
| **Storekeeper/Inventory Manager** | Manages spare parts inventory, issues/returns parts, reorder management |
| **Procurement Officer** | Manages purchase requisitions/orders for parts and services |
| **Requester (Production Operator/Any Employee)** | Raises breakdown/maintenance requests |
| **Auditor/Quality Officer** | Read-only access to logs, compliance reports, and audit trails |
| **Vendor/Contractor (External)** | Limited portal access to assigned external work orders |
| **System/API Integration Account** | Machine-to-machine access (ERP, SCADA/IoT, ESB) |

---

## 3. Functional Requirements

### 3.1 Asset Management
- FR-1.1: Register assets with hierarchy (Plant → Building → Line → Machine → Component)
- FR-1.2: Store asset metadata (make, model, serial no., install date, warranty, criticality, QR/barcode)
- FR-1.3: Track asset meters (runtime hours, cycle counts, odometer) manually or via IoT feed
- FR-1.4: Maintain asset documents (manuals, drawings, warranty certificates)
- FR-1.5: Asset lifecycle status (Active, Under Maintenance, Decommissioned, Disposed)
- FR-1.6: Asset downtime/uptime history log

### 3.2 Work Order Management
- FR-2.1: Create work orders manually, from PM schedule, or from breakdown request
- FR-2.2: Auto-generate WO number with plant/year/sequence convention
- FR-2.3: Assign WO to technician(s)/crew with skill matching
- FR-2.4: Attach checklists, SOPs, safety permits (LOTO/Permit-to-Work)
- FR-2.5: Capture labor hours, parts consumed, cost, and failure codes
- FR-2.6: Support multi-status workflow with mandatory approval gates
- FR-2.7: Mobile app support for offline WO execution with sync
- FR-2.8: Attach photos/videos/voice notes as evidence

### 3.3 Preventive Maintenance (PM) Management
- FR-3.1: Define PM templates (time-based, meter-based, condition-based)
- FR-3.2: Auto-generate WOs based on PM schedule triggers
- FR-3.3: PM calendar view (daily/weekly/monthly/annual)
- FR-3.4: PM compliance tracking and overdue alerts

### 3.4 Breakdown/Corrective Maintenance
- FR-4.1: Any employee can raise a breakdown ticket (web/mobile/QR scan)
- FR-4.2: Auto-classification of priority based on Priority Matrix
- FR-4.3: Escalation if not acknowledged within SLA window

### 3.5 Inventory & Spare Parts Management
- FR-5.1: Maintain parts catalog with min/max/reorder levels, bin location
- FR-5.2: Parts issue/return against work orders with auto stock deduction
- FR-5.3: Multi-store/multi-warehouse support
- FR-5.4: Auto-generate purchase requisition on reorder point breach
- FR-5.5: Cycle count / physical stock audit support

### 3.6 Procurement Integration
- FR-6.1: Create Purchase Requisition (PR) → Purchase Order (PO) workflow
- FR-6.2: Vendor master with rating and lead time tracking
- FR-6.3: Goods Receipt Note (GRN) linking to inventory update

### 3.7 Maintenance Planning & Scheduling
- FR-7.1: Resource calendar & technician availability/shift management
- FR-7.2: Drag-and-drop Gantt-style scheduler
- FR-7.3: Skill-based auto-assignment suggestions

### 3.8 Safety & Compliance
- FR-8.1: Permit-to-Work / LOTO digital sign-off before WO execution
- FR-8.2: Incident/near-miss logging linked to assets
- FR-8.3: Audit trail (who/what/when) on all critical transactions, immutable log

### 3.9 Notifications & Alerts
- FR-9.1: Multi-channel notifications (push, email, SMS, in-app)
- FR-9.2: Configurable alert rules (SLA breach, PM due, stock low, approval pending)

### 3.10 Reporting & Analytics
- FR-10.1: Configurable dashboards per role
- FR-10.2: Standard + ad-hoc report builder with export (PDF/Excel/CSV)

### 3.11 Master Data & Configuration
- FR-11.1: Manage plants, departments, cost centers, shifts, skill sets, failure codes
- FR-11.2: Configure priority matrix, SLA matrix, approval hierarchies per plant

### 3.12 Integration
- FR-12.1: REST APIs for ERP (SAP/Oracle), SCADA/IoT platforms, SSO/IdP (Azure AD/Okta)
- FR-12.2: Webhook support for outbound event notifications

---

## 4. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | Page load < 2s (P95); API response < 500ms (P95) under 500 concurrent users |
| **Scalability** | Horizontally scalable to support 50+ plants, 10,000+ assets, 1,000+ concurrent users |
| **Availability** | 99.9% uptime SLA; scheduled maintenance windows outside shift hours |
| **Offline Capability** | Mobile app must support offline WO creation/execution with conflict-resolved sync |
| **Security** | Encryption at rest (AES-256) & in transit (TLS 1.2+); RBAC; OWASP Top 10 compliance |
| **Auditability** | Immutable audit trail retained ≥ 7 years for compliance |
| **Usability** | Mobile-first responsive UI; support for low-connectivity plant-floor environments |
| **Localization** | Multi-language (i18n) and multi-timezone support |
| **Compliance** | ISO 55000 (Asset Mgmt), ISO 9001, OSHA/local safety regulations, GDPR/data residency where applicable |
| **Backup/DR** | RPO ≤ 15 min, RTO ≤ 4 hrs; automated daily backups, geo-redundant storage |
| **Maintainability** | Modular microservice architecture; CI/CD pipeline; API versioning |
| **Interoperability** | Open REST/JSON APIs; standard auth (OAuth2/OIDC) |

---

## 5. Work Order Workflow

```
[Request Created] 
      │  (Breakdown / PM Auto-trigger / Manual)
      ▼
[New / Open] ───────────────► [Rejected] (invalid request)
      │
      ▼
[Triaged & Prioritized]  (Priority Matrix applied, SLA clock starts)
      │
      ▼
[Assigned]  (Supervisor assigns technician/crew, parts reserved)
      │
      ▼
[Scheduled]  (date/time slot, permit-to-work issued if required)
      │
      ▼
[In Progress]  (technician starts job, logs time/parts/notes)
      │
      ├──► [On Hold]  (waiting parts/approval/safety clearance) ──┐
      │                                                            │
      ▼                                                            │
[Work Completed]  (technician marks done, checklist signed) ◄─────┘
      │
      ▼
[Pending Review/QA]  (supervisor verification)
      │
      ├──► [Reopened]  (rework required) ──► back to [Assigned]
      │
      ▼
[Approved & Closed]  (cost finalized, asset history updated)
      │
      ▼
[Archived]
```

**Key Rules:**
- SLA timer starts at "Triaged" and pauses during "On Hold" (customer/parts-caused delays).
- Closure requires supervisor sign-off; P1 closures require Manager sign-off.
- All state transitions are logged to the audit trail with timestamp and actor.

---

## 6. Priority Matrix (P1–P4)

| Priority | Definition | Example Trigger | Response Time | Resolution Time |
|---|---|---|---|---|
| **P1 – Critical** | Safety hazard or full production line stoppage | Line-stopping breakdown, fire/safety risk | 15 min | 4 hours |
| **P2 – High** | Significant impact, partial line/output degradation | Machine running at reduced capacity | 1 hour | 8 hours |
| **P3 – Medium** | Non-critical asset affected, no immediate production impact | Auxiliary equipment fault | 4 hours | 24 hours |
| **P4 – Low** | Cosmetic/minor issue, routine PM | Minor leak, scheduled PM task | 24 hours | 5 business days |

**Priority Auto-Assignment Logic:** based on Asset Criticality (High/Medium/Low) × Impact (Safety/Production/Quality/Cost) matrix, editable by Super Admin per plant.

---

## 7. SLA Matrix

| Priority | Acknowledge SLA | Response SLA | Resolution SLA | Escalation Level 1 | Escalation Level 2 |
|---|---|---|---|---|---|
| P1 | 5 min | 15 min | 4 hrs | Supervisor → Manager at 50% SLA breach | Plant Head at 100% breach |
| P2 | 15 min | 1 hr | 8 hrs | Supervisor at 70% SLA | Manager at 100% breach |
| P3 | 30 min | 4 hrs | 24 hrs | Supervisor at 100% breach | Manager at 150% breach |
| P4 | 2 hrs | 24 hrs | 5 business days | Supervisor at 150% breach | — |

**SLA Reporting:** SLA compliance % tracked per plant, per technician, per asset category; breaches auto-logged for RCA (Root Cause Analysis).

---

## 8. Database Design (Relational — for reporting/ERP-integrated core, if RDBMS used)

### 8.1 Core Entities (ER Overview)

```
Plant (1) ──< Department (1) ──< Asset (1) ──< WorkOrder (M)
Asset (1) ──< PMSchedule (M) ──< WorkOrder (M, auto-generated)
WorkOrder (1) ──< WOLaborLog (M)
WorkOrder (1) ──< WOPartsUsed (M) ──> Part (1)
Part (1) ──< StockTransaction (M) ──> Warehouse (1)
WorkOrder (M) ──> User/Technician (1) [assigned_to]
WorkOrder (1) ──< WOAttachment (M)
WorkOrder (1) ──< WOStatusHistory (M)
Vendor (1) ──< PurchaseOrder (1) ──< POLineItem (M) ──> Part (1)
Role (1) ──< UserRole (M) ──> User (1)
```

### 8.2 Key Tables (Sample Schema)

**assets**
| Column | Type | Notes |
|---|---|---|
| asset_id | UUID/PK | |
| asset_code | VARCHAR | Unique |
| name | VARCHAR | |
| parent_asset_id | UUID/FK | Self-referencing hierarchy |
| plant_id | UUID/FK | |
| category | VARCHAR | |
| criticality | ENUM(High,Medium,Low) | |
| status | ENUM | Active/Maintenance/Decommissioned |
| install_date | DATE | |
| warranty_expiry | DATE | |
| meter_reading | DECIMAL | |
| created_at/updated_at | TIMESTAMP | |

**work_orders**
| Column | Type | Notes |
|---|---|---|
| wo_id | UUID/PK | |
| wo_number | VARCHAR | Unique, business key |
| asset_id | UUID/FK | |
| type | ENUM | PM/Breakdown/Inspection/Project |
| priority | ENUM(P1-P4) | |
| status | ENUM | per workflow states |
| requested_by | UUID/FK | |
| assigned_to | UUID/FK | |
| sla_due_at | TIMESTAMP | |
| created_at/started_at/completed_at/closed_at | TIMESTAMP | |
| cost_total | DECIMAL | |

**pm_schedules**
| Column | Type | Notes |
|---|---|---|
| pm_id | UUID/PK | |
| asset_id | UUID/FK | |
| trigger_type | ENUM | Time/Meter/Condition |
| frequency_value | INT | |
| frequency_unit | ENUM | Days/Weeks/Months/Hours/Cycles |
| checklist_template_id | UUID/FK | |
| next_due_date | DATE | |

**parts / inventory**
| Column | Type | Notes |
|---|---|---|
| part_id | UUID/PK | |
| part_code | VARCHAR | |
| description | VARCHAR | |
| uom | VARCHAR | |
| min_qty / max_qty / reorder_qty | INT | |
| unit_cost | DECIMAL | |
| warehouse_id | UUID/FK | |

**users / roles**
| Column | Type | Notes |
|---|---|---|
| user_id | UUID/PK | |
| name/email/phone | VARCHAR | |
| role_id | UUID/FK | |
| plant_id | UUID/FK | Scoping |
| skill_tags | ARRAY | |
| status | ENUM | Active/Inactive |

*(Additional supporting tables: wo_labor_log, wo_parts_used, wo_attachments, wo_status_history, purchase_orders, po_line_items, vendors, notifications, audit_logs.)*

---

## 9. Firestore Collections (NoSQL Alternative / Mobile-Sync Layer)

```
/plants/{plantId}
    name, timezone, address, criticalityConfig, createdAt

/plants/{plantId}/assets/{assetId}
    assetCode, name, parentAssetId, category, criticality,
    status, meterReading, warrantyExpiry, qrCode, docs[]

/plants/{plantId}/assets/{assetId}/pmSchedules/{pmId}
    triggerType, frequencyValue, frequencyUnit, checklistTemplateId,
    nextDueDate, lastCompletedAt

/workOrders/{woId}
    woNumber, plantId, assetId, type, priority, status,
    requestedBy, assignedTo[], slaDueAt, createdAt, startedAt,
    completedAt, closedAt, cost, checklistId, attachments[],
    geo (lat/lng of asset, optional)

/workOrders/{woId}/statusHistory/{eventId}
    fromStatus, toStatus, changedBy, timestamp, remarks

/workOrders/{woId}/laborLogs/{logId}
    technicianId, hoursLogged, startTime, endTime, notes

/workOrders/{woId}/partsUsed/{lineId}
    partId, qty, unitCost, warehouseId

/inventory/{warehouseId}/parts/{partId}
    partCode, description, qtyOnHand, minQty, maxQty,
    reorderQty, unitCost, binLocation

/inventory/{warehouseId}/stockTransactions/{txnId}
    type (issue/return/receipt/adjustment), partId, qty,
    referenceWoId, performedBy, timestamp

/vendors/{vendorId}
    name, contact, rating, leadTimeDays

/purchaseOrders/{poId}
    vendorId, status, lineItems[], totalAmount, createdBy, createdAt

/users/{userId}
    name, email, phone, roleId, plantIds[], skillTags[], fcmTokens[],
    status, lastLogin

/roles/{roleId}
    name, permissions{module: [create,read,update,delete,approve]}

/notifications/{notificationId}
    userId, type, title, body, referenceType, referenceId,
    channel, status(sent/read), createdAt

/auditLogs/{logId}
    entityType, entityId, action, performedBy, timestamp, diff{}

/dashboardMetrics/{plantId}/daily/{dateId}
    mttr, mtbf, slaCompliancePct, pmCompliancePct, openWOCount,
    downtimeHours (precomputed aggregates for fast dashboard reads)
```

**Design Notes:**
- Denormalize frequently-read fields (e.g., `assetName`, `plantName` cached on `workOrders`) to minimize reads.
- Use Cloud Functions/triggers for: WO status change → notification; stock qty < reorder → auto-PR; PM nextDueDate reached → auto-create WO.
- Composite indexes required on: `(plantId, status, priority)`, `(assignedTo, status)`, `(assetId, createdAt)`.

---

## 10. API Structure (REST, versioned)

Base URL: `https://api.cmms.company.com/v1`

| Module | Endpoint | Method(s) |
|---|---|---|
| Auth | `/auth/login`, `/auth/refresh`, `/auth/logout` | POST |
| Assets | `/assets`, `/assets/{id}`, `/assets/{id}/hierarchy`, `/assets/{id}/history` | GET/POST/PUT/DELETE |
| Work Orders | `/work-orders`, `/work-orders/{id}`, `/work-orders/{id}/status`, `/work-orders/{id}/labor`, `/work-orders/{id}/parts`, `/work-orders/{id}/attachments` | GET/POST/PUT/PATCH |
| PM Schedules | `/pm-schedules`, `/pm-schedules/{id}`, `/pm-schedules/{id}/generate` | GET/POST/PUT |
| Inventory | `/inventory/parts`, `/inventory/parts/{id}`, `/inventory/transactions` | GET/POST/PUT |
| Procurement | `/purchase-requisitions`, `/purchase-orders`, `/purchase-orders/{id}/receive` | GET/POST/PUT |
| Users/Roles | `/users`, `/roles`, `/permissions` | GET/POST/PUT/DELETE |
| Notifications | `/notifications`, `/notifications/{id}/read` | GET/PATCH |
| Reports | `/reports/sla-compliance`, `/reports/pm-compliance`, `/reports/downtime`, `/reports/custom` | GET/POST |
| Dashboards | `/dashboards/kpi?plantId=&range=` | GET |
| Integration Webhooks | `/webhooks/subscribe`, `/webhooks/erp-sync` | POST |

**Standards:** OAuth2/OIDC bearer tokens, pagination via `?page=&limit=`, filtering via query params, consistent error envelope `{code, message, details}`, idempotency keys on POST for offline-sync reconciliation.

---

## 11. Screen List

1. Login / SSO
2. Dashboard (role-based home)
3. Asset Register (list, detail, hierarchy tree)
4. Asset Detail (specs, documents, meter, downtime history)
5. Work Order List (filter/sort/search)
6. Work Order Detail / Execution Screen
7. Create Work Order / Breakdown Request
8. PM Schedule List & Calendar
9. PM Template Builder (checklist designer)
10. Maintenance Planner (Gantt/Scheduler board)
11. Inventory / Parts Catalog
12. Stock Transaction Screen (issue/return/adjust)
13. Purchase Requisition List & Detail
14. Purchase Order List & Detail
15. Vendor Master
16. User & Role Management
17. Permission Matrix Configuration
18. Notification Center
19. Reports Center (standard reports)
20. Custom Report Builder
21. KPI Dashboard (Manager view)
22. Audit Log Viewer
23. Settings (Plants, Shifts, Priority/SLA config, Failure Codes)
24. Mobile: Technician Task List (offline-capable)
25. Mobile: WO Execution + Checklist + Photo Capture
26. Mobile: QR/Barcode Scanner (asset lookup / breakdown report)
27. Vendor Portal (external contractor view)

---

## 12. Navigation Flow

```
Login/SSO
   │
   ▼
Role-Based Dashboard ──┬──► Assets ──► Asset Detail ──► History / Documents / Create WO
                        │
                        ├──► Work Orders ──► WO List ──► WO Detail ──► Execute/Approve/Close
                        │                        │
                        │                        └──► Create WO (manual/breakdown)
                        │
                        ├──► PM ──► PM Calendar ──► PM Template Builder
                        │
                        ├──► Planner ──► Scheduler Board ──► Assign Technician
                        │
                        ├──► Inventory ──► Parts Catalog ──► Stock Txn ──► Purchase Requisition
                        │                                                        │
                        │                                                        ▼
                        │                                                  Purchase Order ──► GRN
                        │
                        ├──► Reports ──► Standard Reports / Custom Builder
                        │
                        ├──► KPI Dashboard
                        │
                        ├──► Admin ──► Users/Roles ──► Permission Matrix
                        │           └──► Settings (Priority/SLA/Plants)
                        │
                        └──► Notification Center

Mobile App:
Login ──► Task List (My WOs) ──► WO Detail ──► Checklist ──► Photo/Notes ──► Submit (offline queue) ──► Sync
       └──► QR Scan ──► Asset Quick View ──► Report Breakdown
```

---

## 13. User Permissions (Role–Module Matrix)

| Module | Super Admin | Manager | Planner | Supervisor | Technician | Storekeeper | Procurement | Requester | Auditor | Vendor |
|---|---|---|---|---|---|---|---|---|---|---|
| Assets | CRUD | R | CRU | R | R | R | R | R | R | — |
| Work Orders | CRUD | RUA | CRU | CRUA | RU (assigned) | R | R | C (own) | R | RU (assigned) |
| PM Schedules | CRUD | R | CRUD | R | R | — | — | — | R | — |
| Inventory | CRUD | R | R | R | — | CRUD | R | — | R | — |
| Procurement | CRUD | A | C | — | — | R | CRUD | — | R | — |
| Reports/Dashboards | R | R | R | R | R (own) | R | R | — | R | — |
| User/Role Mgmt | CRUD | — | — | — | — | — | — | — | R | — |
| Settings/Config | CRUD | R | R | — | — | — | — | — | R | — |
| Audit Logs | R | R | — | — | — | — | — | — | R | — |

*Legend: C=Create, R=Read, U=Update, D=Delete, A=Approve. Permissions are configurable per plant via Permission Matrix screen; table shows default template.*

---

## 14. Notification Flow

```
Event Occurs (WO created / SLA at risk / PM due / Stock low / Approval pending / WO status change)
      │
      ▼
Notification Rule Engine (evaluates recipient(s) + channel per config)
      │
      ├──► In-App Notification (Notification Center, bell icon)
      ├──► Push Notification (Mobile - FCM/APNs)
      ├──► Email (SMTP/SES/SendGrid)
      └──► SMS (for P1/critical only, via gateway)
      │
      ▼
Delivery Log + Read/Ack Status stored
      │
      ▼
Escalation Timer (if unacknowledged within X min → notify next level per SLA Matrix)
```

**Key Notification Triggers:**
- New WO assigned → Technician (push + in-app)
- SLA at 70%/100% breach → Supervisor/Manager (push + email + SMS for P1)
- PM due in 3 days / overdue → Planner (email + in-app)
- Stock below reorder point → Storekeeper + Procurement (in-app + email)
- PO awaiting approval → Approver (email + in-app)
- WO reopened / rework → original Technician + Supervisor

---

## 15. Dashboard KPIs

| KPI | Formula / Definition | Target |
|---|---|---|
| **MTTR** (Mean Time to Repair) | Σ(Completion Time − Start Time) / # of WOs | Trend ↓ |
| **MTBF** (Mean Time Between Failures) | Total Uptime / # of Breakdowns | Trend ↑ |
| **PM Compliance %** | (PM completed on time / PM scheduled) × 100 | ≥ 95% |
| **SLA Compliance %** | (WOs resolved within SLA / total WOs) × 100 | ≥ 90% |
| **Open Work Orders** | Count by status/priority/plant | Monitor |
| **Backlog Aging** | # WOs open > X days, bucketed | ↓ trend |
| **Equipment Downtime Hours** | Σ downtime per asset/plant/period | ↓ trend |
| **Maintenance Cost per Asset** | Total cost (labor+parts) / asset | Budget-aligned |
| **Planned vs Unplanned Maintenance Ratio** | PM WOs / (PM + Breakdown WOs) | ≥ 80:20 |
| **Technician Utilization %** | Logged hours / Available hours | 75–85% |
| **Inventory Fill Rate %** | Parts issued without stockout / total requests | ≥ 98% |
| **First-Time Fix Rate %** | WOs closed without reopening / total WOs | ≥ 90% |

Dashboards filterable by Plant, Date Range, Asset Category, Priority; drill-down from KPI tile → underlying WO list.

---

## 16. Reports

| Report | Description | Consumers |
|---|---|---|
| Work Order Summary Report | All WOs with status/cost/duration filters | Manager, Auditor |
| SLA Compliance Report | Breach analysis by priority/plant/technician | Manager |
| PM Compliance Report | Scheduled vs completed PM, overdue list | Planner, Manager |
| Asset Downtime/Uptime Report | Downtime hours, top-failing assets (Pareto) | Manager, Reliability Engineer |
| Maintenance Cost Report | Cost by asset/department/cost-center/period | Finance, Manager |
| Inventory Valuation & Consumption Report | Stock levels, usage trends, slow-moving parts | Storekeeper, Finance |
| Technician Productivity Report | Hours logged, jobs closed, first-time-fix rate | Supervisor, Manager |
| Failure Analysis / RCA Report | Failure codes frequency, MTBF trend | Reliability Engineer |
| Audit Trail Report | Full change history for compliance audits | Auditor |
| Procurement Report | PR/PO cycle time, vendor performance | Procurement, Manager |
| Custom Report Builder Output | User-defined filters/columns, export PDF/Excel/CSV | All roles (per permission) |

---

## 17. Future AI Module (Phase 2 Roadmap)

| Capability | Description | Data Inputs |
|---|---|---|
| **Predictive Maintenance** | ML models predict failure probability/remaining useful life from sensor + historical WO data | IoT sensor streams, meter readings, failure history |
| **Anomaly Detection** | Real-time detection of abnormal vibration/temperature/pressure patterns | SCADA/IoT time-series data |
| **Smart Work Order Prioritization** | AI-suggested priority/technician assignment based on historical resolution patterns and skill match | Historical WOs, technician skill/performance data |
| **NLP-based Breakdown Triage** | Auto-classify and route free-text breakdown descriptions to correct failure code/priority | Breakdown request text |
| **Spare Parts Demand Forecasting** | Forecast parts consumption to optimize reorder points | Historical consumption, PM schedules |
| **Computer Vision Inspection** | Image/video-based defect detection during technician checklist capture | Photos/videos from mobile WO execution |
| **Conversational Maintenance Assistant** | Chat interface for technicians to query manuals, log completion, or ask troubleshooting steps | Asset manuals, historical WO resolutions |
| **Root Cause Analysis Assistant** | AI-suggested root causes based on similar historical failure patterns | Historical RCA reports, failure codes |

**Architecture Note:** The current data model (Sections 8–9) is designed to capture the granular time-series, failure-code, and sensor-linkage data required to train these Phase 2 AI/ML models without re-architecture — i.e., "AI-ready by design."

---

## Document Control

| Version | Date | Author | Change Description |
|---|---|---|---|
| 1.0 | 2026-07-22 | Senior Solution Architect | Initial complete SRS |

**Next Steps:** Upon stakeholder sign-off of this SRS, proceed to technical architecture design (Phase 1 detailed design), followed by sprint-wise implementation planning. No code will be generated until this document is reviewed and approved.
