import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { listUsersByIds } from "./authStore.js";
import {
  createRepository,
  createRepositoryUser,
  defaultAllegroRepositoryConfig,
  deleteRepository,
  deleteRepositoryUser,
  runSparqlUpdate,
  withRepository,
} from "../services/allegroClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const ORGANISATIONS_FILE = path.join(DATA_DIR, "organisations.json");
const RDF_STRUCTURES_DIR = path.join(DATA_DIR, "rdf-structures");
const RDF_STRUCTURE_FILE_NAME = "reportRdfStructure.json";
const UNSCOPED_RDF_STRUCTURE_KEY = "no-organisation";
const ROLE_WEIGHT = {
  guest: 1,
  member: 2,
  owner: 3,
};
const ORGANISATION_ROLES = new Set(["owner", "member", "guest"]);

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "organisation";
}

function generatedPassword() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 16);
}

function repositoryCredentials(organisationId, name) {
  const shortId = organisationId.split("-")[0];
  return {
    repository: `sitrep-${slug(name)}-${shortId}`,
    username: `sitrep_${shortId}`,
    password: generatedPassword(),
  };
}

function rdfStructureDirectoryKey(organisationId) {
  return organisationId || UNSCOPED_RDF_STRUCTURE_KEY;
}

function rdfStructureFilePath(organisationId) {
  return path.join(RDF_STRUCTURES_DIR, rdfStructureDirectoryKey(organisationId), RDF_STRUCTURE_FILE_NAME);
}

function sparqlLiteral(value) {
  return JSON.stringify(String(value));
}

async function deleteLegacyOrganisationData(organisationId) {
  await withRepository(defaultAllegroRepositoryConfig(), async () => {
    await runSparqlUpdate(`
      PREFIX sitrep: <http://sitrep.example.org/ontology#>
      DELETE {
        ?linked ?linkedPredicate ?linkedObject .
      }
      WHERE {
        ?entity sitrep:organisationId ${sparqlLiteral(organisationId)} ;
                ?predicate ?linked .
        ?linked ?linkedPredicate ?linkedObject .
        FILTER(isIRI(?linked))
        FILTER(STRSTARTS(STR(?linked), "http://sitrep.example.org/resource/"))
      };
      DELETE {
        ?entity ?predicate ?object .
      }
      WHERE {
        ?entity sitrep:organisationId ${sparqlLiteral(organisationId)} ;
                ?predicate ?object .
      }
    `);
  });
}

async function readOrganisations() {
  try {
    const json = await readFile(ORGANISATIONS_FILE, "utf8");
    const organisations = JSON.parse(json);
    if (organisations.some(organisation => organisation.rdfStructureJson)) {
      await Promise.all(organisations.map(migrateInlineRdfStructure));
      await writeOrganisations(organisations);
      return organisations.map(withoutInlineRdfStructure);
    }
    return organisations;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeOrganisations(organisations) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ORGANISATIONS_FILE, `${JSON.stringify(organisations.map(withoutInlineRdfStructure), null, 2)}\n`, "utf8");
}

function withoutInlineRdfStructure(organisation) {
  const { rdfStructureJson, ...metadata } = organisation;
  return metadata;
}

async function migrateInlineRdfStructure(organisation) {
  if (!organisation?.rdfStructureJson) return;
  const structurePath = rdfStructureFilePath(organisation.id);
  await mkdir(path.dirname(structurePath), { recursive: true });
  await writeFile(structurePath, `${JSON.stringify(JSON.parse(organisation.rdfStructureJson), null, 2)}\n`, "utf8");
}

function requireOrganisationRole(role) {
  if (!ORGANISATION_ROLES.has(role)) {
    throw new Error("Role must be owner, member, or guest.");
  }
}

function membershipFor(organisation, userId) {
  return organisation.members.find(member => member.userId === userId) || null;
}

function isAdmin(user) {
  return user?.role === "admin";
}

function actorId(actor) {
  return typeof actor === "string" ? actor : actor?.id;
}

