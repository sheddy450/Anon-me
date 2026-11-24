-- ANON_ME! database setup for Supabase.
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run. Run it once.

-- ---------- tables ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  preview text not null,
  message_count int not null default 0,
  unread boolean not null default true,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create index threads_owner on public.threads (owner_id, last_at desc);

create table public.messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.threads(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  from_owner boolean not null,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index messages_thread on public.messages (thread_id, id);

-- The anonymous sender's secret key for a thread. No one can read this table from the app.
create table public.thread_secrets (
  thread_id uuid primary key references public.threads(id) on delete cascade,
  token uuid not null
);
create index thread_secrets_token on public.thread_secrets (token);

create table public.reports (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.threads(id) on delete cascade,
  owner_id uuid not null,
  created_at timestamptz not null default now()
);

-- Words that get a message declined. Add or remove rows in Table Editor any time.
create table public.blocked_words (word text primary key);
insert into public.blocked_words (word) values ('kill yourself'), ('kys');

-- ---------- access rules ----------
alter table public.profiles enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.thread_secrets enable row level security;
alter table public.reports enable row level security;
alter table public.blocked_words enable row level security;

create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "read own threads" on public.threads for select to authenticated using (owner_id = auth.uid());
create policy "read own messages" on public.messages for select to authenticated using (owner_id = auth.uid());
grant select on public.profiles, public.threads, public.messages to authenticated;
-- Everything else (sending, replying, blocking) goes through the functions below.

-- ---------- create a profile when someone signs up ----------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data->>'username');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- helpers ----------
create function public.is_clean(p_body text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from blocked_words w where position(lower(w.word) in lower(p_body)) > 0);
$$;

create function public.username_taken(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where lower(username) = lower(p_username));
$$;

-- Returns the username with its real capitalisation, or null if there is no such user.
create function public.find_user(p_username text) returns text
language sql stable security definer set search_path = public as $$
  select username from profiles where lower(username) = lower(p_username);
$$;

-- Adds one message to a thread, enforcing the block, the word filter and the 10-message cap.
create function public.add_message(p_thread uuid, p_from_owner boolean, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare v_body text := btrim(coalesce(p_body, '')); v_t threads%rowtype;
begin
  if char_length(v_body) < 1 or char_length(v_body) > 300 then raise exception 'bad_length'; end if;
  if not is_clean(v_body) then raise exception 'blocked_words'; end if;
  select * into v_t from threads where id = p_thread for update;
  if not found then raise exception 'not_found'; end if;
  if v_t.blocked then raise exception 'thread_blocked'; end if;
  if v_t.message_count >= 10 then raise exception 'thread_closed'; end if;
  insert into messages (thread_id, owner_id, from_owner, body) values (p_thread, v_t.owner_id, p_from_owner, v_body);
  update threads set message_count = message_count + 1, last_at = now(), unread = not p_from_owner where id = p_thread;
end $$;
revoke execute on function public.add_message(uuid, boolean, text) from public, anon, authenticated;

-- ---------- what an anonymous sender can do ----------
create function public.send_message(p_username text, p_body text, p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_thread uuid; v_recent int; v_body text := btrim(coalesce(p_body, ''));
begin
  if p_token is null then raise exception 'bad_token'; end if;
  select id into v_owner from profiles where lower(username) = lower(p_username);
  if v_owner is null then raise exception 'no_user'; end if;
  if exists (select 1 from thread_secrets s join threads t on t.id = s.thread_id
             where s.token = p_token and t.owner_id = v_owner and t.blocked) then
    raise exception 'thread_blocked';
  end if;
  select count(*) into v_recent from thread_secrets s join threads t on t.id = s.thread_id
    where s.token = p_token and t.created_at > now() - interval '10 minutes';
  if v_recent >= 5 then raise exception 'rate_limited'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 300 then raise exception 'bad_length'; end if;
  if not is_clean(v_body) then raise exception 'blocked_words'; end if;
  insert into threads (owner_id, preview) values (v_owner, v_body) returning id into v_thread;
  insert into thread_secrets (thread_id, token) values (v_thread, p_token);
  perform add_message(v_thread, false, v_body);
  return v_thread;
end $$;

create function public.sender_thread(p_thread uuid, p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare v_t threads%rowtype; v_user text; v_msgs json;
begin
  if not exists (select 1 from thread_secrets where thread_id = p_thread and token = p_token) then
    raise exception 'not_found';
  end if;
  select * into v_t from threads where id = p_thread;
  select username into v_user from profiles where id = v_t.owner_id;
  select coalesce(json_agg(json_build_object('o', m.from_owner, 'b', m.body, 't', m.created_at) order by m.id), '[]'::json)
    into v_msgs from messages m where m.thread_id = p_thread;
  return json_build_object('username', v_user, 'closed', v_t.blocked or v_t.message_count >= 10,
                           'count', v_t.message_count, 'messages', v_msgs);
end $$;

create function public.sender_reply(p_thread uuid, p_token uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from thread_secrets where thread_id = p_thread and token = p_token) then
    raise exception 'not_found';
  end if;
  perform add_message(p_thread, false, p_body);
end $$;

-- ---------- what a logged-in owner can do ----------
create function public.owner_reply(p_thread uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from threads where id = p_thread and owner_id = auth.uid()) then
    raise exception 'not_found';
  end if;
  perform add_message(p_thread, true, p_body);
end $$;

create function public.mark_read(p_thread uuid) returns void
language sql security definer set search_path = public as $$
  update threads set unread = false where id = p_thread and owner_id = auth.uid();
$$;

create function public.block_thread(p_thread uuid) returns void
language sql security definer set search_path = public as $$
  update threads set blocked = true, unread = false where id = p_thread and owner_id = auth.uid();
$$;

create function public.report_thread(p_thread uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from threads where id = p_thread and owner_id = auth.uid()) then
    raise exception 'not_found';
  end if;
  insert into reports (thread_id, owner_id) values (p_thread, auth.uid());
end $$;

create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- who may call what ----------
grant execute on function public.username_taken(text), public.find_user(text),
  public.send_message(text, text, uuid), public.sender_thread(uuid, uuid),
  public.sender_reply(uuid, uuid, text) to anon, authenticated;
revoke execute on function public.owner_reply(uuid, text), public.mark_read(uuid), public.block_thread(uuid),
  public.report_thread(uuid), public.delete_my_account() from public, anon;
grant execute on function public.owner_reply(uuid, text), public.mark_read(uuid), public.block_thread(uuid),
  public.report_thread(uuid), public.delete_my_account() to authenticated;

-- ---------- live updates for the inbox ----------
alter publication supabase_realtime add table public.messages;
