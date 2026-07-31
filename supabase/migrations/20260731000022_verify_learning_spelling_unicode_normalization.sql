-- Purpose: fail the release if spelling normalization or RPC privileges drift.
-- Update this verification only through a later forward migration.

do $$
begin
  if public._learning_normalize_spelling_text('  TAKE   PART IN  ') <> 'take part in'
     or public._learning_normalize_spelling_text(U&'\FF21\FF30\FF30\FF2C\FF25') <> 'apple'
     or public._learning_normalize_spelling_text(U&'YOU\2019RE WELCOME.') <> 'you''re welcome.'
     or public._learning_normalize_spelling_text(U&'CHECK\2011IN') <> 'check-in' then
    raise exception 'learning spelling normalization verification failed';
  end if;

  if public._learning_normalize_spelling_text('YOURE WELCOME.')
       = public._learning_normalize_spelling_text('You''re welcome.')
     or public._learning_normalize_spelling_text('CHECK IN')
       = public._learning_normalize_spelling_text('check-in') then
    raise exception 'learning spelling punctuation was relaxed';
  end if;

  if has_function_privilege(
       'anon',
       'public._learning_normalize_spelling_text(text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public._learning_normalize_spelling_text(text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.learning_record_attempt(uuid,uuid,uuid,text,jsonb,uuid,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_record_attempt(uuid,uuid,uuid,text,jsonb,uuid,bigint)',
       'EXECUTE'
     ) then
    raise exception 'learning spelling RPC privileges are too broad';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.learning_record_attempt(uuid,uuid,uuid,text,jsonb,uuid,bigint)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute learning spelling attempt RPC';
  end if;
end;
$$;
