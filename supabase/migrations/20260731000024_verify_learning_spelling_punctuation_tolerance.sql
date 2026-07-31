-- Purpose: fail the release if punctuation tolerance or RPC privileges drift.
-- Update this verification only through a later forward migration.

do $$
begin
  if not public._learning_spelling_text_matches(
       U&'YOU\2019RE WELCOME!',
       'You''re welcome.'
     )
     or not public._learning_spelling_text_matches('YOURE WELCOME', 'You''re welcome.')
     or not public._learning_spelling_text_matches('CHECK IN', 'check-in')
     or not public._learning_spelling_text_matches('CHECKIN', 'check-in')
     or not public._learning_spelling_text_matches('ICE-CREAM', 'ice cream')
     or not public._learning_spelling_text_matches(U&'\FF21\FF30\FF30\FF2C\FF25!', 'apple') then
    raise exception 'learning spelling punctuation tolerance verification failed';
  end if;

  if public._learning_spelling_text_matches('ICECREAM!', 'ice cream')
     or public._learning_spelling_text_matches('APPLY!', 'apple')
     or public._learning_spelling_text_matches('TAKE PART', 'take part in') then
    raise exception 'learning spelling punctuation tolerance is too broad';
  end if;

  if public._learning_spelling_without_punctuation('You''re welcome.', false)
       <> 'youre welcome'
     or public._learning_spelling_without_punctuation('check-in', true)
       <> 'check in' then
    raise exception 'learning spelling punctuation forms are invalid';
  end if;

  if position(
       '_learning_spelling_text_matches' in pg_get_functiondef(
         'public.learning_record_attempt(uuid,uuid,uuid,text,jsonb,uuid,bigint)'::regprocedure
       )
     ) = 0 then
    raise exception 'learning attempt RPC does not use punctuation-tolerant matching';
  end if;

  if has_function_privilege(
       'anon',
       'public._learning_spelling_without_punctuation(text,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public._learning_spelling_without_punctuation(text,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public._learning_spelling_text_matches(text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public._learning_spelling_text_matches(text,text)',
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
    raise exception 'learning spelling punctuation RPC privileges are too broad';
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
