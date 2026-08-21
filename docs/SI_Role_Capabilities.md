# SI — Who Can Do What

A plain-English capability reference for the five roles plus the Superuser.

Written for the people using the app, not for the people building it. Every line
below was read off the live rules — the database policies, the status-transition
table and the screen gates — not off an intention. Where the app *looks* like it
allows something the database refuses, the database wins and you get an error
message, so this document follows the database.

---

## 0. Five things to know before reading the table

**1. An account can hold more than one role.** "Supervisor + Technician" is a real
account, not a workaround. What you are allowed to do is **everything all your
roles allow, added together** — never the highest one only.

**2. The dashboard switcher changes the view, not your permissions.** If you hold
two roles you can flip between their dashboards. That only changes which queue you
are looking at. It never takes a permission away and never grants one.

**3. A role change takes up to an hour to bite.** Roles, and being activated or
deactivated, travel in your sign-in token, and that token is refreshed roughly
hourly. Sign out and back in to make a change take effect immediately.

**4. "Superuser" is not a sixth job title.** It is one specially marked
Administrator account, held by IT. It exists so that there is always somebody who
can fix an Administrator — because Administrators deliberately cannot fix each
other.

**5. The seniority ladder.** Requester → Technician → Supervisor → Maintenance
Manager → Administrator → Superuser. The rule that runs through all account
administration is: **you may act on your own account, or on an account below you.
Never on a peer, never on someone above you.**

---

## 1. The master table

Legend: **Yes** · **No** · **Own** = only records that are yours · **Below you** =
only people ranked lower than you.

| | Requester | Technician | Supervisor | Maint. Manager | Administrator | Superuser |
|---|---|---|---|---|---|---|
| **Signing in and your own account** | | | | | | |
| Sign in with work email or employee number | Yes | Yes | Yes | Yes | Yes | Yes |
| Change your own password | Yes | Yes | Yes | Yes | Yes | Yes |
| Use "Forgot password" yourself | Yes¹ | Yes¹ | Yes¹ | Yes¹ | Yes¹ | Yes¹ |
| Edit your own name, phone, photo | Yes | Yes | Yes | Yes | Yes | No² |
| Change your own role or department | No | No | No | No | No | No |
| Deactivate or reactivate yourself | No | No | No | No | No | No |
| **Seeing work orders** | | | | | | |
| Work orders you raised | Own | — | Yes | Yes | Yes | Yes |
| Work orders assigned to you | — | Own | Yes | Yes | Yes | Yes |
| Every work order in the plant | No | No | Yes | Yes | Yes | Yes |
| **Raising and editing** | | | | | | |
| Raise a work order | Yes | No³ | Yes | Yes | Yes | Yes |
| Raise one on somebody else's behalf | No | No | Yes | Yes | Yes | Yes |
| Edit the details while it is still **Open** | Own | No | Yes | Yes | Yes | Yes |
| Edit the details once work has started | No | No | No | No | No | No⁴ |
| Delete a work order outright | No⁵ | No⁵ | No⁵ | No⁵ | Yes | Yes |
| **Moving a job through the workflow** | | | | | | |
| Assign a technician | No | No | Yes | Yes | Yes | Yes |
| Reassign to a different technician | No | No | Yes | Yes | Yes | Yes |
| Accept or decline an assignment | No | Own | No | Yes | Yes | Yes |
| On the way / On site / Start repair | No | Own | No | Yes | Yes | Yes |
| Waiting for spare part, and resume | No | Own | No | Yes | Yes | Yes |
| Start testing / record a failed test | No | Own | No | Yes | Yes | Yes |
| Mark completed | No | Own | No | Yes | Yes | Yes |
| Verify and close a completed job | Own | No | No | Yes | Yes | Yes |
| Reopen a completed job | Own | No | No | Yes | Yes | Yes |
| Assign a job to **yourself** | No | No | No | No | No | No |
| Skip a step, or unstick a stuck record | No | No | No | No | Yes | Yes |
| **Comments and photos** | | | | | | |
| Comment on a work order you can open | Yes | Yes | Yes | Yes | Yes | Yes |
| Edit your own comment | Yes | Yes | Yes | Yes | Yes | Yes |
| Edit somebody else's comment | No | No | No | No | Yes | Yes |
| Delete your own comment | Yes | Yes | Yes | Yes | Yes | Yes |
| Delete somebody else's comment | No | No | No | Yes | Yes | Yes |
| Attach a photo or document | Yes | Yes | Yes | Yes | Yes | Yes |
| Delete an attachment | No | No | No | Yes | Yes | Yes |
| **Departments, equipment and settings** | | | | | | |
| Add a new department from the raise form | Yes | Yes | Yes | Yes | Yes | Yes |
| Rename a department | No | No | No | Yes | Yes | Yes |
| Delete a department | No | No | No | No | Yes | Yes |
| Add or edit equipment | No | No | Yes | Yes | Yes | Yes |
| Delete equipment | No | No | No | No | Yes | Yes |
| Rename statuses, priorities, impact levels, WO types, safety severities | No | No | No | No | Yes | Yes |
| Change the SLA response and resolution times | No | No | No | No | Yes | Yes |
| Change who is allowed to delete work orders | No | No | No | No | No | Yes |
| **People** | | | | | | |
| Open **Admin → Users** | No | No | No | No | Yes | Yes |
| Create an account | No | No | No | No | Below you | Yes |
| Create another **Administrator** | No | No | No | No | No | Yes |
| Change somebody's roles | No | No | No | No | Below you | Yes |
| Activate or deactivate an account | No | No | No | No | Below you | Yes |
| Email somebody a password-reset link | No | No | No | No | Below you | Yes |
| Set somebody else's password directly | No | No | No | No | No | Yes |
| Change somebody else's sign-in email | No | No | No | No | No | Yes |
| Delete an account | No | No | No | No | No | Yes⁶ |
| Edit another Administrator | No | No | No | No | No | Yes |
| See and manage test accounts | No | No | No | No | No | Yes |
| **Screens** | | | | | | |
| Your own dashboard | Yes | Yes | Yes | Yes | Yes | Yes |
| Work Orders list | Yes | Yes | Yes | Yes | Yes | Yes |
| Notifications | Yes | Yes | Yes | Yes | Yes | Yes |
| Admin → Users, Admin → Settings | No | No | No | No⁷ | Yes | Yes |

