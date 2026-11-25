// Режимы напоминания: в списке осталось два.
//
// Режим «только голосом» убран из настроек. Причина: без уведомления
// напоминание легко пропустить — озвучка не оставляет следа в шторке, а
// если телефон в беззвучном режиме, человек не узнает о нём вовсе.
//
// У тех, кто успел выбрать «голосом», в настройках сохранено voice.
// Показывать им первый пункт списка и работать по-старому нельзя: человек
// видел бы «Голосом и уведомлением», а уведомление не приходило бы.
// Поэтому значение переводится при чтении настроек.
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSettings, defaults } from "../src/domain/repository.js";

test("сохранённый режим «голосом» переводится в «голосом и уведомлением»", () => {
  const s = normalizeSettings({ ...defaults, mode: "voice" });
  assert.equal(s.mode, "voiceAndNotification");
});

test("остальные режимы не трогаются", () => {
  for (const mode of ["voiceAndNotification", "notification"]) {
    const s = normalizeSettings({ ...defaults, mode });
    assert.equal(s.mode, mode, "режим изменён без нужды: " + mode);
  }
});

test("пустые настройки получают режим по умолчанию", () => {
  for (const input of [undefined, null, {}]) {
    const s = normalizeSettings(input);
    assert.equal(s.mode, "voiceAndNotification");
  }
});

test("негодное значение режима не остаётся в настройках", () => {
  // Мусор в хранилище (старая версия, ручная правка) не должен давать
  // пустой список в интерфейсе: показываем режим по умолчанию.
  const s = normalizeSettings({ ...defaults, mode: "speech" });
  assert.equal(s.mode, "voiceAndNotification");
});

test("остальные настройки при переводе режима не теряются", () => {
  const s = normalizeSettings({
    ...defaults,
    mode: "voice",
    name: "Анна",
    repeat: true,
    repeatMinutes: 15,
  });
  assert.equal(s.name, "Анна");
  assert.equal(s.repeat, true);
  assert.equal(s.repeatMinutes, 15);
  assert.equal(s.mode, "voiceAndNotification");
});

test("в списке режимов ровно два значения", () => {
  // Страховка от возврата третьего пункта в разметку.
  const source = [];
  return import("node:fs/promises").then(async (fs) => {
    const app = await fs.readFile(
      new URL("../src/App.jsx", import.meta.url),
      "utf8",
    );
    const modes = [...app.matchAll(/<option value="(voiceAndNotification|notification|voice)"/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(modes, ["voiceAndNotification", "notification"]);
    // И самого слова «Голосом» как отдельного пункта быть не должно.
    assert.ok(
      !/<option value="voice">/.test(app),
      "пункт «Голосом» вернулся в список",
    );
    return source;
  });
});