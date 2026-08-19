"use client";

/**
 * SI — Service Inside · Administration · Users
 *
 * The screen the demo accounts' shared password can finally be changed from.
 *
 * Three routes out of here, each picked by what the operation needs — see
 * lib/admin.js for why. Passwords go through the admin-users Edge Function
 * because only the service role can set another user's password, and that key
 * cannot live in a browser.
 */
import { useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  UserPlus,
  ShieldCheck,
  Power,
  Check,
  X,
  Search,
  Loader2,
  Pencil,
  FlaskConical,
  BadgeCheck,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useReferenceData } from "../../lib/referenceData";
import {
  listenUsers,
  setUserPassword,
  createUser,
  setUserRoles,
  setUserStatus,
  updateUserProfile,
  setUserEmail,
  clearDemoMark,
  demoFlagsOf,
  isDemoAccount,
  DEMO_FLAGS,
} from "../../lib/admin";
import { describeError } from "../../lib/errors";
import { canEditUser, canChangeUserEmail, assignableRoles } from "../../lib/constants";
import { ROLES, ROLE_LABELS, ALL_ROLES, rolesLabel, accountRank, roleRank } from "../../lib/roles";
import { RoleBadge } from "../ui/Badges";
import Button from "../ui/Button";
import Field, { inputClass } from "../ui/Field";
import { Card, ErrorBanner, EmptyState, Toast, ModalOverlay } from "../ui/Surfaces";

const MIN_PASSWORD_LENGTH = 8;

