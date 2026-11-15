import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd();
const stage = path.resolve("build/desktop");
fs.mkdirSync(stage, { recursive: true });
const copy = (from, to) => {
  if (!fs.existsSync(from)) throw new Error(`Missing build input: ${from}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
};
copy("desktop/target/release/Orbit.exe", path.join(stage, "Orbit.exe"));
copy("build/server", path.join(stage, "app/server"));
copy(
  "apps/server/src/database/001_initial.sql",
  path.join(stage, "app/server/apps/server/src/database/001_initial.sql"),
);
copy("dist/web", path.join(stage, "app/dist/web"));
copy(process.execPath, path.join(stage, "runtime/node.exe"));
for (const file of [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "ABOUT.md",
])
  copy(file, path.join(stage, file));
copy("licenses", path.join(stage, "licenses"));
fs.writeFileSync(
  path.join(stage, "app/package.json"),
  JSON.stringify({
    name: "orbit-runtime",
    version: "3.0.0",
    type: "module",
    private: true,
    license: "MIT",
  }),
);
const output = execFileSync(
  process.env.ComSpec || "cmd.exe",
  ["/d", "/c", "npm ls --omit=dev --all --parseable"],
  { encoding: "utf8", windowsHide: true },
);
const modules = output
  .trim()
  .split(/\r?\n/)
  .filter((p) => p !== root);
for (const module of modules) {
  const relative = path.relative(root, module);
  if (
    !relative.startsWith("node_modules" + path.sep) ||
    relative.includes("..")
  )
    throw new Error("Dependency outside workspace");
  copy(module, path.join(stage, "app", relative));
}
console.log(`Staged Orbit with ${modules.length} production dependencies.`);