¹ Only if the account has a real work email address on it. Accounts still carrying
a placeholder address cannot be sent anything, and the app says so rather than
pretending to send.

² A Superuser account is administered from the database only — that is what the
mark is for. Even its own holder cannot edit it from inside the app.

³ A **Technician-only** account does not raise work orders and is not offered the
button. Anyone who also holds Requester, Supervisor, Manager or Administrator can.

⁴ Once a job leaves Open, its details change only through workflow steps, which
each record who did what and when. This is deliberate, not a missing feature.

⁵ Not by default. A Superuser can switch work-order deletion on for a whole role
in **Admin → Settings → Permissions**. If they do, that role can delete only work
orders it could already see.

⁶ And only if that person has never touched a work order. See §4.

⁷ A Maintenance Manager sees everything about work orders and nothing about
accounts. Admin screens are Administrator-only.

---

## 2. Role by role, in detail

### Requester

The person who reports a problem and confirms it was fixed.

**Can**

- Raise a work order: pick the equipment, the type, the priority, the impact, add
  a description and photos. If the department is missing from the picker they can
  add it themselves with "+ Add new".
- See every work order **they** raised, and its full history and comments.
- Edit their own work order's details for as long as it is still **Open** — that
  is, until a Supervisor assigns it.
- **Verify and close** a job the technician has marked Completed.
- **Reopen** it instead, with a reason, if the fix did not hold. It goes back to
  Repairing with the same technician.
- Comment and attach photos on their own jobs, and edit or delete their own
  comments.
- Get notified when their job is assigned, completed, or breaches SLA.

**Cannot**

