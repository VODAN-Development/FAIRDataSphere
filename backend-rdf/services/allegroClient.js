import { AsyncLocalStorage } from "node:async_hooks";

const isProduction = process.env.NODE_ENV === "production";

function envValue(name, fallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(`${name} must be set in production.`);
  }
  return fallback;
}

const ALLEGRO_BASE_URL = envValue("ALLEGRO_BASE_URL", "http://localhost:10035");
const DEFAULT_REPOSITORY = envValue("ALLEGRO_REPOSITORY", "sitrep");
const DEFAULT_USERNAME = envValue("ALLEGRO_USERNAME", "admin");
const DEFAULT_PASSWORD = envValue("ALLEGRO_PASSWORD", "sitrep-dev-password-change-me");
const DEFAULT_CATALOG = envValue("ALLEGRO_CATALOG", "/");

const repositoryContext = new AsyncLocalStorage();

function basicAuth(username, password) {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

function repositoryUrl(repository = DEFAULT_REPOSITORY) {
  return `${ALLEGRO_BASE_URL}/repositories/${encodeURIComponent(repository)}`;
}

function activeRepositoryConfig() {
  return repositoryContext.getStore() || defaultRepositoryConfig();
}

function defaultRepositoryConfig() {
  return {
    repository: DEFAULT_REPOSITORY,
    username: DEFAULT_USERNAME,
    password: DEFAULT_PASSWORD,
  };
}

function managementHeaders() {
  return {
    Authorization: basicAuth(DEFAULT_USERNAME, DEFAULT_PASSWORD),
  };
}

async function assertOk(response, action) {
  if (response.ok) return;
  const text = await response.text();
  if (response.status === 400 && /already exists|exists/i.test(text)) return;
  if (response.status === 409) return;
  throw new Error(`${action} failed ${response.status}: ${text}`);
}

async function assertDeleteOk(response, action) {
  if (response.ok || response.status === 404) return;
  const text = await response.text();
  throw new Error(`${action} failed ${response.status}: ${text}`);
}

export function defaultAllegroRepositoryConfig() {
  return defaultRepositoryConfig();
}

export function withRepository(repositoryConfig, callback) {
  return repositoryContext.run(repositoryConfig || defaultRepositoryConfig(), callback);
}

export async function createRepository(repository) {
  const response = await fetch(repositoryUrl(repository), {
    method: "PUT",
    headers: managementHeaders(),
  });
  await assertOk(response, `Create repository ${repository}`);
}

export async function deleteRepository(repository) {
  const response = await fetch(repositoryUrl(repository), {
    method: "DELETE",
    headers: managementHeaders(),
  });
  await assertDeleteOk(response, `Delete repository ${repository}`);
}

export async function createRepositoryUser({ username, password, repository }) {
  const userParams = new URLSearchParams({ password });
  const userResponse = await fetch(`${ALLEGRO_BASE_URL}/users/${encodeURIComponent(username)}?${userParams}`, {
    method: "PUT",
    headers: managementHeaders(),
  });
  await assertOk(userResponse, `Create user ${username}`);

  const accessParams = new URLSearchParams({
    read: "true",
    write: "true",
    catalog: DEFAULT_CATALOG,
    repository,
  });
  const accessResponse = await fetch(`${ALLEGRO_BASE_URL}/users/${encodeURIComponent(username)}/access?${accessParams}`, {
    method: "PUT",
    headers: managementHeaders(),
  });
  await assertOk(accessResponse, `Grant repository access to ${username}`);
}

export async function deleteRepositoryUser(username) {
  const response = await fetch(`${ALLEGRO_BASE_URL}/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: managementHeaders(),
  });
  await assertDeleteOk(response, `Delete repository user ${username}`);
}

export async function runSparqlQuery(query) {
  const config = activeRepositoryConfig();
  const response = await fetch(repositoryUrl(config.repository), {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
      "Accept": "application/sparql-results+json",
      "Authorization": basicAuth(config.username, config.password),
    },
    body: query,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SPARQL Error ${response.status}: ${text}`);
  }

  return response.json();
}

export async function runSparqlUpdate(update) {
  const config = activeRepositoryConfig();
  const response = await fetch(repositoryUrl(config.repository), {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-update",
      "Accept": "text/plain",
      "Authorization": basicAuth(config.username, config.password),
    },
    body: update,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SPARQL Update Error ${response.status}: ${text}`);
  }

  return response.text();
}
