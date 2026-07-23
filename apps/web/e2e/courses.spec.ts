import { expect, test, type Page } from "@playwright/test";

async function signUp(page: Page, email: string, password: string) {
  // The full business-flow fixture stays in Chinese; default-English and live
  // locale switching are covered by the focused Courses component tests.
  await page.addInitScript(() => localStorage.setItem("nalanda-locale", "zh"));
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByPlaceholder("you@school.edu").fill(email);
  await page.getByPlaceholder("至少 6 位").fill(password);
  await page.getByRole("button", { name: "注册并进入" }).click();
  await expect(page.locator(".brand-name")).toHaveText("Nalanda");
}

async function openCourses(page: Page) {
  await page.locator('#nav [data-go="courses"]').click();
  await expect(page.getByRole("heading", { name: "学习课程", exact: true })).toBeVisible();
}

async function signOut(page: Page) {
  await page.locator('[data-act="signOut"]').click();
  // The shell delegates to an async Supabase sign-out. Wait for the auth UI so
  // a following navigation cannot abort the request and preserve the old user.
  await expect(page.getByRole("button", { name: "注册", exact: true })).toBeVisible();
}

async function assessWithFixedWav(page: Page, courseTitle: string) {
  const result = await page.evaluate(async (title) => {
    const stored = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index)!)).map((value) => {
      try { return value ? JSON.parse(value) : null; } catch { return null; }
    }).find((value) => value?.access_token);
    if (!stored?.access_token) throw new Error("Supabase browser session token not found");
    const headers = { Authorization: `Bearer ${stored.access_token}` };
    const coursesResponse = await fetch("/api/learning-courses", { headers });
    const courses = await coursesResponse.json();
    const course = courses.find((entry: { title: string }) => entry.title === title);
    if (!course?.activeSessionId) throw new Error("active learning session not found");
    const sessionResponse = await fetch(`/api/learning-sessions/${course.activeSessionId}`, { headers });
    const session = await sessionResponse.json();
    const samples = 1_600;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    write(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, "data"); view.setUint32(40, samples * 2, true);
    const form = new FormData();
    form.append("sessionId", session.id); form.append("wordId", session.items[0].word.id);
    form.append("audio", new Blob([buffer], { type: "audio/wav" }), "fixed.wav");
    const response = await fetch("/api/pronunciation/assess", { method: "POST", headers, body: form });
    return { status: response.status, body: await response.json() };
  }, courseTitle);
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({ pronunciationScore: 93, accuracyScore: 92,
    passThreshold: 70, passed: true, queuedForRetry: false });
}

