import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previewPort = Number(process.env.TRAX_PREVIEW_PORT ?? 4174);
const debugPort = Number(process.env.TRAX_CHROME_DEBUG_PORT ?? 9224);
const origin = `http://127.0.0.1:${previewPort}`;
const chrome = process.env.CHROME_BIN ?? "google-chrome";
const profile = await mkdtemp(join(tmpdir(), "trax-pwa-"));
const children = [];

try {
  const preview = start(
    process.execPath,
    [
      "../../node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(previewPort),
    ],
    { cwd: new URL("..", import.meta.url) },
  );
  children.push(preview);
  await waitFor(`${origin}/`);

  const browser = start(chrome, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `${origin}/`,
  ]);
  children.push(browser);
  await waitFor(`http://127.0.0.1:${debugPort}/json`);

  const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(
    (response) => response.json(),
  );
  const target = targets.find((entry) => entry.type === "page");
  if (!target) throw new Error("Chrome did not expose a page target");
  const client = await cdp(target.webSocketDebuggerUrl);
  await client.command("Page.enable");
  await client.command("Network.enable");
  await waitForController(client);
  await client.command("Page.reload", { ignoreCache: false });
  await waitForController(client);
  await client.command("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await client.command("Page.navigate", {
    url: `${origin}/journeys/new`,
  });
  await sleep(2000);
  const evaluation = await client.command("Runtime.evaluate", {
    expression:
      "JSON.stringify({title: document.title, heading: document.querySelector('h1')?.textContent, controlled: Boolean(navigator.serviceWorker?.controller)})",
    returnByValue: true,
  });
  const result = JSON.parse(evaluation.result.value);
  client.close();
  if (
    result.title !== "Trax OS · Journeys" ||
    result.heading !== "Create a journey" ||
    result.controlled !== true
  ) {
    throw new Error(`Offline PWA assertion failed: ${JSON.stringify(result)}`);
  }
  console.log(
    `Offline PWA navigation passed: ${result.heading}, service worker controlled`,
  );
} finally {
  for (const child of children.reverse()) child.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true });
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    console.error(error);
  });
  return child;
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Process may still be starting.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForController(client) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const evaluation = await client.command("Runtime.evaluate", {
      expression: "Boolean(navigator.serviceWorker?.controller)",
      returnByValue: true,
    });
    if (evaluation.result.value === true) return;
    await sleep(250);
  }
  await client.command("Page.reload", { ignoreCache: false });
  await sleep(1000);
  const evaluation = await client.command("Runtime.evaluate", {
    expression: "Boolean(navigator.serviceWorker?.controller)",
    returnByValue: true,
  });
  if (evaluation.result.value !== true) {
    throw new Error("Service worker did not take control");
  }
}

async function cdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  return {
    command(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
