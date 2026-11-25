select 'colunas' as cat, md5(string_agg(x, '|' order by x)) as h, count(*) as n from (
  select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as x from information_schema.columns where table_schema='public') t
union all select 'restricoes', md5(string_agg(x, '|' order by x)), count(*) from (
  select conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace='public'::regnamespace) t
union all select 'indices', md5(string_agg(indexdef, '|' order by indexdef)), count(*) from pg_indexes where schemaname='public'
union all select 'politicas', md5(string_agg(x, '|' order by x)), count(*) from (
  select tablename||':'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual,'')||':'||coalesce(with_check,'') as x from pg_policies where schemaname='public') t
union all select 'funcoes', md5(string_agg(x, '|' order by x)), count(*) from (
  select proname||':'||prosecdef||':'||coalesce(array_to_string(proconfig,','),'')||':'||pg_get_functiondef(oid) as x from pg_proc where pronamespace='public'::regnamespace) t
union all select 'gatilhos', md5(string_agg(x, '|' order by x)), count(*) from (
  select tgrelid::regclass::text||':'||tgname||':'||pg_get_triggerdef(oid) as x from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%' or (not tgisinternal and tgrelid::regclass::text in ('questao'))) t
union all select 'rls', md5(string_agg(x, '|' order by x)), count(*) from (
  select relname||':'||relrowsecurity as x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r') t
union all select 'priv_tabelas', md5(string_agg(x, '|' order by x)), count(*) from (
  select c.relname||':'||r.rolname||':'||p.priv as x from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)
  cross join (values ('select'),('insert'),('update'),('delete')) p(priv)
  where n.nspname='public' and c.relkind='r' and has_table_privilege(r.rolname, c.oid, p.priv)) t
union all select 'priv_colunas', md5(string_agg(x, '|' order by x)), count(*) from (
  select a.attrelid::regclass::text||'.'||a.attname||':'||r.rolname||':'||p.priv as x from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  cross join (values ('anon'),('authenticated')) r(rolname) cross join (values ('select'),('insert'),('update')) p(priv)
  where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped and has_column_privilege(r.rolname, a.attrelid, a.attnum, p.priv)) t
order by 1;
