import { CapacitorHttp } from "@capacitor/core";
import { Native } from "./repository.js";
import { isNative } from "../lib/native.js";
const API = (import.meta.env.VITE_BILLING_API || "").replace(/\/$/, "");
export const billingConfigured = !!API;
async function request(path, method = "GET", body) {
  if(API && !API.startsWith("https://")) throw new Error("Для оплаты требуется защищённый HTTPS-сервер");
  if (!API)
    throw new Error(
      "Оплата пока не подключена. Требуется настроить российский эквайринг и сервер.",
    );
  let auth = isNative()
    ? (await Native.getBillingCredential()).token
    : localStorage.getItem("raminde.billing");
  if (!auth) {
    const b = await raw(
      "/api/session",
      "POST",
      { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      null,
    );
    auth = b.token;
    if (isNative()) await Native.setBillingCredential({ token: auth });
    else localStorage.setItem("raminde.billing", auth);
  }
  return raw(path, method, body, auth);
}
async function raw(path, method, body, auth) {
  const headers = {
    "Content-Type": "application/json",
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
  };
  let status, data;
  if (isNative()) {
    const r = await CapacitorHttp.request({
      url: API + path,
      method,
      headers,
      data: body,
      connectTimeout: 15000,
      readTimeout: 15000,
    });
    status = r.status;
    data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  } else {
    const r = await fetch(API + path, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    status = r.status;
    data = await r.json();
  }
  if (status >= 400) throw new Error(data.error || "Ошибка платёжного сервера");
  return data;
}
export const billingStatus = () => request("/api/status");
export const reserveQuota = (id) =>
  request("/api/quota/reserve", "POST", { id });
export const commitQuota = (token) =>
  request("/api/quota/commit", "POST", { token });
export const releaseQuota = (token) =>
  request("/api/quota/release", "POST", { token });
export async function checkout(plan, email) {
  const r = await request("/api/checkout", "POST", { plan, email });
  if (!r.url?.startsWith("https://"))
    throw new Error("Некорректная платёжная ссылка");
  if (isNative()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: r.url });
  } else window.open(r.url, "_blank", "noopener,noreferrer");
  return r;
}

export async function recoveryKey() {
  return isNative()
    ? (await Native.getBillingCredential()).token
    : localStorage.getItem("raminde.billing");
}
export async function restoreKey(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("Неверный формат ключа восстановления");
  await raw("/api/status", "GET", undefined, token);
  if (isNative()) await Native.setBillingCredential({ token });
  else localStorage.setItem("raminde.billing", token);
  return billingStatus();
}
