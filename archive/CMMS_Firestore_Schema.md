# Firestore Database Schema Design
## Enterprise CMMS System
**Version:** 1.0 | **Date:** July 22, 2026 | **Companion to:** CMMS SRS v1.0

---

## 1. Design Principles

1. **Multi-tenant by Plant** — every operational document carries `plantId` for security-rule scoping and query filtering.
2. **Denormalize for read speed** — frequently displayed parent fields (e.g., `assetName`, `technicianName`) are cached on child documents to avoid extra reads on list screens.
3. **Subcollections for unbounded, append-only data** — status history, labor logs, stock transactions, audit logs (never updated, only appended → cheap writes, no document-size limits).
4. **Top-level collections for entities queried across parents** — `workOrders`, `notifications`, `purchaseOrders` are top-level (not nested under plant) so a technician's "My Work Orders" query doesn't require a collection-group query across every plant.
5. **Collection groups** used where cross-parent querying is unavoidable (e.g., `statusHistory` across all work orders for audit).
6. **Aggregation documents** precomputed via Cloud Functions to avoid expensive `COUNT`/`SUM` queries on dashboards.
7. **Offline-first** — mobile writes use client-generated UUIDs as document IDs (not auto-ID) so offline-created documents sync without ID collisions.

---

## 2. Collection Map (Top-Level)

```
/organizations/{orgId}
/plants/{plantId}
/departments/{departmentId}
/assets/{assetId}
/pmSchedules/{pmId}
/workOrders/{woId}
/checklistTemplates/{templateId}
/parts/{partId}
/warehouses/{warehouseId}
/stockTransactions/{txnId}
/vendors/{vendorId}
/purchaseRequisitions/{prId}
/purchaseOrders/{poId}
/users/{userId}
/roles/{roleId}
/notifications/{notificationId}
/auditLogs/{logId}
/failureCodes/{codeId}
/dashboardMetrics/{plantId}_{dateId}
/counters/{counterId}                -- for sequential WO/PO numbering
```

Subcollections (nested under their parent document):
```
/workOrders/{woId}/statusHistory/{eventId}
/workOrders/{woId}/laborLogs/{logId}
/workOrders/{woId}/partsUsed/{lineId}
/workOrders/{woId}/attachments/{attachmentId}
/workOrders/{woId}/comments/{commentId}
/assets/{assetId}/meterReadings/{readingId}
/assets/{assetId}/documents/{docId}
/purchaseOrders/{poId}/lineItems/{lineId}
/purchaseOrders/{poId}/receipts/{grnId}
```

---

## 3. Entity-Relationship Overview

```
organizations (1) ──< plants (M)
plants (1) ──< departments (M)
plants (1) ──< assets (M) ──< assets (self-ref parentAssetId, hierarchy)
plants (1) ──< users (M)  [via plantIds array]
assets (1) ──< pmSchedules (M)
assets (1) ──< workOrders (M)
pmSchedules (1) ──< workOrders (M, generated)
workOrders (M) ──> users (1)  [assignedTo]
workOrders (1) ──< statusHistory / laborLogs / partsUsed / attachments / comments
parts (1) ──< stockTransactions (M)
parts (M) ──> warehouses (1)
workOrders (1) ──< stockTransactions (M, referenceWoId)
vendors (1) ──< purchaseOrders (M)
purchaseOrders (1) ──< lineItems (M) ──> parts (1)
purchaseOrders (1) ──< receipts (M) ──> stockTransactions (M, on receipt)
roles (1) ──< users (M)  [roleId]
users (1) ──< notifications (M)
* (any entity) ──< auditLogs (M) [entityType/entityId]
```

Firestore is a document store, so relationships above are implemented as **reference fields (IDs)**, not foreign keys — integrity is enforced at the application/Cloud Function layer, not the database layer.

---

## 4. Collection Schemas (Field-Level)

### 4.1 `/organizations/{orgId}`
| Field | Type | Notes |
|---|---|---|
| name | string | |
| industry | string | e.g., "Manufacturing" |
| subscriptionTier | string | |
| createdAt | timestamp | |
| settings | map | `{ dateFormat, currency, defaultTimezone }` |

### 4.2 `/plants/{plantId}`
| Field | Type | Notes |
|---|---|---|
| orgId | reference (string ID) | |
| name | string | |
| code | string | unique, e.g., "PLT-001" |
| address | map | `{ line1, city, state, country, geo (lat,lng) }` |
| timezone | string | IANA tz |
| priorityMatrix | map | overrides default; `{ P1: {...}, P2: {...} }` |
| slaMatrix | map | `{ P1: { ackMin, respMin, resMin }, ... }` |
| shifts | array<map> | `[{ name, startTime, endTime }]` |
| status | string | Active / Inactive |
| createdAt / updatedAt | timestamp | |

