import configuration from "../.railway/railway.ts";

export const graph = configuration({});
if (process.argv[1]?.endsWith("evaluate.mjs")) {
  process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
}
