import test from "node:test";
import assert from "node:assert/strict";
import { createBilling, addMonths } from "./server.mjs";
function fixture() {
  let time = Date.parse("2026-10-07T12:00:00Z");
  const app = createBilling({ filename: ":memory:", env: {}, now: () => time });
  return {
    ...app,
    setTime: (t) => {
      time = Date.parse(t);
    },
  };
}
test("ten reservations then quota", async () => {
  const a = fixture();
  try {
    const { token } = await a.route("/api/session", "POST", {});
    for (let i = 0; i < 10; i++) {
      const r = await a.route(
        "/api/quota/reserve",
        "POST",
        { id: "r" + i },
        token,
      );
      await a.route("/api/quota/commit", "POST", { token: r.token }, token);
    }
    await assert.rejects(
      a.route("/api/quota/reserve", "POST", { id: "eleven" }, token),
      /QUOTA/,
    );
    assert.equal((await a.route("/api/status", "GET", {}, token)).used, 10);
  } finally {
    a.close();
  }
});
test("commit idempotency", async () => {
  const a = fixture();
  try {
    const { token } = await a.route("/api/session", "POST", {}),
      r = await a.route("/api/quota/reserve", "POST", { id: "one" }, token);
    await a.route("/api/quota/commit", "POST", { token: r.token }, token);
    await a.route("/api/quota/commit", "POST", { token: r.token }, token);
    assert.equal((await a.route("/api/status", "GET", {}, token)).used, 1);
  } finally {
    a.close();
  }
});
test("release failed creation", async () => {
  const a = fixture();
  try {
    const { token } = await a.route("/api/session", "POST", {}),
      r = await a.route("/api/quota/reserve", "POST", { id: "one" }, token);
    await a.route("/api/quota/release", "POST", { token: r.token }, token);
    assert.equal((await a.route("/api/status", "GET", {}, token)).used, 0);
  } finally {
    a.close();
  }
});
test("release cannot undo committed usage", async () => {
  const a = fixture();
  try {
    const { token } = await a.route("/api/session", "POST", {}),
      r = await a.route("/api/quota/reserve", "POST", { id: "one" }, token);
    await a.route("/api/quota/commit", "POST", { token: r.token }, token);
    await a.route("/api/quota/release", "POST", { token: r.token }, token);
    assert.equal((await a.route("/api/status", "GET", {}, token)).used, 1);
  } finally {
    a.close();
  }
});
test("monthly reset", async () => {
  const a = fixture();
  try {
    const { token } = await a.route("/api/session", "POST", {}),
      r = await a.route("/api/quota/reserve", "POST", { id: "one" }, token);
    await a.route("/api/quota/commit", "POST", { token: r.token }, token);
    a.setTime("2026-11-01T12:00:00Z");
    assert.equal((await a.route("/api/status", "GET", {}, token)).used, 0);
  } finally {
    a.close();
  }
});
test("unknown identity cannot change quota", async () => {
  const a = fixture();
  try {
    await assert.rejects(
      a.route("/api/status", "GET", {}, "invalid"),
      /Неверный/,
    );
  } finally {
    a.close();
  }
});
test("payment disabled without merchant credentials", async () => {
  const a = fixture();
  try {
    const { token } = await a.route("/api/session", "POST", {});
    await assert.rejects(
      a.route("/api/checkout", "POST", { plan: "monthly" }, token),
      /не подключён/,
    );
  } finally {
    a.close();
  }
});
test("month/year extension clamps invalid days", () => {
  assert.equal(
    new Date(addMonths(Date.parse("2027-01-31T12:00:00Z"), 1)).toISOString(),
    "2027-02-28T12:00:00.000Z",
  );
  assert.equal(
    new Date(addMonths(Date.parse("2028-02-29T12:00:00Z"), 12)).toISOString(),
    "2029-02-28T12:00:00.000Z",
  );
});
test("webhook body alone never grants entitlement", async () => {
  const a = fixture();
  try {
    const { token } = await a.route("/api/session", "POST", {});
    await a.route("/api/webhook", "POST", {
      event: "payment.succeeded",
      object: { id: "fake", paid: true, status: "succeeded" },
    });
    assert.equal(
      (await a.route("/api/status", "GET", {}, token)).premium,
      false,
    );
  } finally {
    a.close();
  }
});
test("verified paid transaction grants access once", async () => {
  let payment;
  const env = {
    YOOKASSA_SHOP_ID: "test",
    YOOKASSA_SECRET: "test",
    RETURN_URL: "https://example.test/return",
    MONTHLY_RUB: "199",
    YEARLY_RUB: "1490",
  };
  const providerFetch = async (url, options) => {
    if (options.method === "POST") {
      const b = JSON.parse(options.body);
      payment = {
        id: "verified-payment",
        status: "succeeded",
        paid: true,
        amount: b.amount,
        metadata: b.metadata,
      };
      return {
        ok: true,
        json: async () => ({
          id: payment.id,
          confirmation: {
            confirmation_url: "https://yoomoney.ru/test-checkout",
          },
        }),
      };
    }
    return { ok: true, json: async () => payment };
  };
  const a = createBilling({
    filename: ":memory:",
    env,
    now: () => Date.parse("2026-10-07T12:00:00Z"),
    providerFetch,
  });
  try {
    const { token } = await a.route("/api/session", "POST", {});
    await a.route("/api/checkout", "POST", { plan: "monthly" }, token);
    await a.route("/api/webhook", "POST", {
      event: "payment.succeeded",
      object: { id: "verified-payment" },
    });
    const first = await a.route("/api/status", "GET", {}, token);
    assert.equal(first.premium, true);
    await a.route("/api/webhook", "POST", {
      event: "payment.succeeded",
      object: { id: "verified-payment" },
    });
    assert.equal(
      (await a.route("/api/status", "GET", {}, token)).expires,
      first.expires,
    );
  } finally {
    a.close();
  }
});