### 4.3 `/departments/{departmentId}`
| Field | Type | Notes |
|---|---|---|
| plantId | string | |
| name | string | |
| costCenterCode | string | |
| managerId | string (userId) | |

### 4.4 `/assets/{assetId}`
| Field | Type | Notes |
|---|---|---|
| plantId | string | indexed |
| departmentId | string | |
| parentAssetId | string \| null | hierarchy: Plant→Line→Machine→Component |
| assetCode | string | unique per plant |
| name | string | |
| category | string | e.g., "CNC Machine" |
| criticality | string | High / Medium / Low |
| status | string | Active / UnderMaintenance / Decommissioned / Disposed |
| manufacturer | string | |
| model | string | |
| serialNumber | string | |
| installDate | timestamp | |
| warrantyExpiry | timestamp | |
| meterReading | number | latest cached value |
| meterUnit | string | hours / cycles / km |
| qrCode | string | encoded asset lookup URL/ID |
| specSheetUrl | string | |
| photoUrl | string | |
| lastPmDate | timestamp | denormalized for list view |
| nextPmDueDate | timestamp | denormalized for list view / overdue flags |
| downtimeHoursYTD | number | rolling aggregate, updated by Cloud Function |
| createdAt / updatedAt | timestamp | |

**Subcollection** `/assets/{assetId}/meterReadings/{readingId}`
| Field | Type | Notes |
|---|---|---|
| value | number | |
| source | string | Manual / IoT |
| recordedBy | string (userId, null if IoT) | |
| recordedAt | timestamp | |

**Subcollection** `/assets/{assetId}/documents/{docId}`
| Field | Type | Notes |
|---|---|---|
| title | string | |
| type | string | Manual / Drawing / Warranty / Certificate |
| fileUrl | string | Cloud Storage path |
| uploadedBy | string | |
| uploadedAt | timestamp | |

### 4.5 `/pmSchedules/{pmId}`
| Field | Type | Notes |
|---|---|---|
| plantId | string | |
| assetId | string | |
| assetName | string | denormalized |
| title | string | |
| triggerType | string | Time / Meter / Condition |
| frequencyValue | number | e.g., 30 |
| frequencyUnit | string | Days / Weeks / Months / Hours / Cycles |
| checklistTemplateId | string | |
| lastCompletedAt | timestamp | |
| nextDueDate | timestamp | indexed for scheduler queries |
| assignedTeam | array<string> (userIds) | default assignment |
| isActive | boolean | |
| createdBy | string | |
| createdAt / updatedAt | timestamp | |

### 4.6 `/workOrders/{woId}`
| Field | Type | Notes |
|---|---|---|
| woNumber | string | business key, e.g., "PLT001-WO-2026-000123" |
| plantId | string | indexed |
| assetId | string | indexed |
| assetName | string | denormalized |
| pmScheduleId | string \| null | if auto-generated |
| type | string | PM / Breakdown / Inspection / Project |
| priority | string | P1 / P2 / P3 / P4 |
| status | string | New / Triaged / Assigned / Scheduled / InProgress / OnHold / Completed / PendingReview / Reopened / Closed / Archived / Rejected |
| description | string | |
| failureCodeId | string \| null | |
| requestedBy | string (userId) | |
| assignedTo | array<string> (userIds) | supports crew assignment |
| supervisorId | string | |
| scheduledStart / scheduledEnd | timestamp | |
| startedAt / completedAt / closedAt | timestamp | |
| slaAckDueAt / slaResponseDueAt / slaResolutionDueAt | timestamp | computed at triage |
| slaBreached | boolean | denormalized flag for fast filtering |
| checklistTemplateId | string | |
| checklistResult | map | `{ itemId: { status, value, notes } }` |
| permitRequired | boolean | |
| permitSignedBy | string \| null | |
| laborCostTotal | number | rolled up from laborLogs |
| partsCostTotal | number | rolled up from partsUsed |
| costTotal | number | laborCostTotal + partsCostTotal |
| geo | map \| null | `{ lat, lng }` cached from asset |
| isOfflineCreated | boolean | |
| clientUuid | string | for offline dedup |
| createdAt / updatedAt | timestamp | |

**Subcollection** `/workOrders/{woId}/statusHistory/{eventId}`
| Field | Type | Notes |
|---|---|---|
| fromStatus | string | |
| toStatus | string | |
| changedBy | string (userId) | |
| remarks | string | |
| timestamp | timestamp | |