- See anybody else's work orders. Their dashboard and list contain only their own.
- Assign work to a technician, or choose who gets it.
- Do any of the field steps — Accept, On the way, On site, Repairing, Testing,
  Completed all belong to the technician.
- Change their own work order after it has been assigned. From that point the
  workflow is the only way anything changes.
- Delete a work order (unless a Superuser has switched that on for Requesters).
- Delete somebody else's comment, or any attachment.
- Rename or remove a department they added — only add one.
- See any administration screen, or anything about other people's accounts.

### Technician

The person who does the work.

**Can**

- See the jobs **assigned to them**, newest first, with the SLA clock on each.
- **Accept** an assignment, or **Decline** it with a reason — declining clears them
  off the job and puts it back in the Supervisor's queue.
- Walk the job forward: On the way → On site → Start repair → (Waiting for spare
  part, with a reason, and back) → Start testing → **Mark completed** with
  resolution notes.
- Record a **failed test**, with a reason, which sends the job back to Repairing.
- Comment and attach photos — before/after pictures, part numbers, meter readings.
- Edit and delete their own comments.

**Cannot**

- See any job that is not assigned to them, including unassigned ones.
- Assign or reassign anything, to themselves or to anybody else.
- Raise a work order, if Technician is the only role they hold.
- Verify and close their own work — that is the Requester's or Manager's step, on
  purpose.
- Reopen a completed job.
- Skip a step. The order is fixed, and each step's required field (decline reason,
  spare-part reason, test-failure reason, resolution notes) must be filled in.
- Delete a work order, another person's comment, or any attachment.

### Supervisor

The person who triages the queue and decides who does what.

**Can**

- See **every work order in the plant**, in any status, whoever raised it. (This
  is no longer limited to their own department.)
- **Assign** an open work order to a technician.
- **Reassign** a job at any stage — before acceptance, or mid-flight while the
  technician is travelling, on site, repairing, waiting for a part or testing.
  Reassigning mid-flight requires choosing a *different* technician.
- Raise a work order on somebody's behalf.
- Edit any work order's details while it is still Open.
- Add and edit **equipment** records.
- Comment and attach on anything they can see.
- See the plant-wide dashboard: the unassigned queue, SLA health, breakdowns by
  department and machine.

**Cannot**

- Do the technician's steps. A Supervisor cannot Accept, travel, repair, test or
  complete — unless they also hold the Technician role, and then only for jobs
  assigned to them.
- **Assign a job to themselves**, even if they hold Technician too. If one person
  is the only Supervisor *and* the only Technician on shift, a Manager or
  Administrator has to do the assigning.
- Verify and close a completed job (that is the Requester or the Manager).
- Delete a work order, unless a Superuser has switched it on for Supervisors — and
  even then only jobs a Supervisor can already see.
- Delete equipment or departments; rename departments.
- Reach any admin screen. Supervisors do not manage accounts in this app.

### Maintenance Manager

Full authority over work, none over accounts.

**Can**

- Everything a Supervisor can: see the whole plant, assign, reassign, raise on
  behalf, edit while Open.
- **Act at any point in the workflow.** A Manager can accept, decline, travel,
  repair, order a part, test, complete, verify, close and reopen — on any job, not
  only their own. This exists so a job never stalls because somebody is off shift.
- Rename departments.
- Add and edit equipment.
- Delete **anybody's** comments and attachments.
- See the manager dashboard: monthly trend, department and machine breakdowns,
  technician performance, SLA compliance.

**Cannot**

- Open Admin → Users or Admin → Settings. Account and reference-data
  administration is Administrator-only, and Managers are explicitly *not* let in.
- Create accounts, change anyone's role, activate or deactivate anyone, or reset
  anyone's password.
- Change SLA targets, priorities, statuses, impact levels, work order types or
  safety severities.
- Delete departments or equipment.
- Skip a workflow step. A Manager can perform every step, but still in order —
  only an Administrator bypasses the sequence.
- Assign a job to themselves.

### Administrator

Runs the system: accounts, reference data, and rescuing stuck records.

**Can**

