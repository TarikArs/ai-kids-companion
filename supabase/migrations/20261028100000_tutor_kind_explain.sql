-- Allow the tutor to send "explain" messages (Explique-moi button).
alter table public.tutor_messages drop constraint if exists tutor_messages_kind_check;
alter table public.tutor_messages
  add constraint tutor_messages_kind_check
  check (kind in ('hint', 'praise', 'question', 'encourage', 'explain', 'parent_relay', 'system'));
