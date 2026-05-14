import { runCliEntry } from "./main.tsx";

process.exitCode = await runCliEntry(process.argv.slice(2));