- Everything a Manager can, on every work order.
- **Bypass the status sequence** to correct a record that has got stuck in the
  wrong state. This is the one place the fixed workflow can be overridden, and it
  is logged like everything else.
- **Delete work orders** (the default grant). Deleting archives a snapshot of the
  record first, and removes its comments, attachments and notifications with it.
  It cannot be undone.
- Open **Admin → Users**: create accounts, change roles, change departments,
  activate and deactivate, correct names and phone numbers.
- **Email a password-reset link** to anyone below them. The person then chooses
  their own password.
- Open **Admin → Settings**: rename statuses, priorities, impact levels, work
  order types and safety severities; set SLA response and resolution targets per
  priority; manage departments and equipment.
- Edit or delete anybody's comments and attachments.

**Cannot**

- **Edit another Administrator.** Same rank, so neither outranks the other. Only
  the Superuser can.
- **Create an Administrator.** Only the Superuser can.
- **Set anybody else's password directly.** This is Superuser-only, so that no
  Administrator ever ends up holding another person's credentials. Use the
  reset-link button instead.
- **Change anybody else's sign-in email.** Superuser-only, for the same reason —
  repointing somebody's address at your own mailbox and then using the public
  reset page would be a takeover.
- **Delete an account.** Superuser-only.
- Change their own role, or deactivate themselves.
- Assign a job to themselves.
- Change the work-order deletion permission switches — they can *use* the grant,
  not hand it out.
- See or touch test accounts, which are invisible to them everywhere, including in
  the technician picker on the assign panel.

### Superuser

One account, held by IT. Marked as protected in the database.

**Can**

- Everything an Administrator can, plus:
- **Create and edit Administrators** — the only account that can.
- **Set anybody's password directly**, and **change anybody's sign-in email**.
- **Delete an account** (see §4 for when the system will refuse).
- **Change the work-order deletion permissions** in Admin → Settings →
  Permissions — one switch per role. Their own ability to delete cannot be
  switched off, deliberately.
- **See and manage test accounts** — fixture accounts used for trying changes.
  Nobody else sees them at all: not in the user list, not in any count, not in the
  technician picker.
- Delete work orders regardless of what the permission switches say.

**Cannot**

- **Edit their own account from inside the app** — not even their own name. A
  protected account is administered from the database only. That is the point of
  the mark: it cannot be tampered with through the app by anyone, its holder
  included.
- Change their own role or status.
- Assign a job to themselves.
- Delete an account belonging to somebody who has done work (§4).
- Undo a deletion. Both deletions in this module — work order and account — are
  permanent.

---

## 3. The work order lifecycle, and who moves it

The sequence is fixed. **No status can be skipped** by anyone except an
Administrator.

```
Open → Assigned → Accepted → On the way → On site → Repairing
     → Waiting for spare part ⇄ Repairing → Testing → Completed → Closed
```

| Step | What it's called | Who can do it | What they must supply |
|---|---|---|---|
| Open → Assigned | Assign technician | Supervisor, Manager, Admin | A technician (not themselves) |
| Assigned → Accepted | Accept | The assigned Technician, Manager, Admin | — |
| Assigned → Open | Decline | The assigned Technician, Manager, Admin | A decline reason |
| Accepted → On the way | Start travel | The assigned Technician, Manager, Admin | — |
| On the way → On site | Arrive on site | The assigned Technician, Manager, Admin | — |
| On site → Repairing | Start repair | The assigned Technician, Manager, Admin | — |
| Repairing → Waiting for spare part | Waiting for spare part | The assigned Technician, Manager, Admin | A reason |
| Waiting for spare part → Repairing | Resume repair | The assigned Technician, Manager, Admin | — |
| Repairing → Testing | Start testing | The assigned Technician, Manager, Admin | — |
| Testing → Repairing | Test failed | The assigned Technician, Manager, Admin | A failure reason |
| Testing → Completed | Mark completed | The assigned Technician, Manager, Admin | Resolution notes |
| Completed → Closed | Verify and close | The Requester who raised it, Manager, Admin | Who verified |
| Completed → Repairing | Reopen | The Requester who raised it, Manager, Admin | A reopen reason |
| Open → Open | Edit core fields | The Requester who raised it, Supervisor, Manager, Admin | — |
| Assigned → Assigned | Reassign before acceptance | Supervisor, Manager, Admin | A technician |
| Any active status → itself | Reassign mid-flight | Supervisor, Manager, Admin | A **different** technician |