**Subcollection** `/workOrders/{woId}/laborLogs/{logId}`
| Field | Type | Notes |
|---|---|---|
| technicianId | string | |
| technicianName | string | denormalized |
| startTime / endTime | timestamp | |
| hoursLogged | number | |
| hourlyRate | number | for cost calc |
| notes | string | |

**Subcollection** `/workOrders/{woId}/partsUsed/{lineId}`
| Field | Type | Notes |
|---|---|---|
| partId | string | |
| partCode | string | denormalized |
| qty | number | |
| unitCost | number | |
| warehouseId | string | |
| stockTxnId | string | link to stockTransactions |

**Subcollection** `/workOrders/{woId}/attachments/{attachmentId}`
| Field | Type | Notes |
|---|---|---|
| fileUrl | string | Cloud Storage path |
| fileType | string | image / video / audio / pdf |
| uploadedBy | string | |
| uploadedAt | timestamp | |

**Subcollection** `/workOrders/{woId}/comments/{commentId}`
| Field | Type | Notes |
|---|---|---|
| userId | string | |
| text | string | |
| createdAt | timestamp | |

### 4.7 `/checklistTemplates/{templateId}`
| Field | Type | Notes |
|---|---|---|
| plantId | string \| null | null = global template |
| name | string | |
| category | string | PM / Safety / Inspection |
| items | array<map> | `[{ itemId, label, inputType(boolean/number/text/photo), required }]` |
| version | number | |
| createdAt | timestamp | |

### 4.8 `/parts/{partId}`
| Field | Type | Notes |
|---|---|---|
| partCode | string | unique |
| description | string | |
| category | string | |
| uom | string | EA / L / KG / M |
| unitCost | number | |
| minQty | number | |
| maxQty | number | |
| reorderQty | number | |
| preferredVendorId | string | |
| warehouseStock | map | `{ warehouseId: qtyOnHand }` — denormalized multi-warehouse view |
| binLocations | map | `{ warehouseId: binCode }` |
| isActive | boolean | |
| createdAt / updatedAt | timestamp | |

### 4.9 `/warehouses/{warehouseId}`
| Field | Type | Notes |
|---|---|---|
| plantId | string | |
| name | string | |
| location | string | |
| managerId | string (userId) | |

### 4.10 `/stockTransactions/{txnId}`
| Field | Type | Notes |
|---|---|---|
| partId | string | indexed |
| partCode | string | denormalized |
| warehouseId | string | indexed |
| type | string | Issue / Return / Receipt / Adjustment / CycleCount |
| qty | number | signed (+/-) |
| referenceWoId | string \| null | |
| referencePoId | string \| null | |
| performedBy | string (userId) | |
| balanceAfter | number | snapshot for audit |
| timestamp | timestamp | |

### 4.11 `/vendors/{vendorId}`
| Field | Type | Notes |
|---|---|---|
| name | string | |
| contactPerson | string | |
| email / phone | string | |
| address | map | |
| rating | number | 1–5 |
| leadTimeDays | number | |
| categoriesSupplied | array<string> | |
| isActive | boolean | |

### 4.12 `/purchaseRequisitions/{prId}`
| Field | Type | Notes |
|---|---|---|
| plantId | string | |
| requestedBy | string | |
| status | string | Draft / PendingApproval / Approved / Rejected / ConvertedToPO |
| items | array<map> | `[{ partId, qty, estimatedCost }]` |
| approvedBy | string \| null | |
| createdAt / updatedAt | timestamp | |

### 4.13 `/purchaseOrders/{poId}`
| Field | Type | Notes |
|---|---|---|
| poNumber | string | business key |
| plantId | string | |
| vendorId | string | |
| vendorName | string | denormalized |
| prId | string \| null | |
| status | string | Draft / Sent / PartiallyReceived / Received / Closed / Cancelled |
| totalAmount | number | |
| createdBy | string | |
| approvedBy | string | |
| expectedDeliveryDate | timestamp | |
| createdAt / updatedAt | timestamp | |

**Subcollection** `/purchaseOrders/{poId}/lineItems/{lineId}`
| Field | Type | Notes |
|---|---|---|
| partId | string | |
| qtyOrdered | number | |
| qtyReceived | number | |
| unitCost | number | |

**Subcollection** `/purchaseOrders/{poId}/receipts/{grnId}`
| Field | Type | Notes |
|---|---|---|
| receivedBy | string | |
| items | array<map> | `[{ partId, qtyReceived }]` |
| receivedAt | timestamp | |

