-- ============================================================================
-- 0064 — A Superuser may reassign a work order's plant, and only a Superuser
-- ============================================================================
--
-- Every work order raised before 0049 says PLT001. That is not a mistake in the
-- data: there was one plant and `createWorkOrder()` hardcoded it, so PLT001 was
-- the honest answer at the time and 0049's backfill said so deliberately. It is
-- simply no longer useful — PLT001 is retired, there are four real sites, and a
-- filter or an export grouped by plant puts the whole history in a bucket that
-- names nowhere.
--
-- WHY THERE IS NO BACKFILL HERE. The obvious repair is to read the plant off the
-- department: "Production F1" is at F1. It was designed and then dropped, because
-- a department on this site may span more than one plant — so the rule would
-- have written a confident wrong answer into rows nobody would ever re-check,
-- and a wrong plant is worse than the honest PLT001 it replaced, which at least
-- reads as "before we had plants". `departments.plant_id` cannot help either:
-- `createDepartment()` writes 'PLT001' for every department ever added and the
-- raise form passes no plant, so that column holds no information at all.
--
-- So every one of these is a judgement, and this migration ships the authority
-- to make it rather than the answers. Admin -> Settings -> Plant assignment is
-- the screen.
--
-- WHY A TRIGGER AND NOT JUST A SCREEN. `work_orders_update` cannot be narrowed:
-- every transition and every edit needs it. And the transition guard already
-- returns early for `admin` (0003), so today ANY Administrator can PATCH
-- `plant_id` on any work order straight at PostgREST. A Superuser-only screen in
-- front of that would be exactly the failure 0026 and 0031 are both about — a
-- control that decides nothing because the thing it guards is reachable around
-- it. The boundary is here.
--
-- The write itself stays an ordinary RLS-enforced UPDATE, the way
-- `deleteWorkOrder()` is. No RPC: nothing needs to be restated inside a
-- SECURITY DEFINER body, because nothing is bypassing RLS.
--
-- WHAT IS DELIBERATELY STILL ALLOWED. A work order at `open` is editable —
-- `WorkOrderDetail` gates the Edit button on `status === "open"` and the raise
-- form doubles as the edit form, plant picker included. Refusing that would
-- break correcting a plant chosen thirty seconds ago, which is the one case
-- where the person who raised it knows best. The guard therefore only holds once
-- the work order has left `open`.
--
-- `old.status`, not `new.status`: an edit moves no status, and reading NEW here
-- would let a transition out of `open` carry a plant change along with it.
--
-- Only `plant_id` is guarded. The assignee, the status, the equipment and the
-- SLA are untouched by this and must stay that way — see 0051 for the same
-- omission used as the mechanism. A plant-only UPDATE is silent for free:
-- `si_stamp_work_order` and `si_notify_work_order_update` both open with
-- `if new.status = old.status`, so a records fix notifies nobody and writes no
-- history row.

create or replace function si_guard_work_order_plant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No JWT: a migration, a seed script, or the service role. Trusted, as
  -- everywhere else in this schema.
  if auth.uid() is null then return new; end if;

  -- `is not distinct from` rather than `=`: plant_id was nullable until 0049,
  -- and NULL = NULL is NULL, which is not true — so the plain comparison would
  -- fall through to the refusal on any row this guard should ignore.
  if new.plant_id is not distinct from old.plant_id then return new; end if;

  -- Still being written up. Correcting it is part of raising it.
  if old.status = 'open' then return new; end if;

  if not si_is_superuser() then
    raise exception 'Only the Superuser can move a work order to a different plant once it has been assigned.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function si_guard_work_order_plant() from public, anon, authenticated;

-- `a0000_` so it fires ahead of a000_ (the priority-override guard), a00_ (the
-- priority derivation) and a0_ (the retired-reference guard): a refusal about
-- who you are should arrive before one about what you picked. Every digit sorts
-- below `_` in ASCII, which is the same fact that stops a migration being
-- numbered between two existing ones.
drop trigger if exists a0000_guard_work_order_plant on work_orders;
create trigger a0000_guard_work_order_plant
  before update on work_orders
  for each row execute function si_guard_work_order_plant();