"The assigned Technician" means exactly that: a Technician can only act on jobs
assigned to them. "The Requester who raised it" likewise.

Everything above writes a history row recording **who did it, in which role, when,
and what they typed**. That trail is why work orders and accounts are hard to
delete.

---

## 4. Rules that apply to absolutely everyone

**Nobody assigns work to themselves.** Not a Supervisor who is also a Technician,
not a Manager, not an Administrator, not the Superuser. Somebody else has to give
you the job.

**Nobody changes their own role, department or status.** Including the Superuser.
This is what stops an account locking itself out, and what stops a quiet
self-promotion.

**Same rank cannot touch same rank.** Two Administrators cannot edit each other.
Two Supervisors cannot edit each other. You act on your own account, or on one
below you.

**An account that has done work cannot be deleted.** If the person has raised a
work order, been assigned one, verified one, commented, or uploaded anything, the
system refuses and tells you exactly what it counted — for example: *"Arun Kumar
has 1 work order, 6 history rows, 1 comment. Deleting the account would break that
audit trail, so it is refused. Deactivate the account instead."* **Deactivate is
the right answer for anyone who has ever worked.** Deletion is really only for an
account created by mistake.

**Deactivating is not instant.** It takes effect the next time that person's
sign-in token refreshes — up to about an hour — or immediately if they sign out.

**A new or reset account must change its password on first sign-in.** Until they
do, the only page they can reach is Change Password. This applies to accounts
created by an Administrator and to any password set by the Superuser.

**Comments and attachments are less private than work orders.** Which work orders
you can *open* is tightly controlled. The comment and attachment records
themselves are readable by any signed-in account through the underlying data
service. Treat comments as visible to everybody in the plant, and do not put
anything in one that you would not put on the noticeboard.

**Notifications are yours alone.** You only ever see your own.

**Alerts stop when the app is closed.** With the app in the background you get a
status-bar notification with sound; with it in front you get a chime and the bell
badge. Swipe the app away or close the browser and **nothing** arrives until you
open it again.

---

## 5. Things people are most often surprised by

| Expectation | What actually happens |
|---|---|
| "I'm a Supervisor, I'll just take this job myself." | Refused. Somebody else must assign it to you, even if you hold Technician too. |
| "I'm an Admin, I'll reset this Admin's password." | Refused — same rank. Ask the Superuser. |
| "I'll set my technician's password for them." | Administrators cannot. Send them a reset link instead; only the Superuser sets passwords. |
| "I made someone a Manager, why can't they get in yet?" | It lands within about an hour, or immediately if they sign out and back in. |
| "I deactivated them, they're still working." | Same reason. Up to an hour, or immediately on sign-out. |
| "Supervisors only see their own department." | Not any more. A Supervisor sees the whole plant. The department on a work order is the *machine's* — it drives routing and reporting, not access. |
| "I'll just delete this old test account." | Refused if they have any history. Deactivate instead. |
| "I raised it, I'll fix the description." | Only while it is still Open. Once assigned, the details are frozen and changes go through the workflow. |
| "Let me skip straight to Completed." | No step can be skipped. Only an Administrator can jump a record, and only to unstick it. |
| "The Manager can get into Admin → Users." | No. Managers own the work; Administrators own the accounts. |
| "I sent a reset link, they say nothing arrived." | Check the address is a real work email — placeholder addresses are refused loudly, and the built-in mailer is rate-limited to a handful an hour. |

---

*Written from the live rules as of 2026-08-20: the row-level security policies, the
22-row status transition table, the seniority checks and the screen gates. If this
document and the app ever disagree, the app is right and this file needs updating —
but every claim here was read from the enforcement code, not from the design docs.*
