import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
if (existsSync(".env")) process.loadEnvFile(path.join(root, ".env"));
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const mode = option("--mode", "local");
if (!["local", "lan", "app"].includes(mode))
  throw new Error("Режим: local, lan или app");
const runtime = existsSync(".orbit-runtime.json")
  ? JSON.parse(readFileSync(".orbit-runtime.json", "utf8"))
  : {};
const port = Number(option("--port", process.env.PORT || runtime.port || 3000));
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Укажите порт от 1 до 65535: --port 3000");
const host = mode === "lan" ? "0.0.0.0" : "127.0.0.1";
const url = `http://localhost:${port}`;
function command(file, argv, options = {}) {
  return spawn(file, argv, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
}
function npm(argv, options = {}) {
  // Arguments are fixed by this script, never interpolated from user input.
  return process.platform === "win32"
    ? command(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/c", "npm", ...argv],
        options,
      )
    : command("npm", argv, options);
}
async function successful(child) {
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Команда завершилась с кодом ${code}. Проверьте сообщения выше.`,
            ),
          ),
    );
  });
}
async function available() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () =>
      reject(
        new Error(
          `Порт ${port} занят. Остановите прежний Orbit или запустите с --port ${port + 1}.`,
        ),
      ),
    );
    probe.listen(port, host, () => probe.close(resolve));
  });
}
function openWindow() {
  if (args.includes("--no-open")) return;
  if (process.platform === "win32") {
    const candidates = [
      process.env["ProgramFiles(x86)"],
      process.env.ProgramFiles,
      process.env.LOCALAPPDATA,
    ]
      .filter(Boolean)
      .flatMap((base) => [
        path.join(base, "Microsoft/Edge/Application/msedge.exe"),
        path.join(base, "Google/Chrome/Application/chrome.exe"),
      ]);
    const browser = candidates.find(existsSync);
    if (mode === "app" && browser) {
      command(browser, [`--app=${url}`], {
        stdio: "ignore",
        detached: true,
        windowsHide: false,
      }).unref();
      return;
    }
    if (mode === "app")
      console.log(
        "Edge/Chrome не найдены. Открываем Orbit в браузере по умолчанию.",
      );
    // URL contains only a validated numeric port and our fixed localhost origin.
    command(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", url], {
      stdio: "ignore",
      detached: true,
    }).unref();
  } else {
    if (mode === "app")
      console.log(
        "На этой системе открывается обычный браузер; нативная оболочка Rust запланирована отдельно.",
      );
    const opener = command(
      process.platform === "darwin" ? "open" : "xdg-open",
      [url],
      { stdio: "ignore", detached: true },
    );
    opener.on("error", () => console.log(`Откройте ${url} вручную.`));
    opener.unref();
  }
}
let server;
try {
  await available();
  if (!existsSync("node_modules/tsx")) {
    console.log(
      "Устанавливаем зависимости из npm. Нужны Node.js 22.12+ и интернет.",
    );
    await successful(npm(["ci", "--include=dev", "--no-audit", "--no-fund"]));
  }
  // Build every launch so edits to source can never leave a stale interface.
  console.log("Проверяем и собираем Orbit…");
  await successful(
    npm(["run", "build"], { env: { ...process.env, NODE_ENV: "production" } }),
  );
  server = command(
    process.execPath,
    ["--import", "tsx", "apps/server/src/index.ts"],
    { env: { ...process.env, HOST: host, PORT: String(port) } },
  );
  let exited = false;
  server.once("error", (e) => {
    exited = true;
    console.error(e.message);
  });
  server.once("exit", (code) => {
    exited = true;
    process.exitCode = code || 0;
  });
  let ready = false;
  for (let i = 0; i < 100 && !exited; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("Сервер не запустился. Смотрите ошибку выше.");
  console.log(
    `\nOrbit: ${url}\nДанные: ${path.resolve(process.env.DATA_DIR || runtime.dataDir || "storage")}\nДля остановки нажмите Ctrl+C в этом окне.`,
  );
  if (mode === "lan") {
    console.log("Адреса для устройств в вашей локальной сети:");
    for (const nic of Object.values(os.networkInterfaces()).flat())
      if (nic?.family === "IPv4" && !nic.internal)
        console.log(`  http://${nic.address}:${port}`);
    console.log(
      "Если Windows спросит о доступе, выберите частную сеть. Брандмауэр автоматически не изменяется.",
    );
  }
  if (args.includes("--check")) {
    console.log("Startup check passed. Stopping the check server.");
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await stopped;
  } else openWindow();
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server?.kill("SIGTERM");
    });
} catch (error) {
  console.error(`\nНе удалось запустить Orbit: ${error.message}`);
  server?.kill("SIGTERM");
  process.exitCode = 1;
}
