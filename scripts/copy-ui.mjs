import { cp, mkdir } from "node:fs/promises";
await mkdir(new URL("../dist/ui/public/", import.meta.url), { recursive: true });
await cp(
  new URL("../src/ui/public/", import.meta.url),
  new URL("../dist/ui/public/", import.meta.url),
  { recursive: true },
);
