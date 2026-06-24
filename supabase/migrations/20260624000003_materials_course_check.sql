-- Nalanda · 0003 强化 materials 写入约束：只能挂到自己拥有的课程
-- （原 0002 策略只校验 material.user_id；这里追加 course 归属校验）

drop policy if exists materials_all_own on public.materials;
create policy materials_all_own on public.materials
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.courses c
      where c.id = materials.course_id and c.user_id = auth.uid()
    )
  );
