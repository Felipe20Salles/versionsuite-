-- 2026-08-23_03_claim_invite.sql
--
-- Resgata TODOS os convites pendentes do e-mail logado de uma vez (cobre o
-- caso de alguém convidado por mais de um workspace antes do primeiro
-- login), criando a membership 'active' já com o role escolhido pelo admin
-- e apagando o convite. Chamada só pelo client, nunca dentro de
-- bootstrap_login() — ver Global Constraints deste plano.

create or replace function claim_invite()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv record;
  claimed jsonb := '[]'::jsonb;
begin
  for inv in
    select * from workspace_invites where lower(email) = lower(auth.jwt()->>'email')
  loop
    insert into workspace_members (workspace_id, user_id, role_id, status)
    values (inv.workspace_id, auth.uid(), inv.role_id, 'active')
    on conflict (workspace_id, user_id) do update
      set status='active', role_id=excluded.role_id
      where workspace_members.status<>'active';
    delete from workspace_invites where id = inv.id;
    claimed := claimed || jsonb_build_object('workspace_id', inv.workspace_id);
  end loop;
  return claimed;
end;
$$;

revoke execute on function claim_invite() from public;
grant execute on function claim_invite() to authenticated;
