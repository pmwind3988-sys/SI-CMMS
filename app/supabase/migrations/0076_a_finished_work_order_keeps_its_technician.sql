-- 0076: a finished work order keeps its technician.
--
-- The Assignment tab hid its buttons on completed / verified / closed work
-- orders, and nothing behind the screen agreed with it. For a Supervisor or a
-- Manager the matrix happened to refuse — the only closed -> closed row is the
-- HOD's sign-off (0063), which demands verified_by and verification_notes. For an
-- Administrator nothing refused at all: si_guard_work_order_transition (0023)
-- returns early for `admin`, so reassignTechnician() on a closed work order
-- wrote closed -> closed with a new assignee, a history row and a handover
-- notification to somebody for a job that was already over. The same held for a
-- direct PATCH of assigned_to_id from an Administrator's own token.
--
-- A hidden button that guards something reachable around it decides nothing —
-- 0026 and 0031 both say so. This trigger is the rule.
--
-- Four things worth not undoing:
--
--   * OLD.status, not NEW.status. The rule is about the record as it stands, so
--     a transition out of `closed` cannot carry a new assignee along with it.
--     Rework (closed -> repairing, completed -> repairing) keeps the assignee and
--     passes; if the rework needs a different technician, that is a
--     reassignment at `repairing`, one step later, which is allowed.
--
--   * No admin exemption and no null-uid exemption. The whole purpose is to stop
--     the most privileged account making this mistake, so it sits in front of
--     the bypass in the way 0020's self-assignment rule and 0064's plant guard
--     do. Nothing legitimate needs the hole: auto-close (0061), sign-off
--     (0063), the SLA backfills (0069/0070), the timeline correction
--     (0065/0066) and both extension RPCs name no assignee column.
--
--   * `is distinct from`, not `<>`. A finished work order with no assignee is
--     reachable (closed by a seed or a direct write, 0062), and null <> uuid is
--     NULL, which would let the first assignment onto it through.
--
--   * `a00000_` so it fires ahead of 0064's `a0000_` plant guard and everything
--     after it: every digit sorts below `_` in ASCII.
--
-- `verified` is listed although 0060 retired it as a status; a row carrying it
-- is still finished, and listing it costs nothing. `completed` never rests since
-- 0061 auto-closes in the same transaction, and the auto-close UPDATE moves no
-- assignee, so it passes.
--
-- Mirrored on the client by ASSIGNMENT_LOCKED_STATUSES in lib/constants.js —
-- change the two together.

create or replace function si_guard_finished_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('completed', 'verified', 'closed')
     and new.assigned_to_id is distinct from old.assigned_to_id then
    raise exception 'This work order is finished, so its technician can no longer be changed. Send it back for rework first if the job needs someone else.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function si_guard_finished_assignee() from public, anon, authenticated;

drop trigger if exists a00000_guard_finished_assignee on work_orders;
create trigger a00000_guard_finished_assignee
  before update on work_orders
  for each row execute function si_guard_finished_assignee();
