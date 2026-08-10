-- SI — Service Inside · migration 0010
--
-- Closes the audit-trail gap carried over from the Firebase original.
--
-- Before: the client ran two statements — UPDATE work_orders, then INSERT
-- work_order_history. A failure or a lost connection between them left the work
-- order advanced with no record of who advanced it.
--
-- After: one function call, so both happen in a single transaction. If the
-- transition trigger rejects the change, the history row is never written; if the
-- history insert fails, the status change rolls back with it.
--
-- SECURITY INVOKER (the default, stated explicitly): RLS and
-- si_guard_work_order_transition() still evaluate as the calling user. This
-- function makes the write atomic, it does not make it privileged.
--
-- It also stops the audit trail being self-reported. The old client passed
-- actor_name and actor_role as arguments; both are now read from public.users
-- using auth.uid(), so the history says who the session actually belongs to.

create or replace function si_transition_work_order(
  p_wo_id      uuid,
  p_to_status  si_wo_status,
  p_fields     jsonb        default '{}'::jsonb,
  p_remarks    text         default null,
  p_via_status si_wo_status default null
)
returns work_orders
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_from       si_wo_status;
  v_actor_name text;
  v_actor_role si_role;
  v_row        work_orders;
begin
  select status into v_from from work_orders where id = p_wo_id;
  if not found then
    raise exception 'Work order not found, or outside what your role can see.'
      using errcode = 'no_data_found';
  end if;

  select name, role into v_actor_name, v_actor_role
    from users where id = auth.uid();
  if v_actor_name is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- Explicit whitelist rather than dynamic SQL from p_fields. Only the columns a
  -- transition is ever allowed to carry can be set here; anything else in the
  -- payload is ignored rather than trusted. The trigger-owned columns
  -- (wo_number, the SLA deadlines, decline_count, resolved_at, closed_at,
  -- verified_at, sla_breached) are deliberately absent.
  update work_orders set
    status            = p_to_status,
    assigned_to_id    = case when p_fields ? 'assigned_to_id'
                             then nullif(p_fields->>'assigned_to_id', '')::uuid
                             else assigned_to_id end,
    assigned_to_name  = case when p_fields ? 'assigned_to_name'
                             then p_fields->>'assigned_to_name' else assigned_to_name end,
    decline_reason    = case when p_fields ? 'decline_reason'
                             then p_fields->>'decline_reason' else decline_reason end,
    spare_part_reason = case when p_fields ? 'spare_part_reason'
                             then p_fields->>'spare_part_reason' else spare_part_reason end,
    test_fail_reason  = case when p_fields ? 'test_fail_reason'
                             then p_fields->>'test_fail_reason' else test_fail_reason end,
    resolution_notes  = case when p_fields ? 'resolution_notes'
                             then p_fields->>'resolution_notes' else resolution_notes end,
    reopen_reason     = case when p_fields ? 'reopen_reason'
                             then p_fields->>'reopen_reason' else reopen_reason end,
    verified_by       = case when p_fields ? 'verified_by'
                             then nullif(p_fields->>'verified_by', '')::uuid
                             else verified_by end
  where id = p_wo_id
  returning * into v_row;

  -- RLS filters a denied UPDATE to zero rows rather than raising, so this is
  -- where a permission failure surfaces.
  if not found then
    raise exception 'You do not have permission to change this work order.'
      using errcode = 'insufficient_privilege';
  end if;

  -- p_via_status covers verify-and-close, where the status goes straight from
  -- completed to closed but the trail must still show the verification step.
  if p_via_status is not null then
    insert into work_order_history
      (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks)
    values
      (p_wo_id, v_from, p_via_status, auth.uid(), v_actor_name, v_actor_role, p_remarks),
      (p_wo_id, p_via_status, p_to_status, auth.uid(), v_actor_name, v_actor_role, null);
  else
    insert into work_order_history
      (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks)
    values
      (p_wo_id, v_from, p_to_status, auth.uid(), v_actor_name, v_actor_role, p_remarks);
  end if;

  return v_row;
end
$fn$;

-- Signed-in users only. Postgres grants EXECUTE to PUBLIC by default and
-- PostgREST publishes anything executable in public as an anon-callable RPC —
-- see migration 0007 for what that cost us the first time.
revoke all on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) from public;
revoke all on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) from anon;
grant execute on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) to authenticated;

comment on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) is
  'Atomically advance a work order and append its history row. SECURITY INVOKER: RLS and the transition guard still apply.';
