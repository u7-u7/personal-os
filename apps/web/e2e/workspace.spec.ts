import { test, expect } from "@playwright/test";
import path from "node:path";

test("real workspace: account, task, memory consent, approval and model boundary", async ({
  page,
}) => {
  const stamp = Date.now();
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill("Alex");
  await page
    .getByLabel("Email address")
    .fill(`acceptance-${stamp}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(`Workspace-check-${stamp}`);
  await page.getByRole("button", { name: "Create your workspace" }).click();
  await expect(
    page.getByRole("heading", {
      name: /Good (morning|afternoon|evening), Alex/,
    }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await page.screenshot({
    animations: "disabled",
    path: path.resolve("../../docs/evidence/dashboard-light.png"),
    fullPage: true,
  });

  await page.goto("/tasks");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Prepare a thoughtful day");
  await page
    .getByLabel("Notes")
    .fill("Created through the real PersonalOS UI acceptance flow.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add task", exact: true })
    .click();
  await expect(
    page.getByText("Prepare a thoughtful day", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete task", exact: true })
    .click();
  await page.getByRole("button", { name: /Completed/ }).click();
  await expect(
    page.getByText("Prepare a thoughtful day", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.goto("/activity");
  await expect(
    page.getByRole("button", { name: "Approve action" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await page.screenshot({
    animations: "disabled",
    path: path.resolve("../../docs/evidence/activity-approval-pending.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Approve action" }).click();
  await expect(
    page.getByRole("button", { name: "Approve action" }),
  ).toHaveCount(0);
  await page.goto("/tasks");
  await page.getByRole("button", { name: /All tasks/ }).click();
  await expect(
    page.getByText("Prepare a thoughtful day", { exact: true }),
  ).toHaveCount(0);

  await page.goto("/memory");
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page
    .getByLabel("What’s worth remembering?")
    .fill("I prefer a calm morning with one clear priority.");
  await page.getByLabel("Memory topic").fill("focus-hours");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add memory", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm memory" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm memory" }).click();
  await expect(page.locator(".memory-card .badge")).toHaveText("confirmed");
  const memorySearchResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/memories?") &&
      new URL(response.url()).searchParams.get("q") === "calm",
  );
  await page.getByLabel("Search memories", { exact: true }).fill("calm");
  expect((await memorySearchResponse).ok()).toBeTruthy();
  await expect(page.locator(".memory-card")).toContainText(
    "one clear priority",
  );
  await page.getByLabel("Search memories", { exact: true }).fill("");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await page.screenshot({
    animations: "disabled",
    path: path.resolve("../../docs/evidence/memory.png"),
    fullPage: true,
  });

  // A conflicting topic stays pending until the user explicitly chooses the earlier fact to replace.
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page
    .getByLabel("What’s worth remembering?")
    .fill("I now prefer focused work in the afternoon.");
  await page.getByLabel("Memory topic").fill("focus-hours");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add memory", exact: true })
    .click();
  const replacementCard = page
    .locator(".memory-card")
    .filter({ hasText: "I now prefer focused work in the afternoon." });
  const conflictResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.startsWith("/api/memories/") &&
      response.status() === 409,
  );
  await replacementCard.getByRole("button", { name: "Confirm memory" }).click();
  expect((await conflictResponse).status()).toBe(409);
  await expect(page.locator('main [role="alert"]')).toContainText(
    "Confirm which existing fact this replaces",
  );
  const topicResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/memories?") &&
      new URL(response.url()).searchParams.get("topic") === "focus-hours",
  );
  await replacementCard
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  expect((await topicResponse).ok()).toBeTruthy();
  await page
    .getByRole("group", { name: "Replace conflicting facts" })
    .getByRole("checkbox", { name: /I prefer a calm morning/ })
    .check();
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    animations: "disabled",
    path: path.resolve("../../docs/evidence/memory-conflict-review.png"),
    fullPage: true,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes" })
    .click();
  await replacementCard.getByRole("button", { name: "Confirm memory" }).click();
  await expect(replacementCard.locator(".badge")).toHaveText("confirmed");
  const memoryFacts = (await (
    await page.request.get("/api/memories?limit=200")
  ).json()) as {
    content: string;
    status: string;
    source: string;
    extra: { supersedes?: string[] };
  }[];
  expect(
    memoryFacts.find(
      (fact) =>
        fact.content === "I prefer a calm morning with one clear priority.",
    )?.status,
  ).toBe("superseded");
  const correctedFact = memoryFacts.find(
    (fact) => fact.content === "I now prefer focused work in the afternoon.",
  );
  expect(correctedFact?.status).toBe("confirmed");
  expect(correctedFact?.source).toBe("Added manually by user");
  expect(correctedFact?.extra.supersedes).toHaveLength(1);
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    animations: "disabled",
    path: path.resolve("../../docs/evidence/memory-conflict-resolved.png"),
    fullPage: true,
  });

  await page.goto("/calendar");
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Room for focused work");
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await page.getByLabel("Starts").fill(`${localDate}T16:00`);
  await page.getByLabel("Ends").fill(`${localDate}T17:00`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add event", exact: true })
    .click();
  await expect(page.locator(".event-card h3")).toHaveText(
    "Room for focused work",
  );
  await page.goto("/automations");
  await page.getByRole("button", { name: "Create automation" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Morning perspective");
  await page.getByLabel("Routine type").selectOption("briefing");
  await page
    .getByLabel("Routine note")
    .fill("Prepare a concise briefing of my real tasks and calendar.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add automation", exact: true })
    .click();
  await expect(
    page.getByText("Morning perspective", { exact: true }),
  ).toBeVisible();
  const savedAutomations = (await (
    await page.request.get("/api/automations")
  ).json()) as { title: string; extra: { kind?: string } }[];
  expect(
    savedAutomations.find((item) => item.title === "Morning perspective")?.extra
      .kind,
  ).toBe("briefing");
  await page.getByRole("button", { name: "Pause automation" }).click();
  await expect(
    page.getByRole("button", { name: "Resume automation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume automation" }).click();
  await expect(
    page.getByRole("button", { name: "Pause automation" }),
  ).toBeVisible();

  for (const route of [
    "calendar",
    "automations",
    "integrations",
    "activity",
    "settings",
    "chat",
    "dashboard",
  ]) {
    await page.goto(`/${route}`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(
      "Request failed (404)",
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toHaveCSS("opacity", "1");
    await page.screenshot({
      animations: "disabled",
      path: path.resolve(`../../docs/evidence/${route}.png`),
      fullPage: true,
    });
  }
  await page.goto("/settings");
  const settingsBeforePreset = await (
    await page.request.get("/api/settings")
  ).json();
  await expect(
    page.getByLabel("Embedding model ID", { exact: true }),
  ).toHaveValue("qwen3.7-text-embedding-flash");
  await expect(page.getByLabel("Vector dimensions")).toHaveValue("1024");
  await expect(page.locator('input[name="embedding_api_key"]')).toHaveAttribute(
    "type",
    "password",
  );
  const missingEmbedding = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/settings/embedding/test") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Test saved embedding connection" })
    .click();
  expect((await missingEmbedding).status()).toBe(503);
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Beijing workspace Base URL",
  );
  await page.getByRole("button", { name: /DeepSeek/ }).click();
  await expect(page.getByLabel("Model ID", { exact: true })).toHaveValue(
    "deepseek-flash",
  );
  await expect(page.getByLabel("Provider base URL")).toHaveValue(
    "https://api.deepseek.com",
  );
  await expect(page.getByLabel("Fast routing model")).toHaveValue(
    "deepseek-flash",
  );
  await expect(page.getByLabel("Reasoning routing model")).toHaveValue(
    "deepseek-v4-pro",
  );
  const settingsAfterPreset = await (
    await page.request.get("/api/settings")
  ).json();
  expect(settingsAfterPreset.model).toBe(settingsBeforePreset.model);
  expect(settingsAfterPreset.fast_model).toBe(settingsBeforePreset.fast_model);
  expect(settingsAfterPreset.reasoning_model).toBe(
    settingsBeforePreset.reasoning_model,
  );
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await page.screenshot({
    animations: "disabled",
    path: path.resolve("../../docs/evidence/settings-deepseek.png"),
    fullPage: true,
  });
  // No credentials are supplied: this validates the real unconfigured boundary, not a mocked model response.
  await page.goto("/chat");
  await page
    .getByLabel("Message your assistant")
    .fill("Help me plan a calm day.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator('main [role="alert"]')).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await page.screenshot({
    animations: "disabled",
    path: path.resolve("../../docs/evidence/chat-model-unconfigured.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await page.screenshot({
    animations: "disabled",
    path: path.resolve("../../docs/evidence/dashboard-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await page.screenshot({
    animations: "disabled",
    path: path.resolve("../../docs/evidence/dashboard-mobile.png"),
    fullPage: true,
  });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
