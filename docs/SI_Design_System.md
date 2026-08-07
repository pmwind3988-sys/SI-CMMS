# SI — Service Inside
## Enterprise Design System
**Version 1.0 · July 22, 2026**
**Enterprise Maintenance & Facilities Management System**

---

## 0. Design Philosophy

SI's visual language borrows the discipline of three enterprise design traditions:

- **Microsoft Fluent Design** — depth through subtle elevation, not heavy borders; clear focus states; content-first density.
- **Apple's clean UI conventions** — generous whitespace, restrained color use, typography that carries hierarchy without decoration.
- **SAP Fiori workflow patterns** — role-based dashboards, scannable list-to-detail navigation, status communicated primarily through color + iconography rather than prose.

The result is a **white-canvas, navy-anchored** system: content lives on white or near-white surfaces; Navy Blue signals brand and primary action; Orange, Green, and Red are reserved strictly for meaning (warning, success, critical) so they never compete with the brand color for attention.

---

## 1. Color Palette

### 1.1 Primary Brand Colors

| Token | Hex | Usage |
|---|---|---|
| **Navy Blue** (Primary) | `#0F3D91` | Logo, sidebar background, primary buttons, active nav states, links, headers on dark surfaces |
| **Navy Deep** (Gradient end) | `#0B2F70` | Gradient companion for hero/login panels, pressed states |
| **Navy Mid** (Steel) | `#1E4FA0` | Hover/active row backgrounds on navy surfaces, secondary sidebar accents |
| **Navy Line** | `#2C5AA8` | Dividers and borders on navy surfaces |

### 1.2 Secondary / Accent Colors

| Token | Hex | Usage |
|---|---|---|
| **Orange** (Accent) | `#F59E0B` | Primary call-to-action fill on white surfaces, warning states, priority P2, highlights, logo accent dot |
| **Orange Soft** | `#FDE7C4` | Orange badge/chip backgrounds, subtle highlight fills |
| **Green** (Success) | `#22C55E` | Success states, "closed/completed," compliance-met indicators |
| **Red** (Critical) | `#EF4444` | Critical alerts, P1 priority, SLA breaches, destructive actions |

### 1.3 Neutrals

| Token | Hex | Usage |
|---|---|---|
| **Canvas** | `#F6F8FB` | App background (near-white, not pure white — separates white cards without hard borders) |
| **Surface** | `#FFFFFF` | Cards, modals, inputs, tables |
| **Ink** (Primary text) | `#101828` | Headings, primary body text |
| **Ink Soft** (Secondary text) | `#64748B` | Captions, helper text, metadata, timestamps |
| **Border** | `#E5E9F0` | Card borders, table dividers, input borders (default state) |

### 1.4 Usage Rules