function requireOwner(organisation, actor) {
  if (isAdmin(actor)) return null;
  const userId = actorId(actor);
  const membership = membershipFor(organisation, userId);
  if (membership?.role !== "owner") {
    throw new Error("You must be an organisation owner to do that.");
  }
  return membership;
}

async function organisationPayload(organisation, currentUserId) {
  const users = await listUsersByIds(organisation.members.map(member => member.userId));
  const usersById = new Map(users.map(user => [user.id, user]));
  return {
    id: organisation.id,
    name: organisation.name,
    description: organisation.description || null,
    createdBy: organisation.createdBy,
    createdAt: organisation.createdAt,
    updatedAt: organisation.updatedAt,
    repository: organisation.repository || null,
    repositoryUsername: organisation.repositoryUsername || null,
    repositoryPassword: organisation.repositoryPassword || null,
    currentUserRole: membershipFor(organisation, currentUserId)?.role || null,
    members: organisation.members.map(member => ({
      user: usersById.get(member.userId) || {
        id: member.userId,
        email: "Unknown user",
        name: null,
        role: "user",
      },
      role: member.role,
      joinedAt: member.joinedAt,
    })),
  };
}

export async function listOrganisations(currentUserId) {
  const organisations = await readOrganisations();
  return Promise.all(organisations.map(organisation => organisationPayload(organisation, currentUserId)));
}

export async function listMyOrganisations(userId) {
  const organisations = await readOrganisations();
  return Promise.all(
    organisations
      .filter(organisation => membershipFor(organisation, userId))
      .map(organisation => organisationPayload(organisation, userId))
  );
}

export async function createOrganisation(userId, { name, description }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("Organisation name is required.");
  }

  const organisations = await readOrganisations();
  const now = new Date().toISOString();
  const id = randomUUID();
  const credentials = repositoryCredentials(id, trimmedName);
  await createRepository(credentials.repository);
  await createRepositoryUser(credentials);
  const organisation = {
    id,
    name: trimmedName,
    description: String(description || "").trim() || null,
    repository: credentials.repository,
    repositoryUsername: credentials.username,
    repositoryPassword: credentials.password,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    members: [{
      userId,
      role: "owner",
      joinedAt: now,
    }],
  };

  await writeOrganisations([...organisations, organisation]);
  return organisationPayload(organisation, userId);
}

export async function joinOrganisation(userId, organisationId) {
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  if (membershipFor(organisation, userId)) {
    return organisationPayload(organisation, userId);
  }

  const now = new Date().toISOString();
  const nextOrganisation = {
    ...organisation,
    updatedAt: now,
    members: [
      ...organisation.members,
      { userId, role: "guest", joinedAt: now },
    ],
  };
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = nextOrganisation;
  await writeOrganisations(nextOrganisations);
  return organisationPayload(nextOrganisation, userId);
}

export async function updateOrganisation(actor, organisationId, { name, description }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("Organisation name is required.");
  }

  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  requireOwner(organisation, actor);

  const nextOrganisation = {
    ...organisation,
    name: trimmedName,
    description: String(description || "").trim() || null,
    updatedAt: new Date().toISOString(),
  };
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = nextOrganisation;
  await writeOrganisations(nextOrganisations);
  return organisationPayload(nextOrganisation, actorId(actor));
}

export async function updateOrganisationMemberRole(actor, organisationId, targetUserId, role) {
  requireOrganisationRole(role);
  const actorUserId = actorId(actor);

  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  requireOwner(organisation, actor);

  const targetMembership = membershipFor(organisation, targetUserId);
  if (!targetMembership) {
    throw new Error("User is not part of this organisation.");
  }
  if (targetMembership.role === "owner" && actorUserId !== targetUserId && !isAdmin(actor)) {
    throw new Error("Only that owner can change their owner role.");
  }
  if (role === "owner" && actorUserId !== targetUserId) {
    throw new Error("Only a user can make themself an owner.");
  }
  if (targetMembership.role === "owner" && role !== "owner" && actorUserId === targetUserId && !isAdmin(actor)) {
    const ownerCount = organisation.members.filter(member => member.role === "owner").length;
    if (ownerCount <= 1) {
      throw new Error("An organisation must have at least one owner.");
    }
  }

  const nextOrganisation = {
    ...organisation,
    updatedAt: new Date().toISOString(),
    members: organisation.members.map(member => (
      member.userId === targetUserId ? { ...member, role } : member
    )),
  };
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = nextOrganisation;
  await writeOrganisations(nextOrganisations);
  return organisationPayload(nextOrganisation, actorUserId);
}

