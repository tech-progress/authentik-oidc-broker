import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { graph } from "./evaluate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const defaults = read("template-defaults.json");
const descriptions = read("template-descriptions.json");
const volumes = read("template-volumes.json");
const networking = read("template-networking.json");
const metadata = read("marketplace-metadata.json");
const fields = ["source", "build", "deploy", "variables", "networking", "volumeMounts"];

export function canonical() {
  const graphVolumes = graph.resources.filter((resource) => resource.type === "volume");
  assert.equal(graphVolumes.length, 1, "Only database storage is permitted");
  assert.equal(graphVolumes[0].name, volumes.Postgres.name);
  assert.equal(graphVolumes[0].config.sizeMB, volumes.Postgres.sizeMB);
  return structuredClone(graph.resources.filter((resource) => resource.type === "service")).map((service) => {
    const attachments = Object.values(service.volumeAttachments ?? {});
    assert.deepEqual(service.volumeMounts ?? {}, {}, "Raw unmanaged mounts are not permitted");
    if (service.name === "Postgres") {
      assert.equal(attachments.length, 1);
      assert.equal(attachments[0].volume, graphVolumes[0].address);
      assert.equal(attachments[0].mountPath, volumes.Postgres.mountPath);
    } else {
      assert.equal(attachments.length, 0, "Application filesystems cannot be shared or persisted");
    }
    const domains = Object.values(service.networking?.serviceDomains ?? {});
    if (networking[service.name].publicPort === null) {
      assert.equal(domains.length, 0, "Private service has a public domain");
    } else {
      assert.equal(domains.length, 1);
      assert.equal(domains[0].port, networking[service.name].publicPort);
    }
    assert.deepEqual(service.networking?.tcpProxies ?? {}, {});
    assert.deepEqual(service.networking?.customDomains ?? {}, {});
    const variables = {};
    for (const [name, variable] of Object.entries(service.variables)) {
      const raw = variable.type === "raw" ? variable.value : { value: variable.value };
      const expression = raw.generator ? `\${{${raw.generator}}}` : raw.value;
      assert.equal(expression, defaults[service.name][name], `Default drift: ${service.name}.${name}`);
      const description = descriptions[service.name]?.[name] ?? descriptions.common?.[name] ?? raw.description;
      assert.ok(description, `Description missing: ${service.name}.${name}`);
      variables[name] = { defaultValue: expression, description, isOptional: false };
    }
    assert.deepEqual(Object.keys(variables).sort(), Object.keys(defaults[service.name]).sort());
    const { type, ...source } = service.source;
    return {
      name: service.name,
      source,
      build: service.build ?? {},
      deploy: service.deploy,
      variables,
      networking: service.networking ?? { serviceDomains: {}, customDomains: {}, tcpProxies: {} },
      volumeMounts: volumes[service.name] ? { database: {
        mountPath: volumes[service.name].mountPath, sizeMB: volumes[service.name].sizeMB,
      } } : {},
    };
  });
}

function configuration(draft) {
  const config = draft?.data?.template?.serializedConfig ?? draft?.serializedConfig ?? draft;
  assert.ok(Array.isArray(config?.services), "Expected a LOCAL serializedConfig.services array");
  assert.deepEqual(config.services.map((service) => service.name).sort(), ["Postgres", "Server", "Worker"]);
  return config;
}

export function restore(draft) {
  const config = configuration(draft);
  const expected = new Map(canonical().map((service) => [service.name, service]));
  config.services = config.services.map((original) => {
    const desired = expected.get(original.name);
    const result = { ...original, ...desired };
    if (original.name === "Postgres") {
      const mountNames = Object.keys(original.volumeMounts ?? {});
      assert.equal(mountNames.length, 1, "Local draft must contain exactly one existing database mount");
      result.volumeMounts = { [mountNames[0]]: Object.values(desired.volumeMounts)[0] };
    }
    return result;
  });
  audit(draft);
  return draft;
}

export function audit(draft) {
  const config = configuration(draft);
  const expected = new Map(canonical().map((service) => [service.name, service]));
  for (const service of config.services) {
    const desired = expected.get(service.name);
    for (const field of fields) {
      if (field === "volumeMounts" && service.name === "Postgres") {
        assert.equal(Object.keys(service.volumeMounts ?? {}).length, 1, "Database mount count");
        assert.deepEqual(Object.values(service.volumeMounts), Object.values(desired.volumeMounts));
      } else {
        assert.deepEqual(service[field], desired[field], `Drift in ${service.name}.${field}`);
      }
    }
  }
  assert.ok(metadata.description.length >= 45 && metadata.description.length <= 75);
  assert.equal(metadata.directory, "authentik-oidc-broker");
  assert.equal(metadata.icon, "https://goauthentik.io/img/icon.png");
  assert.equal(metadata.category, "Authentication");
  assert.deepEqual(metadata.origins.map((origin) => origin.url).sort(), ["https://goauthentik.io/", "https://www.postgresql.org/"].sort());
  assert.ok(!("templateId" in metadata) && !("code" in metadata), "Unpublished metadata must not invent identifiers");
  return true;
}

const command = process.argv[2];
if (command) {
  try {
  assert.ok(["restore", "audit", "fixture"].includes(command), "Only offline restore/audit/fixture are supported");
  if (command === "fixture") {
    process.stdout.write(`${JSON.stringify({ services: canonical() }, null, 2)}\n`);
  } else {
    const input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    if (command === "restore") {
      assert.ok(process.argv[4], "An output path is required; there is no remote operation");
      assert.notEqual(path.resolve(process.argv[3]), path.resolve(process.argv[4]), "Do not overwrite the source snapshot");
      fs.writeFileSync(process.argv[4], `${JSON.stringify(restore(input), null, 2)}\n`, { mode: 0o600, flag: "wx" });
    } else {
      audit(input);
      console.log("PASS: local draft sources, generator expressions, references, readiness, storage, and networking");
    }
  }
  } catch {
    console.error("FAIL: offline contract mismatch or invalid local input; values redacted");
    process.exitCode = 1;
  }
}
