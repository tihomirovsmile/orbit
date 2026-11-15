import { sqlite } from "./index.js";
console.log(
  `Database migrated, version ${sqlite.pragma("user_version", { simple: true })}`,
);
sqlite.close();
