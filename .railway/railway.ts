import { defineRailway, github, group, project, service, volume } from "railway/iac";

const sourceRepo = process.env.SOURCE_REPO;
const sourceBranch = process.env.SOURCE_BRANCH ?? "release-v1";
const sourceRoot = process.env.SOURCE_ROOT_DIR ?? "/authentik-oidc-broker";
if (!sourceRepo || !/^[\w.-]+\/[\w.-]+$/.test(sourceRepo)) {
  throw new Error("SOURCE_REPO is required: use an existing owner/repository that contains this recipe");
}
if (!/^[\w.-]+$/.test(sourceBranch)) {
  throw new Error("SOURCE_BRANCH must be an exact slash-free release branch or tag");
}
if (!sourceRoot.startsWith("/") || sourceRoot.includes("..")) {
  throw new Error("SOURCE_ROOT_DIR must be an absolute repository-relative directory");
}

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const secret = (length: number, description: string) => ({
  generator: `secret(${length}, "${alphabet}")`,
  description,
  isOptional: false,
});

export default defineRailway(() => {
  const databaseVolume = volume("Database Data", { sizeMB: 5_000 });
  const postgres = service("Postgres", {
    source: { image: "postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777" },
    replicas: 1,
    env: {
      PORT: "5432",
      POSTGRES_DB: "authentik",
      POSTGRES_USER: "authentik",
      POSTGRES_PASSWORD: secret(48, "Generated database password; keep stable across all services."),
      PGDATA: "/var/lib/postgresql/data/pgdata",
    },
    volumeMounts: { "/var/lib/postgresql/data": databaseVolume },
  });
  const common = {
    AUTHENTIK_POSTGRESQL__HOST: "${{Postgres.RAILWAY_PRIVATE_DOMAIN}}",
    AUTHENTIK_POSTGRESQL__PORT: "5432",
    AUTHENTIK_POSTGRESQL__NAME: "${{Postgres.POSTGRES_DB}}",
    AUTHENTIK_POSTGRESQL__USER: "${{Postgres.POSTGRES_USER}}",
    AUTHENTIK_POSTGRESQL__PASSWORD: "${{Postgres.POSTGRES_PASSWORD}}",
    AUTHENTIK_POSTGRESQL__SSLMODE: "disable",
    AUTHENTIK_OUTPOSTS__DISCOVER: "false",
    AUTHENTIK_OUTPOSTS__DISABLE_EMBEDDED_OUTPOST: "true",
    AUTHENTIK_DISABLE_STARTUP_ANALYTICS: "true",
    AUTHENTIK_DISABLE_UPDATE_CHECK: "true",
    AUTHENTIK_ERROR_REPORTING__ENABLED: "false",
    AUTHENTIK_LISTEN__HTTP: "[::]:9000",
    AUTHENTIK_LISTEN__HTTPS: "127.0.0.1:9443",
    AUTHENTIK_LISTEN__TRUSTED_PROXY_CIDRS: "127.0.0.0/8,::1/128,100.64.0.0/10",
    RECIPE_BOOTSTRAP_TIMEOUT: "600",
  };
  const worker = service("Worker", {
    source: github(sourceRepo, { branch: sourceBranch, rootDirectory: sourceRoot }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "python /opt/recipe/runtime.py worker",
    replicas: 1,
    healthcheck: "/health/ready",
    healthcheckTimeout: 900,
    env: {
      ...common,
      PORT: "9301",
      AUTHENTIK_SECRET_KEY: secret(64, "Stable signing/encryption secret; back up securely with the database."),
      AUTHENTIK_BOOTSTRAP_PASSWORD: secret(48, "Initial akadmin password; changing this later is NOT rotation."),
      AUTHENTIK_BOOTSTRAP_TOKEN: secret(64, "Initial privileged API token; revoke after setup and confirmation."),
      AUTHENTIK_BOOTSTRAP_EMAIL: { value: "admin@example.invalid", description: "Set a real administrator email before first startup." },
    },
  });
  const server = service("Server", {
    source: github(sourceRepo, { branch: sourceBranch, rootDirectory: sourceRoot }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "python /opt/recipe/runtime.py server",
    replicas: 1,
    healthcheck: "/-/health/ready/",
    healthcheckTimeout: 900,
    networking: { serviceDomains: { "<hasDomain>": { port: 9000 } } },
    env: {
      ...common,
      PORT: "9000",
      AUTHENTIK_SECRET_KEY: "${{Worker.AUTHENTIK_SECRET_KEY}}",
    },
  });
  return project("authentik OIDC broker", {
    resources: [group("Identity", [server, worker]), group("Storage", [postgres, databaseVolume])],
  });
});