test("create, validate, resume, learn, schedule, publish, and clone a vocabulary course", async ({ page }) => {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = `Nalanda-${nonce}!`;
  // The local Supabase stack intentionally survives a Playwright retry. A
  // unique title prevents the first attempt's immutable market publication
  // from making retry assertions ambiguous.
  const courseTitle = `E2E English Vocabulary ${nonce}`;
  await signUp(page, `courses-a-${nonce}@example.com`, password);
  await openCourses(page);

  await page.getByRole("button", { name: "创建第一门课程" }).click();
  await page.getByRole("button", { name: /英语单词学习/ }).click();
  await expect(page.getByText("AI 解析即将推出")).toBeVisible();
  await page.getByRole("button", { name: /复制文本词表/ }).click();
  await page.locator("#new-course-title").fill(courseTitle);
  await page.getByLabel("有单元").check();
  await page.getByLabel("整份多单元词表").check();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByLabel("整份多单元词表").fill("Starter Unit 1\napple 苹果\napple 水果\nStarter Unit 2\norange 橙子\npear 梨");
  await page.getByRole("button", { name: "解析并进入编辑" }).click();
  await expect(page.getByText(/DUPLICATE_TERM/)).toBeVisible();
  await page.getByLabel("整份多单元词表").fill("Starter Unit 1\napple 苹果\nbanana 香蕉\nStarter Unit 2\norange 橙子\npear 梨");
  await page.getByRole("button", { name: "解析并进入编辑" }).click();
  await expect(page.getByRole("heading", { name: "确认课程内容" })).toBeVisible();

  const content = page.locator(".content");
  await expect.poll(() => content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole("button", { name: /添加单元/ })).toBeInViewport();

  const pearHandle = page.getByRole("button", { name: "拖动 pear" });
  const orangeRow = page.locator(".course-word-row").filter({ has: page.locator('input[aria-label="英文"][value="orange"]') });
  await pearHandle.dragTo(orangeRow);
  await expect(page.locator(".course-editor-unit").nth(1).getByLabel("英文").first()).toHaveValue("pear");

  // Explicit keyboard-accessible controls complement pointer/touch drag-and-drop.
  await page.getByLabel("上移单词").nth(3).click();
  await page.getByRole("button", { name: "保存课程" }).click();
  await expect(page.getByRole("heading", { name: courseTitle, exact: true })).toBeVisible();
  await expect(page.getByText("0%", { exact: true })).toBeVisible();

  await page.getByRole("article").getByRole("button", { name: "开始学习" }).click();
  await page.locator(".modal select").selectOption({ index: 0 });
  await page.locator(".modal").getByRole("button", { name: "开始学习" }).click();
  await expect(page.locator(".course-term")).toHaveText("apple");
  await assessWithFixedWav(page, courseTitle);
  await page.getByRole("button", { name: "认识了，继续" }).click();

  // A full reload returns to the shell; the course card still resumes the exact
  // server-side stage, cursor, and queue.
  await page.reload(); await openCourses(page);
  await page.getByRole("button", { name: "继续学习" }).click();
  await expect(page.locator(".course-term")).toHaveText("banana");
  await page.getByRole("button", { name: "认识了，继续" }).click();

  for (let index = 0; index < 2; index += 1) {
    const audio = page.locator(".course-match > div").first().getByRole("button").first();
    const term = (await audio.getAttribute("aria-label"))!.replace(/^播放 /, "");
    await audio.click();
    await page.locator(".course-match > div").nth(1).getByRole("button", { name: term, exact: true }).click();
    await expect(page.locator(".course-match button.is-correct").first()).toBeVisible();
    await expect(page.getByText("回答正确，正在进入下一题…")).toBeVisible();
    await expect(page.getByText("回答正确，正在进入下一题…")).toBeHidden();
  }
  await expect(page.locator(".course-term")).toHaveText("apple");
  await page.getByRole("button", { name: "香蕉", exact: true }).click();
  await expect(page.locator(".course-option.is-wrong")).toHaveText("香蕉");
  await expect(page.getByText("回答错误，已加入下一轮候补池")).toBeVisible();
  await page.waitForTimeout(1_300);
  await expect(page.locator(".course-term")).toHaveText("apple");
  await expect(page.getByText("回答错误，已加入下一轮候补池")).toBeVisible();
  await page.getByRole("button", { name: "下一题", exact: true }).click();

  for (const [term, translation] of [["banana", "香蕉"], ["apple", "苹果"]] as const) {
    await expect(page.locator(".course-term")).toHaveText(term);
    await page.getByRole("button", { name: translation, exact: true }).click();
    await expect(page.locator(".course-option.is-correct")).toHaveText(translation);
    await expect(page.getByText("回答正确，正在进入下一题…")).toBeVisible();
    await expect(page.getByText("回答正确，正在进入下一题…")).toBeHidden();
  }
  for (const term of ["apple", "banana"]) {
    await page.getByLabel("拼写答案").fill(term);
    await page.getByLabel("拼写答案").press("Enter");
    await expect(page.locator(".course-spelling-answer.is-correct")).toBeVisible();
    await expect(page.getByText("回答正确，正在进入下一题…")).toBeVisible();
    await expect(page.getByText("回答正确，正在进入下一题…")).toBeHidden();
  }
  await expect(page.getByRole("heading", { name: /首次学习完成/ })).toBeVisible();
  await page.getByLabel("3 天后").check();
  await page.getByRole("button", { name: "保存并返回" }).click();

  await page.locator('#nav [data-go="schedule"]').click();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.getByText(`复习 ${courseTitle}`, { exact: false })).toBeVisible();
  await openCourses(page);

  const dialogs = async (dialog: import("@playwright/test").Dialog) => {
    if (dialog.type() === "prompt") await dialog.accept("A free E2E vocabulary course");
    else await dialog.accept();
  };
  page.on("dialog", dialogs);
  await page.getByRole("button", { name: "上架市场" }).click();
  await expect(page.getByText(/课程版本已上架/)).toBeVisible();
  page.off("dialog", dialogs);
  await page.locator('#nav [data-go="market"]').click();
  await page.getByRole("button", { name: "课程市场" }).click();
  await expect(page.getByRole("heading", { name: courseTitle, exact: true })).toBeVisible();
  await expect(page.getByText("免费", { exact: true })).toBeVisible();

  await signOut(page);
  await signUp(page, `courses-b-${nonce}@example.com`, password);
  await page.locator('#nav [data-go="market"]').click();
  await page.getByRole("button", { name: "课程市场" }).click();
  await page.getByRole("button", { name: "免费克隆" }).click();
  await expect(page.getByRole("heading", { name: `${courseTitle}（副本）`, exact: true })).toBeVisible();
  await expect(page.getByText("0%", { exact: true })).toBeVisible();
});
