import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9222;

const seedPassword = process.env.DEMO_SEED_PASSWORD;
if (!seedPassword || typeof seedPassword !== "string" || seedPassword.trim().length === 0) {
  console.error("[CaptureScreenshots] Error: DEMO_SEED_PASSWORD environment variable is required; hardcoded credentials prohibited.");
  process.exit(1);
}

async function loginAccount(email, password) {
  const res = await fetch("http://127.0.0.1:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${email}: HTTP ${res.status}`);
  }
  const body = await res.json();
  return body.data.token;
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function run() {
  const tokens = {
    admin: await loginAccount("admin@reconai-test.local", seedPassword),
    shopA: await loginAccount("shop-a@reconai-test.local", seedPassword),
    shopB: await loginAccount("shop-b@reconai-test.local", seedPassword),
    auditorA: await loginAccount("auditor-a@reconai-test.local", seedPassword),
    customerA: await loginAccount("customer-a@reconai-test.local", seedPassword)
  };
  const tmpProfile = path.resolve("C:\\Users\\pc\\AppData\\Local\\Temp\\chrome-reconai-profile");
  if (!fs.existsSync(tmpProfile)) {
    fs.mkdirSync(tmpProfile, { recursive: true });
  }

  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${tmpProfile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1280,900"
  ]);

  await sleep(1500);

  try {
    const versionRes = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    const versionData = await versionRes.json();
    const wsUrl = versionData.webSocketDebuggerUrl;
    console.log("Connected to Chrome:", wsUrl);

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.addEventListener("open", resolve));

    let msgId = 1;
    const callbacks = new Map();

    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id && callbacks.has(data.id)) {
        const { resolve, reject } = callbacks.get(data.id);
        callbacks.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    });

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        callbacks.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    // Create target page
    const target = await send("Target.createTarget", { url: "http://localhost:5173/cases" });
    const pageWsUrl = `ws://127.0.0.1:${PORT}/devtools/page/${target.targetId}`;
    const pageWs = new WebSocket(pageWsUrl);
    await new Promise((resolve) => pageWs.addEventListener("open", resolve));

    let pageMsgId = 1;
    const pageCallbacks = new Map();
    const networkRequests = [];

    pageWs.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.method === "Network.requestWillBeSent") {
        networkRequests.push({
          url: data.params.request.url,
          method: data.params.request.method
        });
      }
      if (data.id && pageCallbacks.has(data.id)) {
        const { resolve, reject } = pageCallbacks.get(data.id);
        pageCallbacks.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    });

    function pageSend(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = pageMsgId++;
        pageCallbacks.set(id, { resolve, reject });
        pageWs.send(JSON.stringify({ id, method, params }));
      });
    }

    await pageSend("Page.enable");
    await pageSend("Network.enable");

    async function setRoleToken(token) {
      await pageSend("Runtime.evaluate", {
        expression: `localStorage.setItem('reconai_token', '${token}')`
      });
    }

    async function navigateAndScreenshot(url, token, filename, waitMs = 1500) {
      if (token) {
        await setRoleToken(token);
      }
      await pageSend("Page.navigate", { url });
      await sleep(waitMs);
      const res = await pageSend("Page.captureScreenshot", { format: "png" });
      const buffer = Buffer.from(res.data, "base64");
      fs.writeFileSync(`evidence/stage6/${filename}`, buffer);
      console.log(`Saved screenshot: evidence/stage6/${filename} (${buffer.length} bytes)`);
    }

    console.log("Capturing screenshot 01: Admin cases view...");
    await navigateAndScreenshot("http://localhost:5173/cases", tokens.admin, "screenshot-01-admin-cases.png", 2000);

    console.log("Capturing screenshot 07: Case 22 detail view...");
    await navigateAndScreenshot("http://localhost:5173/cases/CASE-DEMO-22", tokens.admin, "screenshot-07-case-22-detail.png", 2000);

    console.log("Capturing screenshot 08: Hostile text detail view...");
    await navigateAndScreenshot("http://localhost:5173/cases/CASE-DEMO-HOSTILE", tokens.admin, "screenshot-08-hostile-text-detail.png", 2000);

    console.log("Capturing screenshot 09: Safe-hold queue view...");
    await navigateAndScreenshot("http://localhost:5173/cases?safeHold=true", tokens.admin, "screenshot-09-safe-hold-queue.png", 2000);

    console.log("Capturing screenshot 02: Shop A cases view...");
    await navigateAndScreenshot("http://localhost:5173/cases", tokens.shopA, "screenshot-02-shop-a-cases.png", 2000);

    console.log("Capturing screenshot 06: Shop A cross-tenant 404 view...");
    await navigateAndScreenshot("http://localhost:5173/cases/CASE-DEMO-TENANT-B", tokens.shopA, "screenshot-06-shop-a-cross-tenant-404.png", 2000);

    console.log("Capturing screenshot 03: Shop B cases view...");
    await navigateAndScreenshot("http://localhost:5173/cases", tokens.shopB, "screenshot-03-shop-b-cases.png", 2000);

    console.log("Capturing screenshot 04: Auditor A cases view...");
    await navigateAndScreenshot("http://localhost:5173/cases", tokens.auditorA, "screenshot-04-auditor-a-cases.png", 2000);

    console.log("Capturing screenshot 05: Customer blocked view...");
    await navigateAndScreenshot("http://localhost:5173/cases", tokens.customerA, "screenshot-05-customer-blocked.png", 2000);

    // Verify network requests: confirm zero non-GET requests from the workspace
    const apiRequests = networkRequests.filter((r) => r.url.includes("/api/"));
    const nonGetRequests = apiRequests.filter((r) => r.method !== "GET");
    console.log(`Total API requests captured: ${apiRequests.length}`);
    console.log(`Non-GET requests count: ${nonGetRequests.length}`);
    if (nonGetRequests.length > 0) {
      console.warn("WARNING: Non-GET requests detected:", nonGetRequests);
    } else {
      console.log("VERIFIED: Zero non-GET requests from the operator workspace.");
    }

    fs.writeFileSync(
      "evidence/stage6/10-browser-network-log.json",
      JSON.stringify({ totalApiRequests: apiRequests.length, nonGetCount: nonGetRequests.length, requests: apiRequests }, null, 2)
    );

    pageWs.close();
    ws.close();
  } finally {
    chromeProc.kill("SIGKILL");
  }
}

run().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
