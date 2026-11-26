-- The signup trigger is never meant to be called through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- is_plus(uid) answers for ANY user id, so only the server may call it.
-- The app reads a person's own status from public.subscriptions (RLS).
revoke execute on function public.is_plus(uuid) from public, anon, authenticated;
grant execute on function public.is_plus(uuid) to service_role;
