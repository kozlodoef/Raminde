import http from "node:http";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
export function addMonths(timestamp, months) {
  const d = new Date(timestamp),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(
    Math.min(
      day,
      new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return d.getTime();
}
export function createBilling({
  filename = "billing.sqlite",
  env = process.env,
  providerFetch = fetch,
  now = Date.now,
} = {}) {
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,tokenHash TEXT UNIQUE,expires INTEGER DEFAULT 0,month TEXT,timezone TEXT,used INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS reservations(token TEXT PRIMARY KEY,uid TEXT,rid TEXT,month TEXT,state TEXT,created INTEGER,UNIQUE(uid,rid),FOREIGN KEY(uid) REFERENCES users(id)); CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,uid TEXT,plan TEXT,amount TEXT,payment TEXT UNIQUE,state TEXT,previousExpiry INTEGER,paidAt INTEGER,FOREIGN KEY(uid) REFERENCES users(id));",
  );
  const month = (tz) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
    }).format(new Date(now()));
  const prices = {
    monthly: env.MONTHLY_RUB || null,
    yearly: env.YEARLY_RUB || null,
  };
  const configured = !!(
    env.YOOKASSA_SHOP_ID &&
    env.YOOKASSA_SECRET &&
    env.RETURN_URL?.startsWith("https://") &&
    prices.monthly &&
    prices.yearly
  );
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  function user(token) {
    if (!token || token.length > 256)
      throw fail(401, "Требуется восстановить доступ");
    const u = db
      .prepare("SELECT * FROM users WHERE tokenHash=?")
      .get(hash(token));
    if (!u) throw fail(401, "Неверный ключ восстановления");
    const current = month(u.timezone);
    if (current !== u.month) {
      db.prepare("UPDATE users SET month=?,used=0 WHERE id=?").run(
        current,
        u.id,
      );
      u.month = current;
      u.used = 0;
    }
    return u;
  }
  async function provider(path, method = "GET", body, key) {
    if (!configured) throw fail(503, "Российский эквайринг не настроен");
    const r = await providerFetch("https://api.yookassa.ru/v3/" + path, {
      method,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            env.YOOKASSA_SHOP_ID + ":" + env.YOOKASSA_SECRET,
          ).toString("base64"),
        "Content-Type": "application/json",
        ...(key ? { "Idempotence-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw fail(502, "Платёжный провайдер временно недоступен");
    return r.json();
  }
  async function verify(payment) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(payment || ""))
      throw fail(400, "Некорректный платеж");
    const invoice = db
      .prepare("SELECT * FROM invoices WHERE payment=?")
      .get(payment);
    if (!invoice) return;
    const verified = await provider("payments/" + payment);
    if (
      verified.id !== payment ||
      verified.status !== "succeeded" ||
      verified.paid !== true ||
      verified.amount?.value !== invoice.amount ||
      verified.amount?.currency !== "RUB" ||
      verified.metadata?.invoice !== invoice.id
    )
      return;
    transaction(() => {
      const row = db
        .prepare("SELECT * FROM invoices WHERE id=?")
        .get(invoice.id);
      if (row.state === "paid" || row.state === "refunded") return;
      const u = db.prepare("SELECT * FROM users WHERE id=?").get(row.uid);
      const expiry = addMonths(
        Math.max(now(), u.expires || 0),
        row.plan === "yearly" ? 12 : 1,
      );
      db.prepare("UPDATE users SET expires=? WHERE id=?").run(expiry, u.id);
      db.prepare(
        "UPDATE invoices SET state='paid',previousExpiry=?,paidAt=? WHERE id=?",
      ).run(u.expires || 0, now(), row.id);
    });
  }
  async function route(path, method, body = {}, token) {
    if (path === "/health") return { ok: true };
    if (path === "/api/session" && method === "POST") {
      let tz = body.timezone || "Europe/Moscow";
      try {
        month(tz);
      } catch {
        throw fail(400, "Неверный часовой пояс");
      }
      const id = crypto.randomUUID(),
        auth = crypto.randomBytes(32).toString("base64url");
      db.prepare(
        "INSERT INTO users(id,tokenHash,month,timezone) VALUES(?,?,?,?)",
      ).run(id, hash(auth), month(tz), tz);
      return { token: auth };
    }
    if (path === "/api/webhook" && method === "POST") {
      // Webhook body is untrusted. Independently verify using the merchant API.
      if (body.event === "payment.succeeded") await verify(body.object?.id);
      else if (body.event === "refund.succeeded") {
        const id = body.object?.id;
        if (!/^[a-zA-Z0-9-]{1,80}$/.test(id || ""))
          throw fail(400, "Некорректный возврат");
        const refund = await provider("refunds/" + id);
        if (refund.status === "succeeded") {
          const inv = db
            .prepare("SELECT * FROM invoices WHERE payment=?")
            .get(refund.payment_id);
          if (
            inv &&
            inv.state === "paid" &&
            refund.amount?.value === inv.amount &&
            refund.amount?.currency === "RUB"
          ) {
            transaction(() => {
              db.prepare("UPDATE invoices SET state='refunded' WHERE id=?").run(
                inv.id,
              );
              let expiry = 0;
              const paid = db
                .prepare(
                  "SELECT plan,paidAt FROM invoices WHERE uid=? AND state='paid' ORDER BY paidAt,id",
                )
                .all(inv.uid);
              for (const item of paid)
                expiry = addMonths(
                  Math.max(item.paidAt, expiry),
                  item.plan === "yearly" ? 12 : 1,
                );
              db.prepare("UPDATE users SET expires=? WHERE id=?").run(
                expiry,
                inv.uid,
              );
            });
          }
        }
      }
      return { ok: true };
    }
    const u = user(token);
    if (path === "/api/status") {
      const pending = db
        .prepare(
          "SELECT payment FROM invoices WHERE uid=? AND state='pending' AND payment IS NOT NULL",
        )
        .all(u.id);
      for (const i of pending.slice(-5)) await verify(i.payment);
      const updated = user(token);
      return {
        premium: updated.expires > now(),
        expires: updated.expires,
        used: updated.used,
        month: updated.month,
        prices,
        configured,
        autoRenew: false,
      };
    }
    if (path === "/api/quota/reserve" && method === "POST") {
      if (typeof body.id !== "string" || body.id.length > 100 || !body.id)
        throw fail(400, "Неверный идентификатор");
      return transaction(() => {
        const previous = db
          .prepare("SELECT * FROM reservations WHERE uid=? AND rid=?")
          .get(u.id, body.id);
        if (previous?.state === "committed") return { token: previous.token };
        if (
          previous?.state === "reserved" &&
          previous.created > now() - 3600000
        )
          return { token: previous.token };
        db.prepare(
          "DELETE FROM reservations WHERE state='reserved' AND created<?",
        ).run(now() - 3600000);
        const reserved = db
          .prepare(
            "SELECT COUNT(*) AS n FROM reservations WHERE uid=? AND month=? AND state='reserved'",
          )
          .get(u.id, u.month).n;
        if (u.expires <= now() && u.used + reserved >= 10)
          throw fail(402, "QUOTA");
        const key = crypto.randomUUID();
        if (previous)
          db.prepare("DELETE FROM reservations WHERE token=?").run(
            previous.token,
          );
        db.prepare("INSERT INTO reservations VALUES(?,?,?,?,'reserved',?)").run(
          key,
          u.id,
          body.id,
          u.month,
          now(),
        );
        return { token: key };
      });
    }
    if (path === "/api/quota/commit" && method === "POST")
      return transaction(() => {
        const r = db
          .prepare("SELECT * FROM reservations WHERE token=? AND uid=?")
          .get(body.token, u.id);
        if (!r) throw fail(404, "Резерв не найден");
        if (r.state === "reserved") {
          db.prepare(
            "UPDATE reservations SET state='committed' WHERE token=?",
          ).run(r.token);
          if (r.month === u.month)
            db.prepare("UPDATE users SET used=used+1 WHERE id=?").run(u.id);
        }
        return { ok: true };
      });
    if (path === "/api/quota/release" && method === "POST") {
      db.prepare(
        "DELETE FROM reservations WHERE token=? AND uid=? AND state='reserved'",
      ).run(body.token, u.id);
      return { ok: true };
    }
    if (path === "/api/checkout" && method === "POST") {
      if (!["monthly", "yearly"].includes(body.plan))
        throw fail(400, "Неверный тариф");
      if (!configured) throw fail(503, "Эквайринг ещё не подключён");
      const amount = Number(prices[body.plan]);
      if (!Number.isFinite(amount) || amount <= 0)
        throw fail(503, "Не настроена цена");
      const id = crypto.randomUUID(),
        value = amount.toFixed(2);
      db.prepare(
        "INSERT INTO invoices(id,uid,plan,amount,state) VALUES(?,?,?,?,'pending')",
      ).run(id, u.id, body.plan, value);
      const request = {
        amount: { value, currency: "RUB" },
        capture: true,
        description:
          "Remind me: доступ на " + (body.plan === "yearly" ? "год" : "месяц"),
        confirmation: { type: "redirect", return_url: env.RETURN_URL },
        metadata: { invoice: id },
      };
      if (env.RECEIPTS === "true") {
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email || "") ||
          !env.VAT_CODE
        )
          throw fail(400, "Для чека требуется email и настройка налогов");
        request.receipt = {
          customer: { email: body.email },
          items: [
            {
              description: request.description,
              quantity: "1.00",
              amount: request.amount,
              vat_code: Number(env.VAT_CODE),
              payment_mode: "full_payment",
              payment_subject: "service",
            },
          ],
          ...(env.TAX_SYSTEM_CODE
            ? { tax_system_code: Number(env.TAX_SYSTEM_CODE) }
            : {}),
        };
      }
      const p = await provider("payments", "POST", request, id);
      if (
        typeof p.id !== "string" ||
        !p.confirmation?.confirmation_url?.startsWith("https://")
      )
        throw fail(502, "Провайдер не вернул платёжную страницу");
      db.prepare("UPDATE invoices SET payment=? WHERE id=?").run(p.id, id);
      return { url: p.confirmation.confirmation_url, id };
    }
    throw fail(404, "Не найдено");
  }
  const origins = (
    env.ALLOWED_ORIGINS || "https://localhost,http://localhost:5173"
  ).split(",");
  const rates = new Map();
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const ip = req.socket.remoteAddress || "",
      stamp = Math.floor(now() / 60000),
      key = ip + stamp;
    rates.set(key, (rates.get(key) || 0) + 1);
    if (rates.size > 10000) rates.clear();
    if (rates.get(key) > 120) {
      res.writeHead(429);
      res.end();
      return;
    }
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(origin
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {}),
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    try {
      let text = "";
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 16000) throw fail(413, "Слишком большой запрос");
      }
      const body = text ? JSON.parse(text) : {},
        path = new URL(req.url, "http://local").pathname,
        result = await route(
          path,
          req.method,
          body,
          req.headers.authorization?.replace(/^Bearer /, ""),
        );
      res.writeHead(200, headers);
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(e.status || 500, headers);
      res.end(
        JSON.stringify({ error: e.status ? e.message : "Ошибка сервера" }),
      );
    }
  });
  return {
    server,
    db,
    route,
    close: () => {
      server.close();
      db.close();
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createBilling();
  app.server.listen(Number(process.env.PORT || 8080), "127.0.0.1", () =>
    console.log("Billing server listening on loopback"),
  );
}
