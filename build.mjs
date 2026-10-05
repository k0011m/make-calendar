import { cp, mkdir, rm } from "node:fs/promises";

const outputDirectory = new URL("./dist/", import.meta.url);

// 公開用ファイルだけを毎回作り直し、開発時のログや設定を配布物へ混ぜない。
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const fileName of ["index.html", "style.css", "app.js", "drops-catalog.js", "assets"]) {
  await cp(new URL(fileName, import.meta.url), new URL(fileName, outputDirectory), { recursive: true });
}
