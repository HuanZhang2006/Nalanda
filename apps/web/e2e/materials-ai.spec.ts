import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.RUN_MATERIAL_AI_PLAYWRIGHT !== "1", "Materials AI worker is not part of this Playwright run");

async function signUp(page: Page, email: string, password: string) {
  // Authentication is still the existing Chinese production shell. Keep the
  // Materials AI fixture in English after sign-in without widening this change
  // into an unrelated auth-page migration.
  await page.addInitScript(() => localStorage.setItem("nalanda-locale", "en"));
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByPlaceholder("you@school.edu").fill(email);
  await page.getByPlaceholder("至少 6 位").fill(password);
  await page.getByRole("button", { name: "注册并进入" }).click();
  await expect(page.locator(".brand-name")).toHaveText("Nalanda");
}

test("upload, queue, generate, take, grade, and retain a Materials AI exam", async ({ page }) => {
  test.setTimeout(180_000);
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await signUp(page, `materials-ai-${nonce}@example.com`, `Nalanda-${nonce}!`);
  await page.locator('#nav [data-go="materials"]').click();
  await expect(page.getByRole("heading", { name: "Materials", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New course" }).click();
  await page.locator("#nc-code").fill("BIO AI");
  await page.locator("#nc-name").fill(`AI Biology ${nonce}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(`AI Biology ${nonce}`, { exact: true })).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload material" }).click();
  await (await chooser).setFiles({
    name: "cells.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Cells have membranes. The membrane controls movement into and out of the cell. Mitochondria release usable energy."),
  });
  const materialRow = page.locator(".mat-row").filter({ hasText: "cells.txt" });
  await expect(materialRow).toBeVisible();
  await materialRow.getByRole("button", { name: "Use AI" }).click();
  await expect(page.getByRole("button", { name: /Knowledge list.*Coming soon/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Quiz.*Coming soon/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Knowledge graph.*Coming soon/ })).toBeDisabled();
  await page.getByRole("button", { name: /Generate test paper/ }).click();

  const settings = page.locator(".modal");
  await settings.getByLabel("Single choice").fill("4");
  await settings.getByLabel("Multiple choice").fill("0");
  await settings.getByLabel("True / false").fill("0");
  await settings.getByLabel("Fill in the blank").fill("0");
  await settings.getByLabel("Short answer").fill("1");
  await settings.getByLabel("Essay").fill("0");
  await settings.getByLabel("Total marks").fill("20");
  await settings.getByRole("checkbox").check();
  await settings.getByRole("button", { name: "Generate", exact: true }).click();

  const queue = page.getByRole("region", { name: "AI generation queue" });
  await expect(queue).toContainText("cells.txt");
  await expect(queue.getByRole("button", { name: "Open result" })).toBeVisible({ timeout: 60_000 });
  await expect(queue).toContainText("Ready");
  await queue.getByRole("button", { name: "Open result" }).click();

  await expect(page.getByRole("heading", { name: "Generated study test", exact: true })).toBeVisible();
  await expect(page.getByText("AI-generated", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Start timed attempt" }).click();
  await expect(page.getByText("Leaving this page does not pause the timer.")).toBeVisible();
  await expect(page.getByText("A supported model answer.")).toBeHidden();
  await page.locator(".material-ai-question").first().getByRole("radio").first().check();
  const shortAnswer = page.locator(".material-ai-question").filter({ hasText: "Short answer" });
  await shortAnswer.getByPlaceholder("Type your answer…").fill("The membrane controls movement.");
  await expect(page.getByText("Saving…")).toBeVisible();
  await expect(page.getByText("Saving…")).toBeHidden();
  await page.getByRole("button", { name: "Submit paper" }).click();
  await expect(page.getByText("Grading completed.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Answer and explanation").first()).toBeVisible();

  await page.locator('#nav [data-go="notes"]').click();
  await expect(page.getByRole("heading", { name: "Your generated notes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
  await expect(page.getByText("Generated study test", { exact: true })).toBeVisible();
  await page.locator('#nav [data-go="profile"]').click();
  await expect(page.getByRole("heading", { name: "Free Plan" })).toBeVisible();
  await expect(page.getByText("Test paper generations remaining today").locator("..").locator(".stat-n")).toHaveText("9/10");
  await expect(page.getByText("Subjective grading runs remaining today").locator("..").locator(".stat-n")).toHaveText("9/10");

  await page.locator('#nav [data-go="materials"]').click();
  await page.getByRole("button", { name: "BIO AI", exact: true }).click();
  await page.getByRole("button", { name: "Delete course", exact: true }).click();
  await page.getByRole("button", { name: "Delete source and results", exact: true }).click();
  await expect(page.getByText(`AI Biology ${nonce}`, { exact: true })).toBeHidden();
  await page.locator('#nav [data-go="notes"]').click();
  await expect(page.getByRole("heading", { name: "Your generated notes" })).toBeVisible();
  await expect(page.getByText("Generated study test", { exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
});