### 4.14 `/users/{userId}`
| Field | Type | Notes |
|---|---|---|
| name | string | |
| email | string | unique, indexed |
| phone | string | |
| roleId | string | |
| roleName | string | denormalized |
| plantIds | array<string> | scoping — user may belong to multiple plants |
| departmentId | string | |
| skillTags | array<string> | e.g., ["Electrical","Hydraulics"] |
| shiftId | string | |
| status | string | Active / Inactive |
| fcmTokens | array<string> | push notification tokens |
| lastLoginAt | timestamp | |
| createdAt | timestamp | |

### 4.15 `/roles/{roleId}`
| Field | Type | Notes |
|---|---|---|
| name | string | Super Admin / Manager / Planner / Supervisor / Technician / Storekeeper / Procurement / Requester / Auditor / Vendor |
| permissions | map | `{ moduleName: { create, read, update, delete, approve } }` (booleans) |
| isSystemRole | boolean | prevents deletion of default roles |

### 4.16 `/notifications/{notificationId}`
| Field | Type | Notes |
|---|---|---|
| userId | string | indexed |
| type | string | WOAssigned / SLABreach / PMDue / LowStock / ApprovalPending / WOStatusChange |
| title | string | |
| body | string | |
| referenceType | string | WorkOrder / PurchaseOrder / Asset |
| referenceId | string | |
| channel | array<string> | ["push","email","sms","inapp"] |
| status | string | Sent / Read |
| createdAt | timestamp | indexed |

### 4.17 `/auditLogs/{logId}`
| Field | Type | Notes |
|---|---|---|
| entityType | string | indexed, e.g., "workOrder" |
| entityId | string | indexed |
| action | string | Create / Update / Delete / StatusChange / Approve |
| performedBy | string (userId) | |
| performedByName | string | denormalized |
| diff | map | `{ field: { old, new } }` |
| timestamp | timestamp | indexed |
| plantId | string | for scoped audit queries |

### 4.18 `/failureCodes/{codeId}`
| Field | Type | Notes |
|---|---|---|
| code | string | |
| description | string | |
| category | string | Mechanical / Electrical / Hydraulic / Operator Error |

### 4.19 `/dashboardMetrics/{plantId}_{dateId}`
Precomputed daily aggregate (written by scheduled Cloud Function) to keep the KPI dashboard reads O(1):
| Field | Type | Notes |
|---|---|---|
| plantId | string | |
| date | string | YYYY-MM-DD |
| mttrHours | number | |
| mtbfHours | number | |
| pmCompliancePct | number | |
| slaCompliancePct | number | |
| openWoCount | number | |
| closedWoCount | number | |
| downtimeHours | number | |
| maintenanceCost | number | |
| inventoryFillRatePct | number | |

### 4.20 `/counters/{counterId}`
Used with Firestore transactions to generate sequential human-readable numbers (`counterId` = e.g. `"PLT001-WO-2026"`).
| Field | Type | Notes |
|---|---|---|
| lastValue | number | incremented transactionally |

---

## 5. Relationships Summary (Reference Fields)

| Child Collection | Reference Field(s) | Points To |
|---|---|---|
| plants | orgId | organizations |
| departments | plantId | plants |
| assets | plantId, departmentId, parentAssetId | plants, departments, assets (self) |
| pmSchedules | plantId, assetId, checklistTemplateId | plants, assets, checklistTemplates |
| workOrders | plantId, assetId, pmScheduleId, requestedBy, assignedTo[], supervisorId, failureCodeId, checklistTemplateId | plants, assets, pmSchedules, users, failureCodes, checklistTemplates |
| workOrders/statusHistory | changedBy | users |
| workOrders/laborLogs | technicianId | users |
| workOrders/partsUsed | partId, warehouseId, stockTxnId | parts, warehouses, stockTransactions |
| parts | preferredVendorId | vendors |
| stockTransactions | partId, warehouseId, referenceWoId, referencePoId, performedBy | parts, warehouses, workOrders, purchaseOrders, users |
| purchaseRequisitions | requestedBy, approvedBy, items[].partId | users, parts |
| purchaseOrders | plantId, vendorId, prId, createdBy, approvedBy | plants, vendors, purchaseRequisitions, users |
| purchaseOrders/lineItems | partId | parts |
| users | roleId, plantIds[], departmentId | roles, plants, departments |
| notifications | userId, referenceId | users, (polymorphic) |
| auditLogs | entityId, performedBy, plantId | (polymorphic), users, plants |

---