export async function deleteOrganisation(actor, organisationId) {
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  const actorUserId = actorId(actor);
  if (!isAdmin(actor)) {
    const membership = membershipFor(organisation, actorUserId);
    if (membership?.role !== "owner") {
      throw new Error("You must be an organisation owner to do that.");
    }
    const ownerCount = organisation.members.filter(member => member.role === "owner").length;
    if (ownerCount !== 1) {
      throw new Error("Only the sole organisation owner can delete an organisation.");
    }
  }

  if (organisation.repository) {
    await deleteRepository(organisation.repository);
  } else {
    await deleteLegacyOrganisationData(organisation.id);
  }
  if (organisation.repositoryUsername) {
    await deleteRepositoryUser(organisation.repositoryUsername);
  }
  await rm(path.dirname(rdfStructureFilePath(organisationId)), { recursive: true, force: true });

  const nextOrganisations = organisations.filter(organisation => organisation.id !== organisationId);
  await writeOrganisations(nextOrganisations);
  return true;
}

export async function highestOrganisationRole(userId) {
  const organisations = await readOrganisations();
  return organisations
    .flatMap(organisation => organisation.members)
    .filter(member => member.userId === userId)
    .map(member => member.role)
    .sort((left, right) => ROLE_WEIGHT[right] - ROLE_WEIGHT[left])[0] || null;
}

export async function canWriteOrganisationData(user) {
  if (isAdmin(user)) return true;
  const userId = actorId(user);
  const role = await highestOrganisationRole(userId);
  return role === "owner" || role === "member";
}

export async function canViewOrganisation(user, organisationId) {
  if (isAdmin(user)) return true;
  const organisations = await readOrganisations();
  const organisation = organisations.find(candidate => candidate.id === organisationId);
  return !!organisation && !!membershipFor(organisation, actorId(user));
}

export async function canWriteOrganisation(user, organisationId) {
  if (isAdmin(user)) return true;
  const organisations = await readOrganisations();
  const organisation = organisations.find(candidate => candidate.id === organisationId);
  const role = organisation ? membershipFor(organisation, actorId(user))?.role : null;
  return role === "owner" || role === "member";
}

export async function organisationRepositoryConfig(organisationId) {
  if (!organisationId) return defaultAllegroRepositoryConfig();

  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(candidate => candidate.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  let organisation = organisations[organisationIndex];
  if (!organisation.repository || !organisation.repositoryUsername || !organisation.repositoryPassword) {
    const credentials = repositoryCredentials(organisation.id, organisation.name);
    await createRepository(credentials.repository);
    await createRepositoryUser(credentials);
    organisation = {
      ...organisation,
      repository: credentials.repository,
      repositoryUsername: credentials.username,
      repositoryPassword: credentials.password,
      updatedAt: new Date().toISOString(),
    };
    const nextOrganisations = [...organisations];
    nextOrganisations[organisationIndex] = organisation;
    await writeOrganisations(nextOrganisations);
  }

  return {
    repository: organisation.repository,
    username: organisation.repositoryUsername,
    password: organisation.repositoryPassword,
  };
}

export async function organisationRdfStructureJson(organisationId) {
  try {
    return await readFile(rdfStructureFilePath(organisationId), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}

export async function updateOrganisationRdfStructureJson(organisationId, json) {
  const structurePath = rdfStructureFilePath(organisationId);
  await mkdir(path.dirname(structurePath), { recursive: true });
  await writeFile(structurePath, `${JSON.stringify(JSON.parse(json), null, 2)}\n`, "utf8");

  if (!organisationId) return;
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(candidate => candidate.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = {
    ...nextOrganisations[organisationIndex],
    updatedAt: new Date().toISOString(),
  };
  await writeOrganisations(nextOrganisations);
}
