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
import {
  decryptJoinPassword,
  decryptRepositoryPassword,
  encryptJoinPassword,
  encryptRepositoryPassword,
} from "../services/organisationCredentialEncryption.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const ORGANISATIONS_FILE = path.join(DATA_DIR, "organisations.json");
const RDF_STRUCTURES_DIR = path.join(DATA_DIR, "rdf-structures");
const RDF_STRUCTURE_FILE_NAME = "reportRdfStructure.json";
const UNSCOPED_RDF_STRUCTURE_KEY = "no-organisation";
let credentialUpgradeQueue = Promise.resolve();
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

function generatedJoinPassword() {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

function repositoryCredentials(organisationId, name) {
  const shortId = organisationId.split("-")[0];
  return {
    repository: `sitrep-${slug(name)}-${shortId}`,
    username: `sitrep_${shortId}`,
    password: generatedPassword(),
  };
}

function repositoryReadCredentials(organisationId, repository) {
  const shortId = organisationId.split("-")[0];
  return {
    repository,
    username: `sitrep_${shortId}_read`,
    password: generatedPassword(),
    write: false,
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
  await writeFile(ORGANISATIONS_FILE, `${JSON.stringify(organisations.map(serializedOrganisation), null, 2)}\n`, "utf8");
}

function withoutInlineRdfStructure(organisation) {
  const { rdfStructureJson, ...metadata } = organisation;
  return metadata;
}

function serializedOrganisation(organisation) {
  const metadata = withoutInlineRdfStructure(organisation);
  return {
    ...metadata,
    repositoryPassword: encryptRepositoryPassword(metadata.repositoryPassword),
    repositoryReadPassword: encryptRepositoryPassword(metadata.repositoryReadPassword),
    joinPassword: encryptJoinPassword(metadata.joinPassword),
  };
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

async function organisationPayload(organisation, currentActor) {
  const currentUserId = actorId(currentActor);
  const users = await listUsersByIds(organisation.members.map(member => member.userId));
  const usersById = new Map(users.map(user => [user.id, user]));
  const currentMembership = membershipFor(organisation, currentUserId);
  const canViewOwnerRepositoryCredentials = isAdmin(currentActor)
    || currentMembership?.role === "owner";
  const canViewMemberRepositoryCredentials = canViewOwnerRepositoryCredentials
    || currentMembership?.role === "member";
  const canViewJoinPassword = currentMembership?.role === "owner";
  return {
    id: organisation.id,
    name: organisation.name,
    description: organisation.description || null,
    createdBy: organisation.createdBy,
    createdAt: organisation.createdAt,
    updatedAt: organisation.updatedAt,
    repository: canViewMemberRepositoryCredentials ? organisation.repository || null : null,
    repositoryUsername: canViewOwnerRepositoryCredentials ? organisation.repositoryUsername || null : null,
    repositoryPassword: canViewOwnerRepositoryCredentials ? decryptRepositoryPassword(organisation.repositoryPassword) || null : null,
    repositoryReadUsername: canViewMemberRepositoryCredentials ? organisation.repositoryReadUsername || null : null,
    repositoryReadPassword: canViewMemberRepositoryCredentials ? decryptRepositoryPassword(organisation.repositoryReadPassword) || null : null,
    joinRequiresPassword: !!organisation.joinPassword,
    joinPassword: canViewJoinPassword ? decryptJoinPassword(organisation.joinPassword) || null : null,
    currentUserRole: currentMembership?.role || null,
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

export async function listOrganisations(currentActor) {
  const upgradedOrganisations = await readAndUpgradeVisibleOrganisationCredentials(currentActor);
  return Promise.all(upgradedOrganisations.map(organisation => organisationPayload(organisation, currentActor)));
}

export async function listMyOrganisations(currentActor) {
  const userId = actorId(currentActor);
  const organisations = await readAndUpgradeVisibleOrganisationCredentials(currentActor);
  return Promise.all(
    organisations
      .filter(organisation => membershipFor(organisation, userId))
      .map(organisation => organisationPayload(organisation, currentActor))
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
  const readCredentials = repositoryReadCredentials(id, credentials.repository);
  await createRepository(credentials.repository);
  await createRepositoryUser(credentials);
  await createRepositoryUser(readCredentials);
  const organisation = {
    id,
    name: trimmedName,
    description: String(description || "").trim() || null,
    repository: credentials.repository,
    repositoryUsername: credentials.username,
    repositoryPassword: credentials.password,
    repositoryReadUsername: readCredentials.username,
    repositoryReadPassword: readCredentials.password,
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

export async function joinOrganisation(userId, organisationId, password) {
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  if (membershipFor(organisation, userId)) {
    return organisationPayload(organisation, userId);
  }
  if (organisation.joinPassword && password !== decryptJoinPassword(organisation.joinPassword)) {
    throw new Error("The organisation password is incorrect.");
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

export async function leaveOrganisation(actor, organisationId) {
  const userId = actorId(actor);
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  const membership = membershipFor(organisation, userId);
  if (!membership) {
    throw new Error("You are not part of this organisation.");
  }
  if (membership.role === "owner") {
    const remainingOwnerCount = organisation.members.filter(member => (
      member.role === "owner" && member.userId !== userId
    )).length;
    if (remainingOwnerCount === 0) {
      throw new Error("An organisation must have at least one owner.");
    }
  }

  const nextOrganisation = {
    ...organisation,
    updatedAt: new Date().toISOString(),
    members: organisation.members.filter(member => member.userId !== userId),
  };
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = nextOrganisation;
  await writeOrganisations(nextOrganisations);
  return true;
}

export async function updateOrganisation(actor, organisationId, { name, description, joinRequiresPassword }) {
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
    joinPassword: joinRequiresPassword ? decryptJoinPassword(organisation.joinPassword) || generatedJoinPassword() : null,
    updatedAt: new Date().toISOString(),
  };
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = nextOrganisation;
  await writeOrganisations(nextOrganisations);
  return organisationPayload(nextOrganisation, actor);
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
  const actorMembership = isAdmin(actor) ? null : membershipFor(organisation, actorUserId);
  const actorIsOwner = isAdmin(actor) || actorMembership?.role === "owner";
  const actorCanPromoteGuest = actorMembership?.role === "member" && role === "member";
  if (!actorIsOwner && !actorCanPromoteGuest) {
    throw new Error("You must be an organisation owner to change this role.");
  }

  const targetMembership = membershipFor(organisation, targetUserId);
  if (!targetMembership) {
    throw new Error("User is not part of this organisation.");
  }
  if (actorCanPromoteGuest && targetUserId === actorUserId) {
    throw new Error("Members cannot change their own role.");
  }
  if (actorCanPromoteGuest && targetMembership.role !== "guest") {
    throw new Error("Members can only promote guests to members.");
  }
  if (targetMembership.role === "owner" && role !== "owner" && !isAdmin(actor)) {
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
  return organisationPayload(nextOrganisation, actor);
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
  if (organisation.repositoryReadUsername) {
    await deleteRepositoryUser(organisation.repositoryReadUsername);
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

  const organisation = await withCredentialUpgradeLock(async () => {
    const organisations = await readOrganisations();
    const organisationIndex = organisations.findIndex(candidate => candidate.id === organisationId);
    if (organisationIndex === -1) {
      throw new Error("Organisation not found.");
    }
    return ensureOrganisationCredentialSets(organisations, organisationIndex);
  });

  return {
    repository: organisation.repository,
    username: organisation.repositoryUsername,
    password: decryptRepositoryPassword(organisation.repositoryPassword),
  };
}

async function readAndUpgradeVisibleOrganisationCredentials(currentActor) {
  return withCredentialUpgradeLock(async () => {
    const organisations = await readOrganisations();
    return upgradeVisibleOrganisationCredentials(organisations, currentActor);
  });
}

function withCredentialUpgradeLock(callback) {
  const nextUpgrade = credentialUpgradeQueue.then(callback, callback);
  credentialUpgradeQueue = nextUpgrade.catch(() => {});
  return nextUpgrade;
}

async function upgradeVisibleOrganisationCredentials(organisations, currentActor) {
  let nextOrganisations = organisations;
  for (const [index, organisation] of organisations.entries()) {
    const membership = membershipFor(organisation, actorId(currentActor));
    if (!isAdmin(currentActor) && membership?.role !== "owner" && membership?.role !== "member") {
      continue;
    }
    const upgradedOrganisation = await ensureOrganisationCredentialSets(nextOrganisations, index);
    if (upgradedOrganisation !== nextOrganisations[index]) {
      nextOrganisations = [...nextOrganisations];
      nextOrganisations[index] = upgradedOrganisation;
    }
  }
  return nextOrganisations;
}

async function ensureOrganisationCredentialSets(organisations, organisationIndex) {
  const organisation = organisations[organisationIndex];
  let nextOrganisation = organisation;

  if (!organisation.repository || !organisation.repositoryUsername || !organisation.repositoryPassword) {
    const credentials = repositoryCredentials(organisation.id, organisation.name);
    await createRepository(credentials.repository);
    await createRepositoryUser(credentials);
    nextOrganisation = {
      ...nextOrganisation,
      repository: credentials.repository,
      repositoryUsername: credentials.username,
      repositoryPassword: credentials.password,
    };
  }

  if (!nextOrganisation.repositoryReadUsername || !nextOrganisation.repositoryReadPassword) {
    const readCredentials = repositoryReadCredentials(nextOrganisation.id, nextOrganisation.repository);
    await createRepositoryUser(readCredentials);
    nextOrganisation = {
      ...nextOrganisation,
      repositoryReadUsername: readCredentials.username,
      repositoryReadPassword: readCredentials.password,
    };
  }

  if (nextOrganisation !== organisation) {
    nextOrganisation = {
      ...nextOrganisation,
      updatedAt: new Date().toISOString(),
    };
    const nextOrganisations = [...organisations];
    nextOrganisations[organisationIndex] = nextOrganisation;
    await writeOrganisations(nextOrganisations);
  }

  return nextOrganisation;
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