## 6. Composite Indexes (`firestore.indexes.json`)

```json
{
  "indexes": [
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plantId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "assignedTo", "arrayConfig": "CONTAINS" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "assetId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plantId", "order": "ASCENDING" },
        { "fieldPath": "slaBreached", "order": "ASCENDING" },
        { "fieldPath": "slaResolutionDueAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "pmSchedules",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plantId", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "nextDueDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "assets",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plantId", "order": "ASCENDING" },
        { "fieldPath": "parentAssetId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "assets",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plantId", "order": "ASCENDING" },
        { "fieldPath": "criticality", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "stockTransactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partId", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "auditLogs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "entityType", "order": "ASCENDING" },
        { "fieldPath": "entityId", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "purchaseOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plantId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "statusHistory",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

*Note: Simple single-field equality/range queries (e.g., `where("plantId","==",x)`) are covered automatically by Firestore's default single-field indexes and are not listed above.*

---

## 7. Cloud Function Triggers (Data Integrity & Automation)

| Trigger | Event | Action |
|---|---|---|
| `onWorkOrderStatusChange` | Update on `workOrders/{woId}` where `status` changes | Write `statusHistory` entry; recalc `slaBreached`; fire notification |
| `onWorkOrderCreate` | Create on `workOrders/{woId}` | Assign `woNumber` via `counters` transaction; compute SLA due timestamps from plant's `slaMatrix` |
| `onPartsUsedWrite` | Create on `workOrders/{woId}/partsUsed/{lineId}` | Create matching `stockTransactions` doc (type=Issue); decrement `parts.warehouseStock[warehouseId]` atomically |
| `onStockBelowReorder` | Update on `parts/{partId}` where `warehouseStock` < `reorderQty` | Auto-create `purchaseRequisitions` draft; notify Storekeeper + Procurement |
| `onPmScheduleDue` | Scheduled (cron, daily) | Query `pmSchedules` where `nextDueDate <= today`; auto-create `workOrders`; advance `nextDueDate` |
| `onWorkOrderClose` | Update on `workOrders/{woId}` where `status == Closed` | Roll up `costTotal`; update `assets.lastPmDate`/`downtimeHoursYTD`; write `dashboardMetrics` increment |
| `onAnyAuditableWrite` | Create/Update/Delete on key collections | Write `auditLogs` entry with diff |
| `onPOReceiptCreate` | Create on `purchaseOrders/{poId}/receipts/{grnId}` | Create `stockTransactions` (type=Receipt); update `parts.warehouseStock`; update PO `status` |
| `dailyMetricsRollup` | Scheduled (cron, nightly per plant) | Aggregate MTTR/MTBF/SLA%/PM%/downtime into `dashboardMetrics/{plantId}_{dateId}` |

---

## 8. Security Rules Strategy (Summary — full rules to be authored in implementation phase)

- All reads/writes require `request.auth != null`.
- Plant-scoping: `resource.data.plantId in get(/databases/$(db)/documents/users/$(request.auth.uid)).data.plantIds`.
- Role-based field-level checks via custom claims (`request.auth.token.role`) synced from `/roles/{roleId}.permissions` at login (Cloud Function sets custom claims on role assignment).
- Technicians: write access to `workOrders` limited to documents where their `uid` is in `assignedTo`.
- `auditLogs` and `statusHistory`: write-only via Cloud Functions (server-side), no direct client writes — enforced by rules denying client writes to these collections entirely.
- `counters`: writable only via transactions inside Cloud Functions, denied to clients.

---

## 9. Storage Sizing & Growth Notes

| Collection | Est. growth (mid-size plant, 500 assets) | Mitigation |
|---|---|---|
| workOrders | ~50–100/day → ~30k/year | Archive `status=Archived` docs older than 2 yrs to cold storage/BigQuery export |
| stockTransactions | ~200/day | Same archival strategy; also source for BigQuery analytics |
| auditLogs | ~500/day | Export to BigQuery via scheduled export; retain 7 yrs per compliance, but not necessarily in hot Firestore |
| dashboardMetrics | 1 doc/plant/day | Negligible; keep indefinitely for trend charts |

**Recommendation:** Set up a nightly Firestore → BigQuery export (via Cloud Dataflow or built-in export) for `auditLogs`, `stockTransactions`, and closed `workOrders` to keep hot-path Firestore collections lean while preserving full historical/reporting depth.

---

This schema is ready for backend/API development. No UI has been designed at this stage, per your instruction — next step would be the API/service layer implementation over this schema, or the screen-by-screen UI design, whichever you'd like to tackle first.