export default function UsersAdmin() {
  const { user: me } = useAuth();
  const { departments } = useReferenceData();

  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState("All");
  const [demoOnly, setDemoOnly] = useState(false);
  const [panel, setPanel] = useState(null); // { kind: 'password'|'role'|'profile'|'create', user? }

  useEffect(() => {
    const unsub = listenUsers(setUsers, (e) =>
      setError(describeError(e, "Couldn't load the user list."))
    );
    return unsub;
  }, []);

  function flash(message) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  const filtered = useMemo(() => {
    const rows = users ?? [];
    const needle = q.trim().toLowerCase();
    return rows.filter((u) => {
      // Membership: filtering by Technician must surface a Supervisor+Technician.
      if (fRole !== "All" && !(u.roles ?? []).includes(fRole)) return false;
      if (demoOnly && !isDemoAccount(u)) return false;
      if (!needle) return true;
      return (
        u.name?.toLowerCase().includes(needle) ||
        u.email?.toLowerCase().includes(needle) ||
        u.department_id?.toLowerCase().includes(needle)
      );
    });
  }, [users, q, fRole, demoOnly]);

  const demoCount = (users ?? []).filter(isDemoAccount).length;

  async function handleClearDemoMark(u) {
    setError(null);
    try {
      await clearDemoMark(u.id);
      flash(`${u.name} is no longer marked as a demo account.`);
    } catch (e) {
      setError(describeError(e, "Couldn't clear that demo mark."));
    }
  }

  // The last-active-Administrator check that used to live here is gone, and not
  // by oversight. Migration 0015 makes locking out the last admin structurally
  // impossible — you cannot deactivate a peer Administrator (same rank) and you
  // cannot deactivate yourself — so the check could never fire. Worse, it had
  // become unreliable: protected accounts are hidden from this list, so counting
  // visible admins would have under-reported them.
  async function handleToggleStatus(u) {
    const next = u.status === "active" ? "inactive" : "active";
    setError(null);
    try {
      await setUserStatus(u.id, next);
      flash(`${u.name} is now ${next}.`);
    } catch (e) {
      setError(describeError(e, "Couldn't change that account's status."));
    }
  }

  return (
    <div className="max-w-6xl">
      <Toast message={toast} />

      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink mb-0.5">Users</h1>
          <p className="text-[13px] text-ink-soft">
            Accounts, roles and passwords. {users ? `${users.length} total.` : "Loading…"}
          </p>
        </div>
        <Button icon={UserPlus} onClick={() => setPanel({ kind: "create" })}>
          Add user
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      {demoCount > 0 && (
        <div className="mb-3.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded border border-[#F59E0B66] bg-[#FFFBEB] px-4 py-3 text-[13px] text-[#92400E]">
          <span className="flex min-w-0 items-start gap-2">
            <FlaskConical size={15} className="mt-0.5 flex-shrink-0" />
            <span className="min-w-0">
              <strong>{demoCount}</strong> {demoCount === 1 ? "account is" : "accounts are"} still
              seeded demo data. Each one shows why below, and each reason disappears on its own once
              it is dealt with.
            </span>
          </span>
          <button
            onClick={() => setDemoOnly((v) => !v)}
            className="flex-shrink-0 font-semibold text-[#92400E] hover:underline"
          >
            {demoOnly ? "Show everyone" : "Show only these"}
          </button>
        </div>
      )}

      <div className="mb-3.5 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2 rounded border border-border bg-white px-3 py-2 sm:w-72">
          <Search size={15} className="flex-shrink-0 text-ink-soft" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email or department…"
            className="w-full min-w-0 bg-transparent text-[13.5px] outline-none"
          />
        </div>
        <select value={fRole} onChange={(e) => setFRole(e.target.value)} className={`${inputClass} sm:w-48`}>
          <option value="All">All roles</option>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      {/* The row layout needs ~900px — four columns plus a 280px action group.
          It stays as-is from `lg` up and is replaced by stacked cards below,
          rather than being crushed or scrolled sideways: this is a screen an
          admin does use from a phone. */}
      <Card className="hidden overflow-hidden lg:block">
        <div className="flex items-center px-4 py-2.5 bg-canvas text-[11.5px] font-bold text-ink-soft uppercase tracking-wide">
          <div className="flex-[2]">User</div>
          <div className="flex-[1.5]">Role</div>
          <div className="flex-1">Department</div>
          <div className="w-20">Status</div>
          <div className="w-[320px] text-right">Actions</div>
        </div>

        {users === null && <div className="px-4 py-6 text-[13px] text-ink-soft">Loading users…</div>}

        {filtered.map((u, i) => (
          <div
            key={u.id}
            className={`flex items-center px-4 py-3 ${i === 0 ? "" : "border-t border-[#F1F3F5]"}`}
          >
            <div className="flex-[2] min-w-0">
              <div className="text-[13.5px] text-ink font-medium truncate">
                {u.name}
                {u.id === me?.uid && <span className="text-ink-soft font-normal"> · you</span>}
              </div>
              <div className="text-[12px] text-ink-soft truncate">{u.email}</div>
              <DemoFlags user={u} />
            </div>
            <div className="flex-[1.5]">
              <RoleBadges roles={u.roles} />
            </div>
            <div className="flex-1 text-[12.5px] text-ink-soft truncate">{u.department_id || "—"}</div>
            <div className="w-20">
              <StatusText status={u.status} />
            </div>
            <div className="w-[320px] flex items-center justify-end gap-1.5">
              <UserActions
                user={u}
                me={me}
                setPanel={setPanel}
                onToggleStatus={handleToggleStatus}
                onClearDemoMark={handleClearDemoMark}
              />
            </div>
          </div>
        ))}

        {users && filtered.length === 0 && <EmptyState>No users match those filters.</EmptyState>}
      </Card>

      <div className="flex flex-col gap-2 lg:hidden">
        {users === null && (
          <Card className="px-4 py-6 text-[13px] text-ink-soft">Loading users…</Card>
        )}
        {filtered.map((u) => (
          <Card key={u.id} className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-ink">
                  {u.name}
                  {u.id === me?.uid && <span className="font-normal text-ink-soft"> · you</span>}
                </div>
                <div className="truncate text-[12px] text-ink-soft">{u.email}</div>
                <div className="mt-1 text-[12px] text-ink-soft">{u.department_id || "No department"}</div>
                <DemoFlags user={u} />
              </div>
              <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                <RoleBadges roles={u.roles} />
                <StatusText status={u.status} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#F1F3F5] pt-3">
              <UserActions
                user={u}
                me={me}
                setPanel={setPanel}
                onToggleStatus={handleToggleStatus}
                onClearDemoMark={handleClearDemoMark}
              />
            </div>
          </Card>
        ))}
        {users && filtered.length === 0 && (
          <Card>
            <EmptyState>No users match those filters.</EmptyState>
          </Card>
        )}
      </div>

      {panel?.kind === "password" && (
        <PasswordDialog
          user={panel.user}
          onClose={() => setPanel(null)}
          onDone={(msg) => {
            setPanel(null);
            flash(msg);
          }}
        />
      )}
      {panel?.kind === "role" && (
        <RoleDialog
          user={panel.user}
          me={me}
          departments={departments}
          onClose={() => setPanel(null)}
          onDone={(msg) => {
            setPanel(null);
            flash(msg);
          }}
        />
      )}
      {panel?.kind === "profile" && (
        <ProfileDialog
          user={panel.user}
          me={me}
          onClose={() => setPanel(null)}
          onDone={(msg) => {
            setPanel(null);
            flash(msg);
          }}
        />
      )}
      {panel?.kind === "create" && (
        <CreateUserDialog
          me={me}
          departments={departments}
          onClose={() => setPanel(null)}
          onDone={(msg) => {
            setPanel(null);
            flash(msg);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Row pieces — shared by the desktop table and the mobile cards so the two
   layouts can't drift apart.
-------------------------------------------------------------------*/

/**
 * One badge per role held, highest first. A single-role account renders exactly
 * what it did before this existed.
 */
function RoleBadges({ roles }) {
  const ordered = [...(roles ?? [])].sort((a, b) => roleRank(b) - roleRank(a));
  if (ordered.length === 0) return <span className="text-[12.5px] text-ink-soft">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {ordered.map((r) => (
        <RoleBadge key={r} role={r} />
      ))}
    </span>
  );
}

function StatusText({ status }) {
  return (
    <span
      className="text-[11.5px] font-bold"
      style={{ color: status === "active" ? "#22C55E" : "#94A3B8" }}
    >
      {status === "active" ? "Active" : "Inactive"}
    </span>
  );
}

/**
 * Why this account still counts as demo data. Rendered per row rather than as a
 * single "Demo" pill: "placeholder email" and "never signed in" call for
 * completely different responses, and lumping them together is what makes a
 * flag get ignored.
 */
function DemoFlags({ user }) {
  const flags = demoFlagsOf(user);
  if (flags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <FlaskConical size={11} className="flex-shrink-0 text-[#B45309]" aria-hidden="true" />
      <span className="sr-only">Demo account:</span>
      {flags.map((f) => (
        <span
          key={f}
          title={`${DEMO_FLAGS[f]?.detail ?? f} ${DEMO_FLAGS[f]?.fix ?? ""}`.trim()}
          className="rounded bg-[#FEF3C7] px-1.5 py-px text-[10.5px] font-semibold text-[#92400E]"
        >
          {DEMO_FLAGS[f]?.short || f}
        </span>
      ))}
    </div>
  );
}

/**
 * Buttons are hidden, not disabled, when the hierarchy forbids the action —
 * a row you cannot act on shows nothing rather than five dead controls. These
 * predicates only decide what to *show*; migration 0015's policies decide what
 * is allowed, and a disagreement surfaces as the database's own error message.
 */
function UserActions({ user, me, setPanel, onToggleStatus, onClearDemoMark }) {
  const editable = canEditUser(user, me);
  const isSelf = user.id === me?.uid;

  if (!editable) {
    return (
      <span className="text-[11.5px] text-ink-soft">
        {/* Protected is checked first because it is the reason that actually
            applies. users_select hides a protected account from everyone but
            its own holder, so the only person who ever reads this line is that
            holder looking at their own row — and "same rank" is trivially true
            of your own row while explaining nothing. The flag is the reason. */}
        {user.is_protected
          ? "Protected — administered only from Supabase"
          : accountRank(user) === accountRank(me)
            ? "Same rank — not editable here"
            : "Not editable here"}
      </span>
    );
  }

  // Only offered when there is a seed mark to clear. A placeholder email is not
  // dismissible on its own — it is still a fake address after any amount of
  // acknowledging, and the only real fix is a different account.
  const canClearMark = Boolean(user.seed_source);
  return (
    <>
      {canClearMark && (
        <Button
          size="sm"
          variant="ghost"
          icon={BadgeCheck}
          aria-label="Not a demo account"
          title="Mark this as a real account — clears the seed-related flags"
          onClick={() => onClearDemoMark(user)}
        />
      )}
      <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => setPanel({ kind: "password", user })}>
        Password
      </Button>
      {/* Role and status both move someone within the hierarchy, so neither may
          be aimed at yourself — si_guard_user_self_update raises on both. */}
      {!isSelf && (
        <Button size="sm" variant="ghost" icon={ShieldCheck} onClick={() => setPanel({ kind: "role", user })}>
          Role
        </Button>
      )}
      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setPanel({ kind: "profile", user })}>
        Edit
      </Button>
      {!isSelf && (
        <Button
          size="sm"
          variant={user.status === "active" ? "danger" : "success"}
          icon={Power}
          aria-label={user.status === "active" ? "Deactivate account" : "Reactivate account"}
          onClick={() => onToggleStatus(user)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------
   Dialogs
-------------------------------------------------------------------*/

function Modal({ title, subtitle, children, onClose }) {
  return (
    // Bottom-aligned on a phone so the dialog sits above the thumb and its own
    // content scrolls; the create-user form is six fields tall and used to run
    // off both ends of a 640px-high screen with no way to reach the buttons.
    <ModalOverlay className="p-4">
      <Card className="rise max-h-[85dvh] w-full max-w-md overflow-y-auto p-4 sm:p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-[15.5px] font-bold text-ink">{title}</h2>
            {subtitle && <p className="text-[12.5px] text-ink-soft mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {children}
      </Card>
    </ModalOverlay>
  );
}

function PasswordDialog({ user, onClose, onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await setUserPassword(user.id, password);
      onDone(`${user.name}'s password has been changed.`);
    } catch (e) {
      setError(describeError(e, "Couldn't change that password."));
      setBusy(false);
    }
  }

  return (
    <Modal title="Set a new password" subtitle={`${user.name} · ${user.email}`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={submit}>
        <Field label="New password" required>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password" required>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
          />
        </Field>
        <p className="text-[12px] text-ink-soft mb-4">
          They are not told automatically — pass the new password on yourself. Their existing
          sessions stay signed in until the token expires.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" icon={busy ? Loader2 : Check} disabled={busy}>
            {busy ? "Saving…" : "Set password"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RoleDialog({ user, me, departments, onClose, onDone }) {
  // You cannot grant a role at or above your own — si_set_user_roles raises on
  // it, so the picker must not offer it. Roles they already hold stay in the
  // list even when out of range, so the dialog shows what is actually true;
  // the RPC still refuses a change that would grant one.
  const choices = Array.from(new Set([...assignableRoles(me), ...(user.roles ?? [])]));
  const [roles, setRoles] = useState(user.roles ?? []);
  const [departmentId, setDepartmentId] = useState(user.department_id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function toggle(r) {
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await setUserRoles(user.id, roles, departmentId || null, user.plant_ids || []);
      onDone(`${user.name} is now ${rolesLabel(roles)}.`);
    } catch (e) {
      setError(describeError(e, "Couldn't change those roles."));
      setBusy(false);
    }
  }

  return (
    <Modal title="Change roles" subtitle={`${user.name} · ${user.email}`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={submit}>
        <Field label="Roles" required>
          {/* Checkboxes, not a select: an account holds a set (migration 0020)
              and gets the union of what those roles allow. */}
          <div className="flex flex-col gap-1.5">
            {choices.map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink">
                <input
                  type="checkbox"
                  checked={roles.includes(r)}
                  onChange={() => toggle(r)}
                  className="accent-navy"
                />
                {ROLE_LABELS[r] || r}
              </label>
            ))}
          </div>
          {roles.length === 0 && (
            <div className="mt-1.5 text-[11.5px] text-danger">
              An account must have at least one role.
            </div>
          )}
        </Field>
        <Field label="Department">
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className={inputClass}
          >
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[12px] text-ink-soft mb-4">
          A role lives in the user's access token, which Supabase reissues about once an hour. To
          make this take effect immediately, have them sign out and back in.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" icon={busy ? Loader2 : Check} disabled={busy || roles.length === 0}>
            {busy ? "Saving…" : "Save roles"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Name, phone and — new — the sign-in address.
 *
 * The three do not travel together. Name and phone are a plain UPDATE that the
 * users_update policy already permits; the address is in auth.users and only the
 * Admin API reaches it, so it goes through the admin-users Edge Function. Both
 * are submitted from one form because to the admin it is one edit, but they are
 * applied in order and reported separately when only one of them fails.
 *
 * Who may change an address is the same rank rule as the password: your own
 * account, or one strictly below you. A peer Administrator's is not offered,
 * because repointing a sign-in address at a mailbox you control is an account
 * takeover by another name — and the function refuses it server-side regardless
 * of what this form shows.
 */
function ProfileDialog({ user, me, onClose, onDone }) {
  const mayChangeEmail = canChangeUserEmail(user, me);
  const originalEmail = (user.email || "").trim().toLowerCase();

  const [name, setName] = useState(user.name || "");
  const [phone, setPhone] = useState(user.phone || "");
  const [email, setEmail] = useState(user.email || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const nextEmail = email.trim().toLowerCase();
  const emailChanged = mayChangeEmail && nextEmail !== originalEmail;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("A name is required.");
      return;
    }
    if (emailChanged && !nextEmail) {
      setError("An email address is required — it is how this account signs in.");
      return;
    }
    setBusy(true);

    // Profile fields first: they are the cheap, reversible half. If the address
    // change then fails, the message says so explicitly rather than leaving the
    // admin to guess which parts of the form were applied.
    try {
      await updateUserProfile(user.id, { name: name.trim(), phone: phone.trim() });
    } catch (e) {
      setError(describeError(e, "Couldn't save those details."));
      setBusy(false);
      return;
    }

    if (!emailChanged) {
      onDone(`${name.trim()} updated.`);
      return;
    }

    try {
      const res = await setUserEmail(user.id, nextEmail);
      onDone(res?.message || `${name.trim()} now signs in as ${nextEmail}.`);
    } catch (e) {
      setError(
        `${describeError(e, "Couldn't change that email address.")} The name and phone were saved.`
      );
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit profile" subtitle={user.email} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={submit}>
        <Field label="Name" required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Email" required={mayChangeEmail}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            autoComplete="off"
            disabled={!mayChangeEmail}
            aria-describedby="email-note"
          />
        </Field>
        <p id="email-note" className="text-[12px] text-ink-soft mb-4">
          {!mayChangeEmail
            ? "You can only change the sign-in address of your own account, or of someone below you in the hierarchy."
            : emailChanged
              ? `This is how they sign in. From now on they will use ${nextEmail}, not ${originalEmail} — tell them, and their existing sessions stay signed in until the token expires.`
              : "This is how they sign in. Changing it takes effect immediately; the new address is marked confirmed, so there is no email to click."}
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" icon={busy ? Loader2 : Check} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CreateUserDialog({ me, departments, onClose, onDone }) {
  // Creating a peer is rejected by the admin-users function, so don't offer it.
  const choices = assignableRoles(me);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    roles: [ROLES.REQUESTER],
    departmentId: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function toggleRole(r) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r],
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("A name is required.");
    if (!form.email.trim()) return setError("An email address is required.");
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      return setError(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    // Stated here as well as in the Edge Function and the users_roles_not_empty
    // constraint: an account with no roles can sign in and see nothing.
    if (form.roles.length === 0) return setError("Pick at least one role.");
    setBusy(true);
    try {
      const res = await createUser({
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim(),
        roles: form.roles,
        departmentId: form.departmentId || null,
        plantIds: ["PLT001"],
        phone: form.phone.trim(),
      });
      onDone(res?.message || `${form.name.trim()} created.`);
    } catch (e) {
      setError(describeError(e, "Couldn't create that account."));
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a user" subtitle="They can sign in as soon as this is saved." onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={submit}>
        <Field label="Name" required>
          <input value={form.name} onChange={set("name")} className={inputClass} />
        </Field>
        <Field label="Email" required>
          <input type="email" value={form.email} onChange={set("email")} className={inputClass} />
        </Field>
        <Field label="Phone">
          <input value={form.phone} onChange={set("phone")} className={inputClass} />
        </Field>
        <Field label="Roles" required>
          {/* An account holds a set and gets the union of what those roles
              allow (migration 0020). */}
          <div className="flex flex-col gap-1.5">
            {choices.map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink">
                <input
                  type="checkbox"
                  checked={form.roles.includes(r)}
                  onChange={() => toggleRole(r)}
                  className="accent-navy"
                />
                {ROLE_LABELS[r] || r}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Department">
          <select value={form.departmentId} onChange={set("departmentId")} className={inputClass}>
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Initial password" required>
          <input
            type="password"
            value={form.password}
            onChange={set("password")}
            className={inputClass}
            autoComplete="new-password"
          />
        </Field>
        {form.roles.includes(ROLES.TECHNICIAN) && (
          <p className="text-[12px] text-ink-soft mb-4">
            A technician record is created too, so they can be assigned work straight away. Add
            their skills in Settings so the assignment panel can match them to jobs.
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" icon={busy ? Loader2 : UserPlus} disabled={busy}>
            {busy ? "Creating…" : "Create user"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