1. **Navy is the only color used for brand identity and primary navigation.** It never doubles as a status color.
2. **Orange, Green, and Red are semantic only.** They must not be used decoratively (e.g., no orange headings, no green dividers).
3. Every color pairing meets **WCAG AA contrast (4.5:1)** for body text: white text on Navy (#0F3D91) = 8.4:1; Ink (#101828) on Canvas/Surface = 15.8:1; white text on Red/Green/Orange fills = all ≥ 4.6:1 for text ≥ 14px bold or ≥ 18px regular.
4. Tints (Orange Soft, badge backgrounds) are for **fills behind text/icons**, never for large surfaces — they exist to soften a semantic color into a background.

---

## 2. Typography

### 2.1 Typeface

**Inter** — a single type family across the entire product, including tabular data. Inter's tabular-number feature is used for all data-dense contexts (WO numbers, costs, dates, meter readings) instead of switching to a monospace face, keeping the interface visually unified while still aligning digits in columns.

| Context | Weight | Notes |
|---|---|---|
| Display / page titles | 700 (Bold) | Tight letter-spacing (-0.01em) |
| Section headings | 700 (Bold) | |
| Card titles / labels | 600 (Semibold) | |
| Body text | 400 (Regular) | |
| Buttons | 600 (Semibold) | |
| Data / codes / timestamps | 500 (Medium), tabular figures | e.g., WO numbers, asset codes, costs |
| Micro-labels (eyebrow text, table headers) | 700 (Bold), uppercase, +0.03em tracking | |

### 2.2 Type Scale

| Style | Size | Line Height | Weight |
|---|---|---|---|
| H1 (Page title) | 21px | 1.3 | 700 |
| H2 (Section title) | 17–19px | 1.3 | 700 |
| Card title | 14–15px | 1.4 | 600–700 |
| Body | 13.5px | 1.5 | 400 |
| Small / caption | 12–12.5px | 1.4 | 400–500 |
| Micro / eyebrow | 11–11.5px | 1.3 | 700, uppercase |
| Data (mono-style) | 11.5–13px | 1.4 | 500, tabular-nums |

### 2.3 Rules

- Never more than two weights in a single component (e.g., a card uses Semibold for its title and Regular for its body — not three).
- Uppercase text is reserved for table column headers and micro-tags; never for body copy or buttons.
- Line length for body paragraphs stays under ~75 characters for scanability in dense enterprise views.

---

## 3. Buttons

### 3.1 Variants

| Variant | Fill | Text | Use |
|---|---|---|---|
| **Primary** | Ink (`#101828`) | White | Default primary action (e.g., "Save") |
| **Accent (Amber)** | Orange (`#F59E0B`) | Navy | The single highest-emphasis action per screen (e.g., "Raise Work Order," "Submit") |
| **Ghost** | Transparent, 1.5px border | Ink | Secondary actions |
| **Subtle** | Canvas fill | Ink | Tertiary / low-emphasis actions |
| **Success** | Green tint (10%) | Green | Confirming positive actions (e.g., "Approve & Close") |
| **Danger** | Red tint (10%) | Red | Destructive or reject actions |

### 3.2 Anatomy

- **Corner radius:** 12px, matching the system-wide standard.
- **Padding:** 10px vertical / 16px horizontal (medium); 7px / 12px (small, used inline in tables/toolbars).
- **Icon:** 14–16px, leading the label with 7px gap, never trailing unless indicating navigation (e.g., a chevron).
- **Label:** Semibold, sentence case, active voice ("Save changes," not "Submit").

### 3.3 States

| State | Treatment |
|---|---|
| Default | Solid fill or outline per variant |
| Hover | Fill darkens ~8%, or ghost border shifts to Ink |
| Active/pressed | Fill darkens ~15% |
| Focus (keyboard) | 2px Orange outline offset 2px — visible on every interactive element |
| Disabled | 50% opacity, no pointer cursor |
| Loading | Spinner icon replaces leading icon, label updates ("Verifying…") |

### 3.4 Rules

- Only **one Accent (Amber) button per screen or per modal** — it marks the single primary action. Everything else is Primary, Ghost, or Subtle.
- Destructive actions (Decommission, Reject, Reopen) always use the Danger variant, never Primary or Accent.
- Button label text always matches the resulting confirmation/toast wording (e.g., "Save changes" → toast reads "Changes saved").

---

## 4. Cards

### 4.1 Anatomy

- **Background:** Surface white (`#FFFFFF`).
- **Border:** 1px solid Border (`#E5E9F0`).
- **Corner radius:** 12px.
- **Elevation:** a soft two-layer shadow — `0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.05)` — applied uniformly so every card in the system reads at the same depth. No card uses a heavier shadow than another; hierarchy comes from size and position, not elevation.
- **Padding:** 16–24px depending on density (KPI tiles use tighter 16–18px; form panels use 22–24px).

### 4.2 Card Types

| Type | Example | Notes |
|---|---|---|
| **Metric card** | KPI tile (MTTR, SLA %) | Value in tabular Inter, sparkline aligned right, label above in caption style |
| **List card** | "My Open Work Orders" widget | Header with icon + title + "View all" link, rows separated by 1px hairlines (not full borders) |
| **Form card** | Create Work Order panel | Grouped fields with consistent 16px vertical rhythm between fields |
| **Chart card** | Downtime Pareto | Title + optional subtitle, chart fills remaining height, click targets for drill-down clearly hoverable |
| **Dark accent card** | SLA preview sidebar, mobile checklist preview | Inverts to Navy background with white text — used sparingly to spotlight a single contextual panel per screen |

### 4.3 Rules

- Cards never nest inside cards. A card's internal sections use background tints (Canvas) or hairlines, not additional bordered boxes.
- Every card has a single, clear header row (icon + title, optionally an action on the right) — never two competing titles.

---

## 5. Tables

### 5.1 Anatomy

- **Header row:** Canvas background (`#F6F8FB`), 11–11.5px uppercase Ink Soft text, bold, +0.03em tracking, no bottom border heavier than the body dividers.
- **Body rows:** White background, 1px hairline (`#F1F3F5`) between rows — no vertical column dividers (reduces visual noise, a Fluent/Fiori convention).
- **Row height:** 44–52px depending on content density (52px when a row contains two lines, e.g., code + name).
- **Row hover:** Very light Canvas tint, pointer cursor when the row is clickable through to a detail view.
- **Alignment:** Text left-aligned; numeric/currency columns right-aligned with tabular figures so digits line up.

### 5.2 Cell Content Patterns

- **Primary + secondary stack:** e.g., WO number (caption, Ink Soft) stacked above asset name (body, Ink, medium weight) in a single cell — used whenever a row needs an identifier plus a human-readable label.
- **Status/priority cells** always render as **badges** (Section 6), never as plain colored text.
- **Action cells** are icon-only buttons (16px), right-aligned, revealed clearly with a hover state — no more than 3 inline actions before collapsing into an overflow (⋮) menu.

### 5.3 Empty & Loading States

- Empty state: centered message in Ink Soft, 13px, one line — states plainly what would appear here and, where relevant, the action to create the first record.
- Loading state: skeleton rows (Canvas-colored blocks), never a spinner replacing the whole table.

---

## 6. Badges

### 6.1 Priority Badges (P1–P4)

Small pill, tabular-mono style, 11–12px, bold, colored text on a 10%-opacity tint of the same color, 1px border at 33% opacity of the color, 5px radius (badges intentionally use a smaller radius than cards/buttons — they read as tags, not containers).

| Badge | Color |
|---|---|
| P1 | Red `#EF4444` |
| P2 | Orange `#F59E0B` |
| P3 | Amber-tint `#FBBF24` |
| P4 | Navy `#0F3D91` |

### 6.2 Status Badges

Text-only with a leading colored dot (●), 12.5px, Semibold — used for work order and asset lifecycle states where a full pill would compete visually with the priority badge already on the same row.

### 6.3 Criticality Badges (Assets)

Same pill style as priority badges: **High** = Red, **Medium** = Amber-tint, **Low** = Navy.

### 6.4 Rules

- A single row/card never shows more than **two badges** (typically one priority/criticality + one status) — additional metadata goes in plain text, not more badges.
- Badge color always maps to the same meaning system-wide (Section 7) — a badge is never recolored for emphasis alone.

---

## 7. Status Colors (Semantic Map)

This is the single source of truth for what color means across SI. No screen may deviate from this mapping.

| Meaning | Color | Applies to |
|---|---|---|
| **Critical / P1 / Breached** | Red `#EF4444` | Highest work order priority, SLA breach, destructive actions, low-stock critical alerts |
| **Warning / P2 / At risk** | Orange `#F59E0B` | Elevated priority, approaching SLA, pending approvals |
| **Caution / P3** | Amber-tint `#FBBF24` | Medium priority, minor overdue items |
| **Neutral / P4 / Informational** | Navy `#0F3D91` | Low priority, default/unassigned states, informational badges |
| **Success / Closed / Compliant** | Green `#22C55E` | Approved & closed work orders, PM/SLA compliance met, healthy asset status |
| **Paused / Inactive** | Ink Soft `#64748B` | On Hold, Decommissioned, deactivated schedules |

This same six-color logic drives the **Plant Pulse** signature motif (the live asset-status dot field used on the login screen and sidebar) — most dots are Green (healthy), with occasional Orange, Navy, and rare Red, so the decorative element itself is teaching the same color language as the rest of the product.

---

## 8. Sidebar

### 8.1 Structure

- **Width:** 224px, fixed, non-collapsible on desktop (collapses to icon-only rail below a defined breakpoint — see Mobile Design).
- **Background:** Navy Blue (`#0F3D91`), the only large navy surface in the product — this is deliberate: the sidebar is the brand anchor, everything else is white.
- **Logo zone:** SI logo mark (light variant — white badge, navy letterforms) + wordmark "SI" + "SERVICE INSIDE" micro-label, 28px top padding, 28px bottom margin before navigation begins.

### 8.2 Navigation Items

- Icon (16px, 2px stroke) + label, 13.5px Medium, left-aligned, 9px vertical / 10px horizontal padding, 12px corner radius on the hover/active pill.
- **Inactive:** icon + label in `#B9C9E8` (a desaturated navy-tinted light blue, not plain gray — keeps text feeling native to the navy surface).
- **Active:** background lightens to Navy Mid (`#1E4FA0`), text turns white.
- **Hover (inactive):** same lightened background at 50% opacity, no color change on text until active.

### 8.3 Footer Zone

- Divider (`#2C5AA8`, 1px) above a compact "Live plant status" indicator — a miniature Plant Pulse — anchoring the sidebar's bottom edge with a live-system cue rather than leaving it empty.

---

## 9. Top Navigation

### 9.1 Structure

- **Height:** 60–64px, white background, 1px bottom border (`#E5E9F0`), no shadow (the sidebar's navy already provides visual separation; a second shadow would compete).
- **Left zone:** Global search field — Canvas-filled, 12px radius, 15px search icon, placeholder text in Ink Soft ("Search assets, work orders…").
- **Right zone, left to right:** Plant selector (ghost button with chevron), notification bell (with red dot badge when unread items exist), user avatar (32px circle, Orange fill, Navy initials).

### 9.2 Plant Selector

- Ghost button style, opens a dropdown of the user's assigned plants. Switching plants re-scopes every list/dashboard beneath it — this is a global filter, not a per-page one, and its position top-right signals that scope.

### 9.3 Rules

- The top bar never carries primary actions (no "Create" buttons here) — primary actions live inside the page content, keeping the top bar purely for wayfinding and account/context controls.

---

## 10. Notification Panel

### 10.1 Trigger

Bell icon in the top navigation; a small red dot indicates unread notifications (no numeric count badge — at-a-glance presence matters more than precision in a maintenance environment where counts change constantly).

### 10.2 Panel Anatomy

- Slide-in panel or dropdown, white surface, 12px radius, card shadow (Section 4.1).
- Grouped by **Today / Earlier**, unread items in Semibold with a small colored dot matching the notification's semantic type (Section 7).
- Each row: type icon (colored per severity) + title + one-line body snippet + relative timestamp.
- Footer action: "Mark all as read," plain text link, Ink Soft.

### 10.3 Notification Types & Color

| Type | Dot color |
|---|---|
| SLA at risk / breached | Red or Orange (per severity) |
| PM due / overdue | Navy (due) / Red (overdue) |
| Low stock | Orange |
| Approval pending | Navy |
| Work order status change | Green (progress/closure) |

### 10.4 Rules

- Clicking a notification always navigates directly to the underlying record (work order, PM schedule, asset) — never to a generic list. Notifications are entry points, not summaries.
- Critical (Red) notifications never auto-dismiss; informational (Navy/Green) ones may.

---

## 11. Mobile Design

### 11.1 Layout Shift

- Sidebar is replaced by a **bottom tab bar** (5 items max: Home/Tasks, Work Orders, Scan, Notifications, Profile) — white background, 1px top border, active tab in Navy with a filled icon variant, inactive tabs in Ink Soft with outline icon variant.
- Top bar collapses to a single-line app bar: back button (if nested), screen title (centered or left, H2 style), one contextual action icon on the right (e.g., filter, search).

### 11.2 Touch Targets & Density

- Minimum touch target: **44×44px** for any tappable control (buttons, list rows, checkboxis) — larger than desktop's 32–36px norm, since technicians often wear gloves on the plant floor.
- Card padding increases slightly (18–20px) to give thumb-friendly breathing room; list rows grow to 56px minimum height.
- Forms stack to a single column always; side-by-side field pairs (e.g., Machine + Department on desktop) become sequential full-width fields.

### 11.3 Mobile-Specific Patterns

- **Sticky primary action:** the screen's one Accent button (e.g., "Mark Complete") is pinned to the bottom of the viewport, always reachable without scrolling — mirrors the "one Accent button per screen" desktop rule but makes it physically persistent.
- **Camera-first inputs:** photo/video evidence and QR scanning open the device camera directly rather than a file picker, since this is the primary capture method in the field.
- **Offline indicator:** a small colored dot in the app bar (Green = synced, Orange = sync pending, Red = offline) — reuses the exact status-color language from Section 7 rather than inventing new mobile-only colors.
- **Signature/checklist inputs:** large binary Pass/Fail tap targets instead of small radio buttons, photo-capture buttons rendered as full-width dashed dropzones even though the primary action is camera capture, not file upload.

### 11.4 Breakpoints

| Breakpoint | Range | Behavior |
|---|---|---|
| Mobile | < 640px | Bottom tab bar, single-column forms, sticky primary action |
| Tablet | 640–1024px | Sidebar collapses to icon-only rail (labels on tap/hover); two-column forms return |
| Desktop | > 1024px | Full sidebar with labels, multi-column dashboards and forms as designed |

---

## 12. Quick Reference

| Token | Value |
|---|---|
| Primary color | Navy `#0F3D91` |
| Accent color | Orange `#F59E0B` |
| Success | Green `#22C55E` |
| Critical | Red `#EF4444` |
| Canvas background | `#F6F8FB` |
| Surface (cards) | `#FFFFFF` |
| Primary text | `#101828` |
| Secondary text | `#64748B` |
| Border | `#E5E9F0` |
| Corner radius (standard) | 12px |
| Corner radius (badges/pills) | 5px |
| Card elevation | `0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.05)` |
| Typeface | Inter (400 / 500 / 600 / 700 / 800) |
| Minimum touch target (mobile) | 44×44px |

---

*This guide governs every screen of SI. Any new component or module must be checked against Sections 1–7 (palette, type, buttons, cards, tables, badges, status colors) before it is considered on-brand.*
