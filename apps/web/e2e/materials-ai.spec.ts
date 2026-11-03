import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.RUN_MATERIAL_AI_PLAYWRIGHT !== "1", "Materials AI worker is not part of this Playwright run");

async function signUp(page: Page, email: string, password: string) {
  // Authentication is still the existing Chinese production shell. Keep the
  // Materials AI fixture in English after sign-in without widening this change
  // into an unrelated auth-page migration.
  await page.addInitScript(() => localStorage.setItem("nalanda-locale", "en"));
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByPlaceholder("you@school.edu").fill(email);
  await page.getByPlaceholder("At least 6 characters").fill(password);
  await page.getByRole("button", { name: "Sign up and continue" }).click();
  await expect(page.locator(".brand-name")).toHaveText("Nalanda");
}

test("upload, queue, generate, take, grade, organize knowledge, and retain Materials AI results", async ({ page }) => {
  test.setTimeout(240_000);
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await signUp(page, `materials-ai-${nonce}@example.com`, `Nalanda-${nonce}!`);
  await page.locator('#nav [data-go="materials"]').click();
  await expect(page.getByRole("heading", { name: "Materials", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New course" }).first().click();
  const courseModal = page.locator(".modal");
  await courseModal.locator("#nc-code").fill("BIO AI");
  await courseModal.locator("#nc-name").fill(`AI Biology ${nonce}`);
  await courseModal.getByRole("button", { name: "Create", exact: true }).click();
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
  await expect(page.getByRole("button", { name: /Organize knowledge points/ })).toBeEnabled();
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

  await expect(page.getByRole("heading", { level: 1, name: "Generated study test", exact: true })).toBeVisible();
  await expect(page.getByText("AI-generated", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Start timed attempt" }).click();
  await expect(page.getByText("Leaving this page does not pause the timer.")).toBeVisible();
  await expect(page.getByText("A supported model answer.")).toBeHidden();
  await page.locator(".material-ai-question").first().getByRole("radio").first().check();
  const shortAnswer = page.locator(".material-ai-question").filter({ hasText: "Short answer" });
  const autosaved = page.waitForResponse((response) => response.request().method() === "PATCH"
    && response.url().includes("/api/exam-attempts/") && response.url().endsWith("/answers") && response.ok());
  await shortAnswer.getByPlaceholder("Type your answer…").fill("The membrane controls movement.");
  await autosaved;
  await expect(page.getByText("Saving…")).toBeHidden();
  await page.getByRole("button", { name: "Submit paper" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit paper", exact: true }).click();
  await expect(page.getByText("Grading completed.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Answer and explanation").first()).toBeVisible();

  await page.locator('#nav [data-go="notes"]').click();
  await expect(page.getByRole("heading", { name: "Your generated notes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
  await expect(page.getByText("Generated study test", { exact: true })).toBeVisible();

  await page.locator('#nav [data-go="materials"]').click();
  await expect(materialRow).toBeVisible();
  await materialRow.getByRole("button", { name: "Use AI" }).click();
  await page.getByRole("button", { name: /Organize knowledge points/ }).click();
  const graphSettings = page.locator(".modal");
  await expect(graphSettings.getByRole("heading", { name: "cells.txt" })).toBeVisible();
  await graphSettings.getByLabel(/Topic focus/).fill("playwright-250-node-layout");
  await graphSettings.getByRole("button", { name: "Generate", exact: true }).click();
  const graphQueueRow = page.getByRole("region", { name: "AI generation queue" })
    .locator(".list-row").filter({ hasText: "Knowledge map" }).first();
  await expect(graphQueueRow.getByRole("button", { name: "Open result" })).toBeVisible({ timeout: 60_000 });
  await graphQueueRow.getByRole("button", { name: "Open result" }).click();
  await expect(page.getByRole("region", { name: "Interactive knowledge graph" })).toBeVisible();
  await expect(page.getByText("Knowledge map overview", { exact: true })).toBeVisible();
  const graphNodes = page.locator(".react-flow__node");
  await expect(graphNodes).toHaveCount(250);
  const firstNode = graphNodes.first();
  const firstNodeId = await firstNode.getAttribute("data-id");
  const box = await firstNode.boundingBox();
  expect(firstNodeId).toBeTruthy();
  expect(box).toBeTruthy();
  const layoutSaved = page.waitForResponse((response) => response.request().method() === "PUT"
    && response.url().includes("/knowledge-graph-layout") && response.ok());
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y + box!.height / 2 + 45, { steps: 8 });
  await page.mouse.up();
  const layoutResponse = await layoutSaved;
  const savedLayout = await layoutResponse.json();
  expect(savedLayout.positions.some((position: { nodeId: string }) => position.nodeId === firstNodeId)).toBe(true);
  await page.locator(".material-flow-node-content").first().click();
  await page.getByPlaceholder("Ask a specific question…").fill("Explain this knowledge point in simpler terms.");
  await page.getByRole("button", { name: "Ask this point" }).click();
  await expect(page.getByText("Answer", { exact: true })).toBeVisible({ timeout: 60_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".material-flow-node-content").first().click();
  const mobileCanvas = await page.getByRole("region", { name: "Interactive knowledge graph" }).boundingBox();
  const mobileInspector = await page.locator(".material-knowledge-detail").boundingBox();
  expect(mobileCanvas).toBeTruthy();
  expect(mobileInspector).toBeTruthy();
  expect(mobileInspector!.y).toBeGreaterThanOrEqual(mobileCanvas!.y + mobileCanvas!.height);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.locator('#nav [data-go="materials"]').click();
  const examHistoryRow = page.getByRole("region", { name: "AI generation queue" })
    .locator(".list-row").filter({ hasText: "Test paper" }).first();
  await examHistoryRow.getByRole("button", { name: "Delete task" }).click();
  const terminalDelete = page.waitForResponse((response) => response.request().method() === "DELETE"
    && response.url().includes("/api/ai-jobs/") && response.ok());
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await terminalDelete;
  await expect(examHistoryRow).toBeHidden({ timeout: 30_000 });

  await materialRow.getByRole("button", { name: "Use AI" }).click();
  await page.getByRole("button", { name: /Organize knowledge points/ }).click();
  const activeSettings = page.locator(".modal");
  await activeSettings.getByLabel(/Topic focus/).fill("playwright-active-delete");
  await activeSettings.getByRole("button", { name: "Generate", exact: true }).click();
  const graphRows = page.getByRole("region", { name: "AI generation queue" })
    .locator(".list-row").filter({ hasText: "Knowledge map" });
  const activeRow = graphRows.first();
  await expect(activeRow).toContainText(/Validating|Safety review|Organizing knowledge points/, { timeout: 30_000 });

  await page.getByRole("button", { name: "Clear history" }).click();
  const cleared = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/ai-jobs/clear-history") && response.ok());
  await page.getByRole("dialog").getByRole("button", { name: "Clear history", exact: true }).click();
  await cleared;
  await expect(graphRows).toHaveCount(1, { timeout: 30_000 });
  await expect(activeRow).toBeVisible();

  await activeRow.getByRole("button", { name: "Delete task" }).click();
  const activeDelete = page.waitForResponse((response) => response.request().method() === "DELETE"
    && response.url().includes("/api/ai-jobs/") && response.ok());
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await activeDelete;
  await expect(graphRows).toHaveCount(0, { timeout: 30_000 });

  await page.locator('#nav [data-go="profile"]').click();
  await expect(page.getByRole("heading", { name: "Free Plan" })).toBeVisible();
  await expect(page.getByText("AI generations remaining today").locator("..").locator(".stat-n")).toHaveText("6/10");
  await expect(page.getByText("Subjective grading runs remaining today").locator("..").locator(".stat-n")).toHaveText("9/10");

  await page.locator('#nav [data-go="materials"]').click();
  await page.getByRole("button", { name: "BIO AI", exact: true }).click();
  await page.getByRole("button", { name: "Delete course", exact: true }).click();
  const deleted = page.waitForResponse((response) => response.request().method() === "DELETE"
    && response.url().includes("/api/material-courses/"));
  await page.getByRole("button", { name: "Delete source and results", exact: true }).click();
  const deleteResponse = await deleted;
  expect(deleteResponse.ok(), await deleteResponse.text()).toBe(true);
  await expect(page.getByText("Course deleted", { exact: true })).toBeVisible();
  await expect(page.getByText(`AI Biology ${nonce}`, { exact: true })).toBeHidden();
  await page.locator('#nav [data-go="notes"]').click();
  await expect(page.getByRole("heading", { name: "Your generated notes" })).toBeVisible();
  await expect(page.getByText("Generated study test", { exact: true })).toBeHidden();
  await expect(page.getByText("Knowledge map overview", { exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
});
