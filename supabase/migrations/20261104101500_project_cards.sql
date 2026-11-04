-- NYNZ 0.3.9: dashboard project cards without waking sandboxes.
-- Live preview thumbnails woke a sandbox per card and charged runtime credits.
-- Cards are now drawn from a tiny summary of each app's own source: its page
-- title, first heading and most-used colours. Owner-only, read-only.
create or replace function public.my_project_cards()
returns table(project_id uuid, title text, heading text, background text, colors text[])
language sql stable security definer set search_path = '' as $$
  select p.id,
    (select nullif(trim(substring(f.content from '<title>([^<]{1,80})</title>')), '') from public.project_files f where f.project_id = p.id and f.path = 'index.html'),
    (select nullif(trim(regexp_replace(substring(f.content from '<h1[^>]*>\s*([^<{]{2,80}?)\s*<'), '\s+', ' ', 'g')), '')
       from public.project_files f where f.project_id = p.id and f.path ~ '^src/.*\.(tsx|jsx)$' and f.content ~ '<h1'
       order by (f.path = 'src/App.tsx') desc, f.path limit 1),
    (select lower(substring(f.content from '(?:body|:root|html)[^{]*\{[^}]*?background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})'))
       from public.project_files f where f.project_id = p.id and f.path ~ '\.css$' order by (f.path = 'src/index.css') desc limit 1),
    (select array_agg(c order by n desc) from (
       select lower(m[1]) c, count(*) n
       from public.project_files f, regexp_matches(f.content, '(#[0-9a-fA-F]{6})(?![0-9a-fA-F])', 'g') m
       where f.project_id = p.id and f.path ~ '\.(css|tsx|ts)$'
       group by 1 order by 2 desc limit 6) top)
  from public.projects p
  where p.owner_id = auth.uid() and private.account_active(auth.uid());
$$;
revoke all on function public.my_project_cards() from public, anon;
grant execute on function public.my_project_cards() to authenticated;
