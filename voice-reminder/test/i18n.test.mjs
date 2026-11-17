import test from "node:test";
import assert from "node:assert/strict";
import { languageTag, localizeIssue, t } from "../src/domain/i18n.js";

test("interface copy switches between Russian and English", () => {
  assert.equal(languageTag("ru"), "ru-RU");
  assert.equal(languageTag("en"), "en-US");
  assert.equal(t("ru", "start"), "Начать");
  assert.equal(t("en", "start"), "Start");
  assert.equal(t("en", "greetingNamed", { name: "Alex" }), "Alex, what should I remind you?");
  assert.equal(t("en", "greetingPrompt"), "Hello! What should we call you?");
  assert.equal(localizeIssue("en", "Уточните время напоминания"), "Specify the reminder time");
  assert.equal(localizeIssue("ru", "Уточните время напоминания"), "Уточните время напоминания");
});

