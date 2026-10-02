import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonical, restore, audit } from "../scripts/offline-template.mjs";

test("offline fixture matches exact contract and generator expressions", () => {
  const services = canonical();
  assert.equal(audit({ services }), true);
  const worker = services.find((service) => service.name === "Worker");
  assert.match(worker.variables.AUTHENTIK_SECRET_KEY.defaultValue, /^\$\{\{secret\(64,/);
  assert.equal(services.find((service) => service.name === "Server").variables.AUTHENTIK_SECRET_KEY.defaultValue, "${{Worker.AUTHENTIK_SECRET_KEY}}");
});

test("restore repairs drift, preserves local IDs/mount IDs, and removes private service domains", () => {
  const input = { services: canonical() };
  for (const service of input.services) {
    service.id = `local-fixture-${service.name}`;
    service.source = { image: "unsafe:latest" };
    service.networking = { serviceDomains: { unsafe: { port: 123 } } };
    service.variables = {};
  }
  const postgres = input.services.find((service) => service.name === "Postgres");
  postgres.volumeMounts = { "local-existing-mount": { mountPath: "/wrong", sizeMB: 1 } };
  const result = restore(input);
  assert.equal(audit(result), true);
  assert.ok(result.services.every((service) => service.id === `local-fixture-${service.name}`));
  assert.ok(postgres !== result.services.find((service) => service.name === "Postgres"));
  assert.equal(Object.keys(result.services.find((service) => service.name === "Postgres").volumeMounts)[0], "local-existing-mount");
});

test("rejects service changes, missing storage, literal secrets, ports, and reference drift", () => {
  assert.throws(() => restore({ services: [] }));
  const missing = { services: canonical() };
  missing.services.find((service) => service.name === "Postgres").volumeMounts = {};
  assert.throws(() => restore(missing));
  for (const mutate of [
    (worker) => { worker.variables.AUTHENTIK_SECRET_KEY.defaultValue = "deterministic-unsafe-secret"; },
    (worker) => { worker.networking.serviceDomains = { public: { port: 9301 } }; },
    (worker) => { worker.variables.AUTHENTIK_POSTGRESQL__PASSWORD.defaultValue = "not-a-reference"; },
    (worker) => { worker.deploy.startCommand = "ak server"; },
  ]) {
    const input = { services: canonical() };
    mutate(input.services.find((service) => service.name === "Worker"));
    assert.throws(() => audit(input));
  }
});

test("CLI audit and restore redact secret-bearing failures", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  fs.mkdirSync(path.join(root, ".artifacts"), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, ".artifacts/redaction-test-"));
  try {
    const canary = "CANARY-NEVER-PRINT-RESOLVED-CREDENTIAL-493821";
    const draft = { services: canonical() };
    draft.services.find((service) => service.name === "Worker").variables.AUTHENTIK_SECRET_KEY.defaultValue = canary;
    const input = path.join(directory, "input.json");
    fs.writeFileSync(input, JSON.stringify(draft), { mode: 0o600 });
    const result = spawnSync(process.execPath, [path.join(root, "scripts/offline-template.mjs"), "audit", input], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.ok(!(result.stdout + result.stderr).includes(canary));
    assert.match(result.stderr, /values redacted/);
    draft.services.push({ name: canary });
    fs.writeFileSync(input, JSON.stringify(draft), { mode: 0o600 });
    const restore = spawnSync(process.execPath, [path.join(root, "scripts/offline-template.mjs"), "restore", input, path.join(directory, "output.json")], { encoding: "utf8" });
    assert.equal(restore.status, 1);
    assert.ok(!(restore.stdout + restore.stderr).includes(canary));
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
