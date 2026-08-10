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
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useReferenceData } from "../../lib/referenceData";
import {
  listenUsers,
  setUserPassword,
  createUser,
  setUserRole,
  setUserStatus,
  updateUserProfile,
} from "../../lib/admin";
import { describeError } from "../../lib/errors";
import { ROLES, ROLE_LABELS, ALL_ROLES } from "../../lib/roles";
import { RoleBadge } from "../ui/Badges";
import Button from "../ui/Button";
import Field, { inputClass } from "../ui/Field";
import { Card, ErrorBanner, EmptyState, Toast } from "../ui/Surfaces";

const MIN_PASSWORD_LENGTH = 8;

export default function UsersAdmin() {
  const { user: me } = useAuth();
  const { departments } = useReferenceData();

  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState("All");
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
      if (fRole !== "All" && u.role !== fRole) return false;
      if (!needle) return true;
      return (
        u.name?.toLowerCase().includes(needle) ||
        u.email?.toLowerCase().includes(needle) ||
        u.department_id?.toLowerCase().includes(needle)
      );
    });
  }, [users, q, fRole]);

  const activeAdmins = (users ?? []).filter((u) => u.role === ROLES.ADMIN && u.status === "active");

  async function handleToggleStatus(u) {
    const next = u.status === "active" ? "inactive" : "active";
    // Locking out the last active administrator is unrecoverable from inside the
    // app — it would need the service-role key and a script to undo.
    if (next === "inactive" && u.role === ROLES.ADMIN && activeAdmins.length <= 1) {
      setError("This is the only active Administrator. Promote another one first.");
      return;
    }
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

      <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-border rounded px-3 py-2 w-72">
          <Search size={15} className="text-ink-soft" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email or department…"
            className="bg-transparent outline-none text-[13.5px] w-full"
          />
        </div>
        <select value={fRole} onChange={(e) => setFRole(e.target.value)} className={`${inputClass} w-48`}>
          <option value="All">All roles</option>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center px-4 py-2.5 bg-canvas text-[11.5px] font-bold text-ink-soft uppercase tracking-wide">
          <div className="flex-[2]">User</div>
          <div className="flex-[1.5]">Role</div>
          <div className="flex-1">Department</div>
          <div className="w-20">Status</div>
          <div className="w-[280px] text-right">Actions</div>
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
            </div>
            <div className="flex-[1.5]">
              <RoleBadge role={u.role} />
            </div>
            <div className="flex-1 text-[12.5px] text-ink-soft truncate">{u.department_id || "—"}</div>
            <div className="w-20">
              <span
                className="text-[11.5px] font-bold"
                style={{ color: u.status === "active" ? "#22C55E" : "#94A3B8" }}
              >
                {u.status === "active" ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="w-[280px] flex items-center justify-end gap-1.5">
              <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => setPanel({ kind: "password", user: u })}>
                Password
              </Button>
              <Button size="sm" variant="ghost" icon={ShieldCheck} onClick={() => setPanel({ kind: "role", user: u })}>
                Role
              </Button>
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setPanel({ kind: "profile", user: u })}>
                Edit
              </Button>
              <Button
                size="sm"
                variant={u.status === "active" ? "danger" : "success"}
                icon={Power}
                onClick={() => handleToggleStatus(u)}
              />
            </div>
          </div>
        ))}

        {users && filtered.length === 0 && <EmptyState>No users match those filters.</EmptyState>}
      </Card>

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
          onClose={() => setPanel(null)}
          onDone={(msg) => {
            setPanel(null);
            flash(msg);
          }}
        />
      )}
      {panel?.kind === "create" && (
        <CreateUserDialog
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
   Dialogs
-------------------------------------------------------------------*/

function Modal({ title, subtitle, children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6">
      <Card className="w-full max-w-md p-5">
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
    </div>
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

function RoleDialog({ user, departments, onClose, onDone }) {
  const [role, setRole] = useState(user.role);
  const [departmentId, setDepartmentId] = useState(user.department_id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await setUserRole(user.id, role, departmentId || null, user.plant_ids || []);
      onDone(`${user.name} is now ${ROLE_LABELS[role]}.`);
    } catch (e) {
      setError(describeError(e, "Couldn't change that role."));
      setBusy(false);
    }
  }

  return (
    <Modal title="Change role" subtitle={`${user.name} · ${user.email}`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={submit}>
        <Field label="Role" required>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
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
          <Button type="submit" icon={busy ? Loader2 : Check} disabled={busy}>
            {busy ? "Saving…" : "Save role"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ProfileDialog({ user, onClose, onDone }) {
  const [name, setName] = useState(user.name || "");
  const [phone, setPhone] = useState(user.phone || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("A name is required.");
      return;
    }
    setBusy(true);
    try {
      await updateUserProfile(user.id, { name: name.trim(), phone: phone.trim() });
      onDone(`${name.trim()} updated.`);
    } catch (e) {
      setError(describeError(e, "Couldn't save those details."));
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
        <p className="text-[12px] text-ink-soft mb-4">
          Email addresses are the sign-in identity and are not editable here.
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

function CreateUserDialog({ departments, onClose, onDone }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: ROLES.REQUESTER,
    departmentId: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("A name is required.");
    if (!form.email.trim()) return setError("An email address is required.");
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      return setError(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    setBusy(true);
    try {
      const res = await createUser({
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim(),
        role: form.role,
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
        <Field label="Role" required>
          <select value={form.role} onChange={set("role")} className={inputClass}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
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
        {form.role === ROLES.TECHNICIAN && (
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
