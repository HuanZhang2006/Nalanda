-- Purpose: fail the release if pronunciation-exam structure or service-only
-- permissions drift from migration 0029. Update only through a later forward
-- migration.

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.learning_start_exam_session(uuid,uuid,uuid,jsonb,integer,text)',
    'public.learning_continue_exam_retry_round(uuid,uuid)'
  ] loop
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'service_role cannot execute %', v_signature;
    end if;
    if has_function_privilege('public', v_signature, 'EXECUTE')
       or has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'client role can execute service-only function %', v_signature;
    end if;
  end loop;
end;
$$;

do $$
begin
  if position(
    '''examKind'', p_exam_kind'
    in pg_get_functiondef(
      'public.learning_start_exam_session(uuid,uuid,uuid,jsonb,integer,text)'::regprocedure
    )
  ) = 0 then
    raise exception 'pronunciation exam kind is not persisted in session state';
  end if;
  if position(
    'v_exam_correct * 100 >= v_exam_required * v_exam_total'
    in pg_get_functiondef(
      'public.learning_record_speech_assessment(uuid,uuid,uuid,jsonb)'::regprocedure
    )
  ) = 0 then
    raise exception 'pronunciation exam pass/fail must use exact first-round counts';
  end if;
  if position(
    '''retrySummaryScores'', v_score_map'
    in pg_get_functiondef(
      'public.learning_record_speech_assessment(uuid,uuid,uuid,jsonb)'::regprocedure
    )
  ) = 0 then
    raise exception 'pronunciation retry summary scores are not durable';
  end if;
  if position(
    'v_exam_kind = ''pronunciation'''
    in pg_get_functiondef(
      'public._learning_apply_passed_exam_progress()'::regprocedure
    )
  ) = 0 then
    raise exception 'passed pronunciation exams do not project pronunciation progress';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege(
       'anon',
       'public.learning_record_speech_assessment(uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_record_speech_assessment(uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'client role can execute pronunciation assessment workflow';
  end if;
end;
$$;
