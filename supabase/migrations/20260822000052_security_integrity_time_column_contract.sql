-- Nalanda · 0052 security integrity time-column contract
--
-- Stage A (0039–0040) kept two authenticated UPDATE column grants so the
-- already-deployed Web could continue sending client timestamps while the
-- database overwrote them. The compatible application has now been observed
-- in production for more than the required 24 hours and no supported runtime
-- submits either field. Finish the contract without changing table shape,
-- triggers, RLS, points, Materials AI, Courses or service-role access.

revoke update (updated_at)
  on table public.posts
  from authenticated;

revoke update (done_at)
  on table public.study_tasks
  from authenticated;
