import { runSparqlQuery, runSparqlUpdate, withRepository } from "../services/allegroClient.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { decryptFieldValueSafe, encryptFieldValue } from "../services/fieldEncryption.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateUser, createUser, deleteUser, listUsers, updateUserPassword, updateUserProfile } from "../auth/authStore.js";
import {
  canViewOrganisation,
  canWriteOrganisation,
  canWriteOrganisationData,
  createOrganisation,
  deleteOrganisation,
  deleteOrganisationRdfStructurePreset,
  joinOrganisation,
  leaveOrganisation,
  listMyOrganisations,
  listOrganisations,
  listOrganisationRdfStructurePresets,
  organisationRdfStructureJson,
  organisationRepositoryConfig,
  provisionOrganisationRepository,
  removeUserFromOrganisations,
  rdfStructurePresetJson,
  saveOrganisationRdfStructurePreset,
  upsertOrganisationRole,
  updateOrganisationRdfStructureJson,
  updateOrganisation,
  updateOrganisationMemberRole,
} from "../auth/organisationStore.js";
import { requireAdmin, requireAuth } from "../auth/requireAuth.js";
import { consumeSignUpCode, requestSignUpCode } from "../auth/signUpVerificationStore.js";
import { createSessionToken, sessionCookieName, sessionCookieOptions } from "../auth/tokens.js";
import {
  PREFIXES,
  RDF,
  classTermForEquivalentClass,
  classPropertyTriples,
  defaultRdfStructure,
  legacyDefaultRdfStructure,
  entityIdField,
  equivalentClassValues,
  editableFieldEntries,
  entityIdReplacePattern,
  entityIdReplacePatternForStructure,
  entityIdFromUri,
  entityTemplateValues,
  entityUri,
  expandPrefixedName,
  fieldPatterns,
  groupSubfieldEntries,
  itemReportMetadataTriples,
  isArrayField,
  isGroupField,
  literal,
  nestedGroupUri,
  objectTerm,
  objectFromBinding,
  parseRdfStructureJson,
  pickFields,
  reportItemTriples,
  reportTriples,
  rdfStructureJson,
  rdfTypeTriple,
  selectVariables,
  sparqlTerm,
  triplesFromFields,
  triplesFromNestedGroups,
  applyRdfStructureFromJson,
  triple,
  termToIri,
  applyTemplate,
} from "../rdf/reportRdfConfig.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const COMPILED_REPORTS_DIR = join(DATA_DIR, "compiled-reports");
const REPORT_AUTOMATIONS_DIR = join(DATA_DIR, "report-automations");
const cleanedAppOrganisationMetadataRepositories = new Set();
const automationRunLocks = new Set();

// ---------------------------------------------------------------------------
// General helpers
// ---------------------------------------------------------------------------

function maxNumericBinding(result, variableName) {
  const values = result.results.bindings
    .map(binding => parseInt(binding[variableName]?.value, 10))
    .filter(Number.isFinite);

  return values.length > 0 ? Math.max(...values) : 0;
}

function paginationClause({ limit, offset } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 250) : null;
  const safeOffset = Number.isInteger(offset) && offset > 0 ? offset : 0;
  return [
    safeLimit ? `LIMIT ${safeLimit}` : "",
    safeOffset ? `OFFSET ${safeOffset}` : "",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Compiled report file store
// ---------------------------------------------------------------------------

function compiledReportStoreKey(organisationId) {
  return String(organisationId || "no-organisation").replace(/[^A-Za-z0-9_-]/g, "_");
}

function defaultCompiledReportConfig() {
  return {
    organisationName: "EEPA",
    reportSeriesTitle: "Situation Report EEPA Horn",
    headerNote: "Situation report",
    footerText: "Compiled from SITREP report items.",
    accentColor: "#1f4e79",
    includeFieldLabels: true,
    itemFieldNames: [],
  };
}

function compiledReportFilePath(organisationId) {
  return join(COMPILED_REPORTS_DIR, `${compiledReportStoreKey(organisationId)}.json`);
}

function reportAutomationFilePath(organisationId) {
  return join(REPORT_AUTOMATIONS_DIR, `${compiledReportStoreKey(organisationId)}.json`);
}

async function readCompiledReportStore(organisationId) {
  // Compiled reports are presentation artifacts, so they are kept in JSON files
  // instead of the RDF repository that stores report/report-item data.
  try {
    const json = await readFile(compiledReportFilePath(organisationId), "utf8");
    const store = JSON.parse(json);
    return {
      config: { ...defaultCompiledReportConfig(), ...(store.config || {}) },
      reports: Array.isArray(store.reports) ? store.reports : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { config: defaultCompiledReportConfig(), reports: [] };
  }
}

async function writeCompiledReportStore(organisationId, store) {
  await mkdir(COMPILED_REPORTS_DIR, { recursive: true });
  await writeFile(compiledReportFilePath(organisationId), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function readReportAutomationStore(organisationId) {
  try {
    const json = await readFile(reportAutomationFilePath(organisationId), "utf8");
    const store = JSON.parse(json);
    return {
      schedules: Array.isArray(store.schedules) ? store.schedules.map(reportAutomationPayload) : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { schedules: [] };
  }
}

async function writeReportAutomationStore(organisationId, store) {
  await mkdir(REPORT_AUTOMATIONS_DIR, { recursive: true });
  await writeFile(reportAutomationFilePath(organisationId), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function normalizeCompiledReportConfig(config = {}) {
  const defaults = defaultCompiledReportConfig();
  return {
    ...defaults,
    ...config,
    accentColor: config.accentColor || defaults.accentColor,
    includeFieldLabels: config.includeFieldLabels ?? defaults.includeFieldLabels,
    itemFieldNames: Array.isArray(config.itemFieldNames) ? config.itemFieldNames.filter(Boolean) : defaults.itemFieldNames,
  };
}

function compiledReportPayload(report) {
  return {
    ...report,
    bodyMarkdown: report.bodyMarkdown || "",
    bodyHtml: report.bodyHtml || "",
    selectedItemIds: (report.selectedItemIds || []).map(id => parseInt(id, 10)).filter(Number.isFinite),
    itemFieldNames: Array.isArray(report.itemFieldNames) ? report.itemFieldNames : [],
  };
}

function reportAutomationPayload(schedule = {}) {
  return {
    id: String(schedule.id || Date.now()),
    name: schedule.name || "Automatic report",
    enabled: schedule.enabled !== false,
    intervalMinutes: Math.max(1, parseInt(schedule.intervalMinutes, 10) || 1440),
    itemSelectionMode: schedule.itemSelectionMode === "new-unreported-since-latest-report"
      ? "new-unreported-since-latest-report"
      : "manual",
    selectedItemIds: (schedule.selectedItemIds || []).map(id => parseInt(id, 10)).filter(Number.isFinite),
    reportFieldValues: Array.isArray(schedule.reportFieldValues)
      ? schedule.reportFieldValues.map(field => ({
        name: String(field.name || ""),
        value: field.value === undefined || field.value === null ? null : String(field.value),
      })).filter(field => field.name)
      : [],
    compileEnabled: schedule.compileEnabled !== false,
    compileItemFieldNames: Array.isArray(schedule.compileItemFieldNames) ? schedule.compileItemFieldNames.filter(Boolean) : [],
    compiledConfig: normalizeCompiledReportConfig(schedule.compiledConfig || {}),
    nextRunAt: schedule.nextRunAt || new Date(Date.now() + (parseInt(schedule.intervalMinutes, 10) || 1440) * 60000).toISOString(),
    lastRunAt: schedule.lastRunAt || null,
    lastReportId: schedule.lastReportId || null,
    lastCompiledReportId: schedule.lastCompiledReportId || null,
    lastRunMessage: schedule.lastRunMessage || null,
    createdAt: schedule.createdAt || new Date().toISOString(),
    updatedAt: schedule.updatedAt || new Date().toISOString(),
  };
}

function normalizeReportAutomationInput(input, existing = {}) {
  const intervalMinutes = Math.max(1, parseInt(input.intervalMinutes, 10) || existing.intervalMinutes || 1440);
  const now = new Date();
  return reportAutomationPayload({
    ...existing,
    id: existing.id || `${Date.now()}`,
    name: String(input.name || existing.name || "Automatic report").trim() || "Automatic report",
    enabled: input.enabled,
    intervalMinutes,
    itemSelectionMode: input.itemSelectionMode,
    selectedItemIds: input.selectedItemIds || [],
    reportFieldValues: input.reportFieldValues || [],
    compileEnabled: input.compileEnabled,
    compileItemFieldNames: input.compileItemFieldNames || [],
    compiledConfig: normalizeCompiledReportConfig(input.compiledConfig || existing.compiledConfig || {}),
    nextRunAt: existing.nextRunAt || nextAutomationRunAt(now, intervalMinutes),
    createdAt: existing.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  });
}

function nextAutomationRunAt(fromDate, intervalMinutes) {
  return new Date(fromDate.getTime() + Math.max(1, parseInt(intervalMinutes, 10) || 1440) * 60000).toISOString();
}

function numericReportItemIds(report = {}) {
  return (report.selectedItemIds || []).map(id => parseInt(id, 10)).filter(Number.isFinite);
}

function latestReportByCreatedAt(reports = []) {
  return [...reports].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || "") || 0;
    const rightTime = Date.parse(right.createdAt || "") || 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return (parseInt(right.id, 10) || 0) - (parseInt(left.id, 10) || 0);
  })[0] || null;
}

function automaticReportItemIds(schedule, reports, reportItems) {
  if (schedule.itemSelectionMode !== "new-unreported-since-latest-report") {
    return schedule.selectedItemIds || [];
  }

  const reportedIds = new Set(reports.flatMap(numericReportItemIds));
  const latestReport = latestReportByCreatedAt(reports);
  const latestReportCreatedAt = Date.parse(latestReport?.createdAt || "") || 0;
  const latestReportMaxItemId = Math.max(0, ...numericReportItemIds(latestReport));

  return reportItems
    .filter(item => {
      const itemId = parseInt(item.entryNumber, 10);
      if (!Number.isFinite(itemId) || reportedIds.has(itemId)) return false;
      const itemCreatedAt = Date.parse(item.createdAt || "") || 0;
      return itemCreatedAt && latestReportCreatedAt
        ? itemCreatedAt > latestReportCreatedAt
        : itemId > latestReportMaxItemId;
    })
    .map(item => parseInt(item.entryNumber, 10))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
}

function displayFieldValue(fieldValues = [], name) {
  return fieldValues.find(field => field.name === name)?.value;
}

function reportDisplayNumber(report) {
  return displayFieldValue(report?.fieldValues || [], "reportNumber") || report?.id || "";
}

function reportDisplayTitle(report) {
  return displayFieldValue(report?.fieldValues || [], "title")
    || displayFieldValue(report?.fieldValues || [], "reportTitle")
    || `Report ${report?.id || ""}`.trim();
}

function compiledBodyMarkdown({ report, items, config, selectedItemIds, itemFieldNames }) {
  const includedNames = new Set(itemFieldNames || []);
  const itemsById = new Map(items.map(item => [parseInt(item.entryNumber, 10), item]));
  return selectedItemIds
    .map(itemId => itemsById.get(parseInt(itemId, 10)))
    .filter(Boolean)
    .map((item, index) => {
      const title = displayFieldValue(item.fieldValues || [], "title") || `Report item ${item.entryNumber}`;
      const paragraph = displayFieldValue(item.fieldValues || [], "paragraph") || title;
      const details = (item.fieldValues || [])
        .filter(field => field.value && includedNames.has(field.name))
        .filter(field => field.name !== "paragraph" && field.name !== "title")
        .map(field => config.includeFieldLabels ? `**${field.label || field.name}:** ${field.value}` : field.value);
      return [`## ${index + 1}. ${title}`, paragraph, ...details].filter(Boolean).join("\n\n");
    })
    .join("\n\n") || `No report items selected for ${reportDisplayTitle(report)}.`;
}

function markdownToHtml(markdown) {
  return String(markdown || "")
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      if (block.startsWith("## ")) return `<h2>${block.slice(3)}</h2>`;
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

async function createCompiledReportForReport(report, selectedItemIds, itemFieldNames, config, organisationId) {
  const store = await readCompiledReportStore(organisationId);
  const title = `${config.reportSeriesTitle || "Situation Report"} No. ${reportDisplayNumber(report) || report.id}`;
  const subtitle = reportDisplayTitle(report);
  const items = await resolvers.Query.reportItems(null, { organisationId }, systemContext());
  const bodyMarkdown = compiledBodyMarkdown({ report, items, config, selectedItemIds, itemFieldNames });
  const now = new Date().toISOString();
  const compiled = compiledReportPayload({
    id: `${Date.now()}`,
    sourceReportId: report.id,
    title,
    subtitle,
    executiveSummary: `${selectedItemIds.length} report item${selectedItemIds.length === 1 ? "" : "s"} compiled from ${subtitle}.`,
    bodyMarkdown,
    bodyHtml: markdownToHtml(bodyMarkdown),
    selectedItemIds,
    itemFieldNames,
    configSnapshot: JSON.stringify(config),
    createdAt: now,
    updatedAt: now,
  });
  await writeCompiledReportStore(organisationId, {
    ...store,
    reports: [compiled, ...store.reports],
  });
  return compiled;
}

async function executeReportAutomation(organisationId, schedule, context = systemContext()) {
  const reports = await resolvers.Query.reports(null, { organisationId }, context);
  const reportItems = await resolvers.Query.reportItems(null, { organisationId }, context);
  const selectedItemIds = automaticReportItemIds(schedule, reports, reportItems);
  const createdReport = await resolvers.Mutation.createReportFromFields(null, {
    fieldValues: schedule.reportFieldValues,
    selectedItemIds,
    organisationId,
  }, context);

  let compiledReport = null;
  if (schedule.compileEnabled) {
    compiledReport = await createCompiledReportForReport(
      createdReport,
      selectedItemIds,
      schedule.compileItemFieldNames || [],
      normalizeCompiledReportConfig(schedule.compiledConfig || {}),
      organisationId
    );
  }

  return {
    report: createdReport,
    compiledReport,
    selectedItemIds,
  };
}

function systemContext() {
  return {
    currentUser: {
      id: "system-report-automation",
      email: "system@sitrep.local",
      name: "Report automation",
      role: "admin",
    },
  };
}

// ---------------------------------------------------------------------------
// Linked entity allocation and validation
// ---------------------------------------------------------------------------

function sparqlVariableName(fieldName, field = {}) {
  return field.variable || String(fieldName).replace(/[^A-Za-z0-9_]/g, "_");
}

function optionKeyFromStoredValue(field, storedValue) {
  if (!storedValue) return storedValue;
  const match = Object.entries(field.options || {}).find(([optionName, option]) => {
    const optionValue = option.value || optionName;
    return storedValue === optionName
      || storedValue === optionValue
      || storedValue === expandPrefixedName(optionValue);
  });
  return match?.[0] || storedValue;
}

function isUriLikeValue(value) {
  const text = String(value || "").trim();
  return text.startsWith("<")
    || /^https?:\/\//i.test(text)
    || /^[A-Za-z][\w-]*:/.test(text);
}

function iriText(value) {
  return termToIri(String(value || "").trim())?.replace(/^<|>$/g, "") || "";
}

function valueMatchesTargetEntityUri(field, value) {
  if (!field.targetEntityType) return false;
  const targetBase = entityIdReplacePattern(field.targetEntityType);
  return !!targetBase && iriText(value).startsWith(targetBase);
}

function targetLabelFieldStoresUri(field) {
  const targetField = RDF[field.targetEntityType]?.fields?.[field.targetLabelField];
  return targetField?.objectType === "uri";
}

async function linkedEntityUriExists(field, value) {
  const subject = termToIri(String(value || "").trim());
  const className = field.targetClass || RDF.classes?.[field.targetEntityType];
  const result = await runSparqlQuery(`${PREFIXES}
    SELECT ?entity WHERE {
      BIND(${subject} AS ?entity)
      ${className ? `?entity rdf:type ${sparqlTerm(className)} .` : "?entity ?p ?o ."}
    }
    LIMIT 1
  `);
  return result.results.bindings.length > 0;
}

async function nextEntityId(entityType) {
  // IDs can exist both as explicit fields and inside URI templates, so inspect
  // both sources and allocate one higher than the current maximum.
  const idFieldName = entityIdField(entityType);
  const idField = RDF[entityType]?.fields?.[idFieldName];
  const className = RDF.classes?.[entityType];
  const idValues = [];

  if (idField?.predicate && className) {
    const fieldResult = await runSparqlQuery(`${PREFIXES}
      SELECT ?id WHERE {
        ?entity rdf:type ${sparqlTerm(className)} ;
                ${sparqlTerm(idField.predicate)} ?id .
      }
    `);
    idValues.push(maxNumericBinding(fieldResult, "id"));
  }

  if (className && RDF.uriTemplates?.[entityType]) {
    const uriResult = await runSparqlQuery(`${PREFIXES}
      SELECT ?id WHERE {
        ?entity rdf:type ${sparqlTerm(className)} .
        BIND(REPLACE(STR(?entity), "${entityIdReplacePattern(entityType)}", "") AS ?idText)
        FILTER(REGEX(?idText, "^[0-9]+$"))
        BIND(xsd:integer(?idText) AS ?id)
      }
    `);
    idValues.push(maxNumericBinding(uriResult, "id"));
  }

  return Math.max(0, ...idValues) + 1;
}

function fieldValidationError(fieldName, message) {
  return new Error(`FIELD_VALIDATION:${fieldName}:${message}`);
}

function linkedEntityGroupKey(field = {}) {
  const targetEntityType = field.targetEntityType;
  if (!targetEntityType) return null;
  return [
    targetEntityType,
    field.targetTemplate || RDF.uriTemplates?.[targetEntityType] || "",
    field.targetClass || RDF.classes?.[targetEntityType] || "",
  ].join("|");
}

function fieldHasInputValue(value) {
  if (Array.isArray(value)) return value.some(Boolean);
  if (value && typeof value === "object") {
    return Object.values(value).some(fieldHasInputValue);
  }
  return String(value || "").trim() !== "";
}

function groupFieldAllowsMultiple(field = {}) {
  // Group read shape must match write shape: imported classes are repeated only
  // when the RDF structure explicitly enables multiple instances.
  return !!field.allowMultiple;
}

function linkedFieldEntriesForSharedEntity(fields = {}) {
  return Object.entries(fields || {})
    .filter(([, field]) => field && typeof field === "object")
    .filter(([, field]) => (
      field.createEntityFromInput
      || (isGroupField(field) && field.targetEntityType)
    ))
    .map(([fieldName, field]) => [fieldName, field, linkedEntityGroupKey(field)])
    .filter(([, , key]) => key);
}

async function sharedLinkedEntityIdsForFields(fields = {}, data = {}, nextIds) {
  // Multiple fields in the same form can describe the same new linked resource;
  // allocate one ID and share it across those fields.
  const entriesByKey = new Map();
  for (const [fieldName, field, key] of linkedFieldEntriesForSharedEntity(fields)) {
    if (!fieldHasInputValue(data[fieldName])) continue;
    entriesByKey.set(key, [...(entriesByKey.get(key) || []), field]);
  }

  const sharedIds = new Map();
  for (const [key, entries] of entriesByKey.entries()) {
    if (entries.length < 2) continue;
    const targetEntityType = entries[0].targetEntityType;
    if (!nextIds.has(targetEntityType)) {
      nextIds.set(targetEntityType, await nextEntityId(targetEntityType));
    }
    const id = nextIds.get(targetEntityType);
    nextIds.set(targetEntityType, id + 1);
    sharedIds.set(key, id);
  }
  return sharedIds;
}

async function allocateEntityInput(fieldName, field, value, nextIds, sharedId = null) {
  // Linked-field user input can be either an existing URI or text that should
  // create a new target entity.
  if (!field.createEntityFromInput) return value;
  const targetEntityType = field.targetEntityType;
  if (!targetEntityType) return value;

  const values = Array.isArray(value)
    ? value.filter(Boolean)
    : String(value || "").split(/[\n,]+/).map(item => item.trim()).filter(Boolean);

  const allocatedValues = [];
  for (const label of values) {
    if (isUriLikeValue(label)) {
      if (await linkedEntityUriExists(field, label)) {
        allocatedValues.push({ uri: String(label).trim() });
        continue;
      }
      if (valueMatchesTargetEntityUri(field, label) || !targetLabelFieldStoresUri(field)) {
        throw fieldValidationError(
          fieldName,
          `Please enter an existing ${targetEntityType} URI or type a new value.`
        );
      }
    }

    if (!sharedId && !nextIds.has(targetEntityType)) {
      nextIds.set(targetEntityType, await nextEntityId(targetEntityType));
    }
    const id = sharedId || nextIds.get(targetEntityType);
    if (!sharedId) {
      nextIds.set(targetEntityType, id + 1);
    }
    allocatedValues.push({ id, label });
  }

  return field.allowMultiple || field.inputType === "uri-list" || field.inputType === "text-list"
    ? allocatedValues
    : allocatedValues[0];
}

function groupInputObject(group, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...value };
  const labelFieldName = group.targetLabelField
    || groupSubfieldEntries(group).find(([fieldName]) => fieldName === "name")?.[0]
    || groupSubfieldEntries(group)[0]?.[0]
    || "name";
  return value === undefined || value === null || value === "" ? {} : { [labelFieldName]: value };
}

async function allocateGroupInput(group, value, nextIds, sharedId = null) {
  const groupValues = group.allowMultiple
    ? (Array.isArray(value) ? value : (value ? [value] : []))
    : [value || {}];
  const allocatedValues = [];

  for (const groupValue of groupValues) {
    const groupData = groupInputObject(group, groupValue);
    if (!fieldHasInputValue(groupData)) continue;

    if (group.targetEntityType && groupData.id === undefined) {
      if (sharedId) {
        groupData.id = sharedId;
      } else {
        if (!nextIds.has(group.targetEntityType)) {
          nextIds.set(group.targetEntityType, await nextEntityId(group.targetEntityType));
        }
        groupData.id = nextIds.get(group.targetEntityType);
        nextIds.set(group.targetEntityType, groupData.id + 1);
      }
    }

    allocatedValues.push(await allocateCreatedEntityInputsForFields(group, groupData, nextIds));
  }

  return group.allowMultiple ? allocatedValues : (allocatedValues[0] || value);
}

async function allocateCreatedEntityInputs(entityType, data, nextIds = new Map()) {
  // Walk the active RDF field structure and replace user-facing labels with the
  // IDs/URI objects needed by triple generation.
  const nextData = { ...data };
  const entity = RDF[entityType] || {};
  const sharedLinkedEntityIds = await sharedLinkedEntityIdsForFields(entity.fields || {}, nextData, nextIds);

  for (const [fieldName, field] of Object.entries(entity.fields || {})) {
    const sharedId = sharedLinkedEntityIds.get(linkedEntityGroupKey(field));
    if (isGroupField(field)) {
      nextData[fieldName] = await allocateGroupInput(field, nextData[fieldName], nextIds, sharedId);
      continue;
    }
    if (field.options) {
      const conditionalValue = nextData[fieldName];
      const selectedOption = typeof conditionalValue === "object" ? conditionalValue?.selectedOption : conditionalValue;
      const option = field.options?.[selectedOption];
      if (!option || typeof conditionalValue !== "object") continue;

      nextData[fieldName] = {
        ...conditionalValue,
        values: await allocateCreatedEntityInputsForFields(option.fields || {}, conditionalValue.values || {}, nextIds),
      };
      continue;
    }
    nextData[fieldName] = await allocateEntityInput(fieldName, field, nextData[fieldName], nextIds);
  }

  return nextData;
}

async function allocateCreatedEntityInputsForFields(fields, data, nextIds) {
  const nextData = { ...data };
  for (const [fieldName, field] of Object.entries(fields || {})) {
    if (!field || typeof field !== "object" || !field.predicate) continue;
    if (isGroupField(field)) {
      nextData[fieldName] = await allocateGroupInput(field, nextData[fieldName], nextIds);
      continue;
    }
    nextData[fieldName] = await allocateEntityInput(fieldName, field, nextData[fieldName], nextIds);
  }
  return nextData;
}

// ---------------------------------------------------------------------------
// RDF loading and conversion helpers
// ---------------------------------------------------------------------------

async function getReportMetadata(reportId) {
  const subject = entityUri("report", reportId);
  const reportFields = queryFields(RDF.report.fields, []);
  const result = await runSparqlQuery(`${PREFIXES}
    SELECT ${selectVariables(reportFields)} WHERE {
      ${subject} rdf:type ${RDF.classes.report} .
      ${fieldPatterns(subject, reportFields)}
    }
  `);

  const binding = result.results.bindings[0];
  if (!binding) return null;
  const report = objectFromBinding(binding, reportFields);
  const primaryReportValue = editableFieldEntries("report")
    .map(field => report[field.name])
    .find(Boolean);

  return {
    id: parseInt(reportId, 10),
    title: report.title || primaryReportValue || `Report ${reportId}`,
    reportNumber: report.reportNumber || parseInt(reportId, 10),
    reportDate: report.reportDate,
  };
}

async function clearItemReportMetadata(itemId) {
  const subject = entityUri("reportItem", itemId);
  const reportItemMetadataFields = pickFields(RDF.reportItem.fields, RDF.itemReportMetadataFields);
  if (Object.keys(reportItemMetadataFields).length === 0) return;
  const deletes = Object.entries(reportItemMetadataFields)
    .map(([fieldName, field]) => `DELETE WHERE { ${sparqlTerm(subject)} ${sparqlTerm(field.predicate)} ?${fieldName} . }`)
    .join(";\n");

  await runSparqlUpdate(`${PREFIXES}
    ${deletes}
  `);
}

async function deleteNestedGroupTriplesForSubject(entityType, subject) {
  // Nested groups are represented as their own resources, so entity updates must
  // remove those resources before inserting the replacement field set.
  const deletes = Object.entries(RDF[entityType]?.fields || {})
    .filter(([, group]) => isGroupField(group))
    .filter(([, group]) => group?.resourceMode !== "reusable")
    .map(([groupName, group]) => {
      if (group.targetEntityType && group.predicate) {
        return `DELETE {
          ?groupSubject ?p ?o .
        }
        WHERE {
          ${sparqlTerm(subject)} ${sparqlTerm(group.predicate)} ?groupSubject .
          ?groupSubject ?p ?o .
        }`;
      }
      return `DELETE WHERE { ${sparqlTerm(nestedGroupUri(subject, groupName))} ?p ?o . }`;
    })
    .join(";\n");
  if (!deletes) return;

  await runSparqlUpdate(`${PREFIXES}
    ${deletes}
  `);
}

async function deleteNestedGroupTriples(entityType, id) {
  await deleteNestedGroupTriplesForSubject(entityType, entityUri(entityType, id));
}

async function setItemReportMetadata(itemId, report) {
  if (!RDF.itemReportMetadataFields?.length) return;
  await clearItemReportMetadata(itemId);
  await runSparqlUpdate(`${PREFIXES}
    INSERT DATA {
      ${itemReportMetadataTriples(itemId, report)}
    }
  `);
}

function valueFromTerm(term = {}) {
  return term.value;
}

async function loadFieldValueForSubject(subject, legacySubject, fieldName, field) {
  const variable = sparqlVariableName(fieldName, field);
  const result = await runSparqlQuery(`${PREFIXES}
    SELECT ?${variable} WHERE {
      ${field.predicate ? `OPTIONAL { ${sparqlTerm(subject)} ${sparqlTerm(field.predicate)} ?${variable}Grouped . }` : ""}
      ${legacySubject && field.predicate ? `OPTIONAL { ${sparqlTerm(legacySubject)} ${sparqlTerm(field.predicate)} ?${variable}Legacy . }` : ""}
      ${legacySubject ? `BIND(COALESCE(?${variable}Grouped, ?${variable}Legacy) AS ?${variable})` : `BIND(?${variable}Grouped AS ?${variable})`}
    }
  `);
  const values = result.results.bindings
    .map(binding => valueFromTerm(binding[variable]))
    .filter(Boolean);
  if (isArrayField(field)) return values;
  return values[0];
}

async function loadConditionalFieldForSubject(subject, legacySubject, fieldName, field) {
  const storedValue = await loadFieldValueForSubject(subject, legacySubject, fieldName, field);
  if (!storedValue) return null;
  const selectedOption = optionKeyFromStoredValue(field, storedValue);
  const option = field.options?.[selectedOption];
  return {
    selectedOption,
    values: option ? await loadFieldsForSubject(subject, option.fields || {}, legacySubject) : {},
  };
}

async function loadGroupSubjects(parentSubject, groupName, group) {
  if (!group.predicate) return [nestedGroupUri(parentSubject, groupName)];
  const result = await runSparqlQuery(`${PREFIXES}
    SELECT ?groupSubject WHERE {
      ${sparqlTerm(parentSubject)} ${sparqlTerm(group.predicate)} ?groupSubject .
    }
  `);
  const subjects = result.results.bindings
    .map(binding => binding.groupSubject?.value)
    .filter(Boolean)
    .map(value => termToIri(value));
  return subjects.length > 0 ? subjects : [nestedGroupUri(parentSubject, groupName)];
}

async function loadLinkedGroupId(group, groupSubject) {
  if (!group.targetEntityType) return undefined;
  const idFieldName = entityIdField(group.targetEntityType);
  const idField = RDF[group.targetEntityType]?.fields?.[idFieldName];
  if (idField?.predicate) {
    const result = await runSparqlQuery(`${PREFIXES}
      SELECT ?id WHERE {
        ${sparqlTerm(groupSubject)} ${sparqlTerm(idField.predicate)} ?id .
      }
      LIMIT 1
    `);
    const idValue = result.results.bindings[0]?.id?.value;
    if (idValue !== undefined) return idValue;
  }
  try {
    return entityIdFromUri(group.targetEntityType, String(groupSubject).replace(/^<|>$/g, ""));
  } catch {
    return undefined;
  }
}

async function loadGroupValueForSubject(parentSubject, groupName, group) {
  const groupSubjects = await loadGroupSubjects(parentSubject, groupName, group);
  const groupValues = [];
  const groupFields = Object.fromEntries(groupSubfieldEntries(group));

  for (const groupSubject of groupSubjects) {
    const groupData = await loadFieldsForSubject(groupSubject, groupFields, parentSubject);
    const id = await loadLinkedGroupId(group, groupSubject);
    if (id !== undefined) groupData.id = id;
    if (fieldHasInputValue(groupData)) groupValues.push(groupData);
  }

  return groupFieldAllowsMultiple(group) ? groupValues : (groupValues[0] || null);
}

async function loadFieldsForSubject(subject, fields = {}, legacySubject = null) {
  // Load scalar, conditional, and grouped values according to the active RDF
  // structure, including legacy subject fallback during migrations.
  const data = {};
  for (const [fieldName, field] of Object.entries(fields || {})) {
    if (!field || typeof field !== "object" || !field.predicate) continue;
    if (isGroupField(field)) {
      const groupValue = await loadGroupValueForSubject(subject, fieldName, field);
      if (groupValue !== null && groupValue !== undefined) data[fieldName] = groupValue;
      continue;
    }
    if (field.options) {
      const conditionalValue = await loadConditionalFieldForSubject(subject, legacySubject, fieldName, field);
      if (conditionalValue) data[fieldName] = conditionalValue;
      continue;
    }
    const value = await loadFieldValueForSubject(subject, legacySubject, fieldName, field);
    if (value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0)) {
      data[fieldName] = value;
    }
  }
  return data;
}

async function loadReportItemCollections(item) {
  const subject = entityUri("reportItem", item.entryNumber);

  for (const [fieldName, field] of Object.entries(RDF.reportItem.fields || {}).filter(([, field]) => isArrayField(field) && !field.options)) {
    const variable = sparqlVariableName(fieldName, field);
    const pattern = `${sparqlTerm(subject)} ${sparqlTerm(field.predicate)} ?${variable} .`;
    const result = await runSparqlQuery(`${PREFIXES}
      SELECT ?${variable} WHERE {
        ${pattern}
      }
    `);
    item[fieldName] = result.results.bindings.map(binding => binding[variable].value);
  }

  for (const [groupName, group] of Object.entries(RDF.reportItem.fields || {}).filter(([, field]) => isGroupField(field))) {
    item[groupName] = await loadGroupValueForSubject(subject, groupName, group);
  }

  for (const [fieldName, field] of Object.entries(RDF.reportItem.fields || {})) {
    if (!field.options || !item[fieldName]) continue;

    const conditionalValue = await loadConditionalFieldForSubject(subject, null, fieldName, field);
    if (conditionalValue) item[fieldName] = conditionalValue;
  }

  return item;
}

function reportItemFromBinding(binding) {
  const item = objectFromBinding(binding, RDF.reportItem.fields);
  return {
    uri: expandPrefixedName(entityUri("reportItem", item.entryNumber)),
    ...item,
    ...Object.fromEntries(Object.entries(RDF.reportItem.fields || {}).filter(([, field]) => isArrayField(field) && !field.options).map(([fieldName]) => [fieldName, []])),
    ...Object.fromEntries(Object.entries(RDF.reportItem.fields || {}).filter(([, field]) => isGroupField(field)).map(([fieldName]) => [fieldName, null])),
  };
}

function reportSelectedItemsField() {
  return RDF.report.fields?.selectedItems || {
    predicate: "sitrep:hasReportItem",
    objectType: "uri",
    targetTemplate: "resource:ReportItem_{entryNumber}",
  };
}

async function loadReportSelectedItemIds(report, subject) {
  const selectedItemsField = reportSelectedItemsField();
  const variableName = selectedItemsField.objectType === "uri" ? "item" : "itemId";
  const itemResult = await runSparqlQuery(`${PREFIXES}
    SELECT ?${variableName} WHERE {
      ${subject} ${selectedItemsField.predicate} ?${variableName} .
    }
  `);
  report.selectedItemIds = itemResult.results.bindings
    .map(binding => {
      const value = binding[variableName].value;
      return selectedItemsField.objectType === "uri"
        ? parseInt(entityIdFromUri("reportItem", value), 10)
        : parseInt(value, 10);
    })
    .filter(Number.isFinite);
  return report;
}

function reportFromBinding(binding, id) {
  const reportId = parseInt(id, 10);
  if (!Number.isFinite(reportId)) return null;
  return {
    id: reportId,
    ...objectFromBinding(binding, RDF.report.fields),
    selectedItemIds: [],
  };
}

function rdfEntityFromObject(entityType, entity) {
  // Convert internal entity objects into the generic GraphQL entity shape used by
  // the Items page for custom classes.
  const idFieldName = entityIdField(entityType);
  const id = entity[idFieldName] ?? entity.id ?? "";
  const uri = entity.uri || expandPrefixedName(entityUri(entityType, id));
  return {
    entityType,
    id: String(id),
    uri,
    className: RDF.classes?.[entityType] || null,
    fieldValues: fieldValuesForEntity(entityType, entity),
  };
}

function idFromEntityBinding(entityType, uri, entity) {
  const idFieldName = entityIdField(entityType);
  const fieldValue = entity[idFieldName];
  if (fieldValue !== undefined && fieldValue !== null && fieldValue !== "") return fieldValue;
  try {
    return entityIdFromUri(entityType, uri);
  } catch {
    return uri;
  }
}

function mergeEntityBindingData(target, fields, binding) {
  const values = objectFromBinding(binding, fields);
  for (const [fieldName, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const field = fields[fieldName];
    if (isArrayField(field) || field?.inputType === "import-class" || field?.resourceMode === "per-instance") {
      const currentValues = Array.isArray(target[fieldName])
        ? target[fieldName]
        : (target[fieldName] ? [target[fieldName]] : []);
      if (!currentValues.includes(value)) {
        target[fieldName] = [...currentValues, value];
      }
      continue;
    }
    target[fieldName] = target[fieldName] ?? value;
  }
}

async function loadEntityGroupFields(entityType, entityData) {
  const subject = termToIri(entityData.uri);
  for (const [groupName, group] of Object.entries(RDF[entityType]?.fields || {}).filter(([, field]) => isGroupField(field))) {
    const subfields = groupSubfieldEntries(group);
    if (subfields.length === 0) continue;

    const groupSubjectVariable = `${sparqlVariableName(groupName, group)}Subject`;
    const variables = subfields.map(([fieldName, field]) => sparqlVariableName(fieldName, field));
    const optionalPatterns = subfields.map(([fieldName, field]) => {
      const variable = sparqlVariableName(fieldName, field);
      return `
        OPTIONAL { ?${groupSubjectVariable} ${sparqlTerm(field.predicate)} ?${variable}Grouped . }
        OPTIONAL { ${sparqlTerm(subject)} ${sparqlTerm(field.predicate)} ?${variable}Direct . }
        BIND(COALESCE(?${variable}Grouped, ?${variable}Direct) AS ?${variable})
      `;
    }).join("\n");

    const result = await runSparqlQuery(`${PREFIXES}
      SELECT ${variables.map(variable => `?${variable}`).join(" ")} WHERE {
        ${group.predicate ? `OPTIONAL { ${sparqlTerm(subject)} ${sparqlTerm(group.predicate)} ?${groupSubjectVariable}Linked . }` : ""}
        BIND(COALESCE(?${groupSubjectVariable}Linked, ${sparqlTerm(subject)}) AS ?${groupSubjectVariable})
        ${optionalPatterns}
      }
    `);

    const groupData = {};
    for (const binding of result.results.bindings) {
      subfields.forEach(([fieldName, field]) => {
        const variable = sparqlVariableName(fieldName, field);
        const value = binding[variable]?.value;
        if (!value) return;
        if (isArrayField(field)) {
          const currentValues = Array.isArray(groupData[fieldName]) ? groupData[fieldName] : [];
          if (!currentValues.includes(value)) groupData[fieldName] = [...currentValues, value];
        } else {
          groupData[fieldName] = groupData[fieldName] ?? value;
        }
      });
    }

    entityData[groupName] = Object.keys(groupData).length > 0 ? groupData : null;
  }
  return entityData;
}

async function rdfEntitiesForType(entityType, organisationId, context, pagination = {}) {
  // Built-in report/reportItem entities have specialized queries; custom entity
  // types use a generic class-based SPARQL query.
  await requireOrganisationView(context, organisationId);
  return withOrganisationRepository(organisationId, async () => {
  if (!RDF.classes?.[entityType]) throw new Error(`Unknown RDF entity type: ${entityType}`);
  if (entityType === "report") return [];
  if (entityType === "reportItem") {
    const items = await resolvers.Query.reportItems(null, { organisationId, ...pagination }, context);
    return items.map(item => rdfEntityFromObject("reportItem", item));
  }

  const entity = RDF[entityType] || {};
  const fields = genericEntityQueryFields(entity.fields || {});
  const variables = selectVariables(fields);
  const sparqlQuery = `${PREFIXES}
    SELECT ?entity ${variables}
    WHERE {
      {
        SELECT ?entity WHERE {
          ?entity rdf:type ${sparqlTerm(RDF.classes[entityType])} .
        }
        ORDER BY DESC(STR(?entity))
        ${paginationClause(pagination)}
      }
      ${fieldPatterns("?entity", fields)}
    }
    ORDER BY DESC(STR(?entity))
  `;

  const result = await runSparqlQuery(sparqlQuery);
  const entitiesByUri = new Map();

  result.results.bindings.forEach(binding => {
    const uri = binding.entity.value;
    const entityData = entitiesByUri.get(uri) || { uri };
    mergeEntityBindingData(entityData, fields, binding);
    entitiesByUri.set(uri, entityData);
  });

  const entityDataList = [];
  for (const entityData of entitiesByUri.values()) {
    entityDataList.push(await loadEntityGroupFields(entityType, entityData));
  }

  return entityDataList.map(entityData => {
    const id = idFromEntityBinding(entityType, entityData.uri, entityData);
    return rdfEntityFromObject(entityType, { ...entityData, [entityIdField(entityType)]: id });
  });
  });
}

async function rdfEntityCountForType(entityType, organisationId, context) {
  await requireOrganisationView(context, organisationId);
  return withOrganisationRepository(organisationId, async () => {
    if (!RDF.classes?.[entityType]) throw new Error(`Unknown RDF entity type: ${entityType}`);
    if (entityType === "report") return 0;
    if (entityType === "reportItem") return resolvers.Query.reportItemCount(null, { organisationId }, context);

    const result = await runSparqlQuery(`${PREFIXES}
      SELECT (COUNT(DISTINCT ?entity) AS ?count)
      WHERE {
        ?entity rdf:type ${sparqlTerm(RDF.classes[entityType])} .
      }
    `);
    return parseInt(result.results.bindings[0]?.count?.value || "0", 10);
  });
}

function subjectFromEntityIdentifier(entityType, id, uri) {
  return uri ? termToIri(uri) : entityUri(entityType, id);
}

function scopedSubjectDelete(subject) {
  return `DELETE {
    ${subject} ?p ?o .
  }
  WHERE {
    ${subject} ?p ?o .
  }`;
}

function reportItemLinkDelete(itemId) {
  const selectedItemsField = reportSelectedItemsField();
  const selectedItemValue = selectedItemsField.targetTemplate
    ? applyTemplate(selectedItemsField.targetTemplate, { entryNumber: itemId, id: itemId })
    : itemId;
  const candidateObjects = [
    objectTerm(selectedItemValue, selectedItemsField),
    objectTerm(itemId, selectedItemsField),
    objectTerm(itemId, { datatype: "xsd:integer" }),
    objectTerm(String(itemId), {}),
  ].filter(Boolean);
  const values = [...new Set(candidateObjects)].join(" ");

  return `DELETE {
    ?report ${selectedItemsField.predicate} ?deletedItemObject .
  }
  WHERE {
    VALUES ?deletedItemObject { ${values} }
    ?report ${selectedItemsField.predicate} ?deletedItemObject .
  }`;
}

// ---------------------------------------------------------------------------
// Organisation scoping and active RDF structures
// ---------------------------------------------------------------------------

async function requireOrganisationView(context, organisationId) {
  const user = requireAuth(context);
  if (user.role === "admin" && !organisationId) return user;
  if (!organisationId) throw new Error("An organisation is required.");
  if (!(await canViewOrganisation(user, organisationId))) {
    throw new Error("You are not part of this organisation.");
  }
  return user;
}

async function requireOrganisationWrite(context, organisationId) {
  const user = requireAuth(context);
  if (user.role === "admin" && !organisationId) return user;
  if (!organisationId) throw new Error("An organisation is required.");
  if (!(await canWriteOrganisation(user, organisationId))) {
    throw new Error("You must be an organisation member or owner to change data.");
  }
  return user;
}

async function withOrganisationRepository(organisationId, callback) {
  // Every organisation can use its own AllegroGraph repository and RDF structure;
  // this wrapper activates both for the duration of one resolver operation.
  const repositoryConfig = await organisationRepositoryConfig(organisationId);
  await applyOrganisationRdfStructure(organisationId);
  return withRepository(repositoryConfig, async () => {
    await deleteAppOrganisationMetadata(organisationId);
    return callback();
  });
}

async function applyOrganisationRdfStructure(organisationId) {
  const structureJson = await organisationRdfStructureJson(organisationId);
  applyRdfStructureFromJson(structureJson || JSON.stringify(organisationId ? legacyDefaultRdfStructure() : defaultRdfStructure()));
}

async function deleteAppOrganisationMetadata(organisationId) {
  const cleanupKey = organisationId || "no-organisation";
  if (cleanedAppOrganisationMetadataRepositories.has(cleanupKey)) return;
  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?subject sitrep:organisationId ?organisationId .
    }
    WHERE {
      ?subject sitrep:organisationId ?organisationId .
      FILTER(DATATYPE(?organisationId) != xsd:integer)
    }
  `);
  cleanedAppOrganisationMetadataRepositories.add(cleanupKey);
}

function rdfStructurePayload() {
  return {
    json: rdfStructureJson(),
    reportItemFields: editableFieldEntries("reportItem"),
    reportFields: editableFieldEntries("report"),
  };
}

function presetScopeOrganisationId(organisationId, scope) {
  return scope === "global" ? null : organisationId;
}

function isGlobalPresetScope(scope) {
  return scope === "global";
}

async function updateActiveRdfStructure(organisationId, json) {
  // Structure changes update the active in-memory structure, migrate stored RDF
  // where possible, and then persist the structure for that organisation.
  const oldStructure = JSON.parse(rdfStructureJson());
  const nextStructure = encryptSourceFieldsInStructure(parseRdfStructureJson(json));
  await migrateStoredRdf(oldStructure, nextStructure);
  applyRdfStructureFromJson(JSON.stringify(nextStructure));
  await updateOrganisationRdfStructureJson(organisationId, JSON.stringify(nextStructure));
  await syncEquivalentClassTriples(nextStructure);
  return rdfStructurePayload();
}

// ---------------------------------------------------------------------------
// Field payload encryption and GraphQL serialization
// ---------------------------------------------------------------------------

function parseFieldValue(field, value) {
  if (value === null || value === undefined) return value;
  if (field.kind === "array") return JSON.parse(value);
  if (field.kind === "group" || field.kind === "location" || field.kind === "importClass") return JSON.parse(value);
  if (field.kind === "conditional") return JSON.parse(value);
  if (field.datatype === "xsd:integer") return parseInt(value, 10);
  return value;
}

function dataFromFieldValues(entityType, fieldValues) {
  const fieldMap = new Map((fieldValues || []).map(field => [field.name, field.value]));
  return Object.fromEntries(
    editableFieldEntries(entityType).map(field => [
      field.name,
      fieldMap.has(field.name)
        ? encryptDataForField(field, parseFieldValue(field, fieldMap.get(field.name)))
        : undefined,
    ])
  );
}

function encryptDataForField(field, value) {
  if (!field.encrypted || value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map(item => encryptFieldValue(item));
  return encryptFieldValue(value);
}

function decryptDataForField(field, value) {
  if (!field.encrypted || value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map(item => decryptFieldValueSafe(item));
  return decryptFieldValueSafe(value);
}

function encryptSourceFieldsInStructure(structure) {
  // Source fields are sensitive by design, so the structure marks them encrypted
  // even if an imported preset omitted that flag.
  const visitFields = (fields = {}) => Object.fromEntries(
    Object.entries(fields).map(([fieldName, field]) => {
      if (!field || typeof field !== "object") return [fieldName, field];
      const nextField = {
        ...field,
        ...(fieldName.toLowerCase() === "source" ? { encrypted: true } : {}),
      };
      if (nextField.fields) nextField.fields = visitFields(nextField.fields);
      if (nextField.options) {
        nextField.options = Object.fromEntries(
          Object.entries(nextField.options).map(([optionName, option]) => [
            optionName,
            { ...option, fields: visitFields(option.fields || {}) },
          ])
        );
      }
      return [fieldName, nextField];
    })
  );

  const nextStructure = { ...structure };
  for (const entityType of Object.keys(nextStructure.classes || {})) {
    if (nextStructure[entityType]?.fields) {
      nextStructure[entityType] = {
        ...nextStructure[entityType],
        fields: visitFields(nextStructure[entityType].fields),
      };
    }
  }
  return nextStructure;
}

function fieldValuesForEntity(entityType, entity) {
  // The frontend expects a uniform array of field payloads for reports, items,
  // and custom RDF entities.
  return editableFieldEntries(entityType).map(field => ({
    name: field.name,
    label: field.label || field.name,
    kind: field.kind,
    datatype: field.datatype,
    required: field.required,
    inputType: field.inputType,
    allowMultiple: field.allowMultiple,
    subfields: field.subfields || [],
    options: field.options || [],
    encrypted: field.encrypted,
    value: valueForFieldPayload(field, entity[field.name]),
  }));
}

function valueForFieldPayload(field, value) {
  if (field.kind === "array") {
    const values = Array.isArray(value)
      ? decryptDataForField(field, value)
      : (value ? [decryptDataForField(field, value)] : []);
    return values.length > 0 ? JSON.stringify(values) : null;
  }
  if (field.kind === "group" || field.kind === "location" || field.kind === "importClass" || field.kind === "conditional") {
    return value ? JSON.stringify(value) : null;
  }
  return decryptDataForField(field, value) ?? null;
}

// ---------------------------------------------------------------------------
// RDF structure migration helpers
// ---------------------------------------------------------------------------

function queryFields(fields, requiredFieldNames) {
  const requiredNames = new Set(requiredFieldNames);
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, field]) => !isGroupField(field) && !isArrayField(field))
      .map(([fieldName, field]) => [
        fieldName,
        { ...field, required: requiredNames.has(fieldName) },
      ])
  );
}

function genericEntityQueryFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {})
      .filter(([, field]) => !isGroupField(field) && !field.metadataOnly)
      .map(([fieldName, field]) => [fieldName, { ...field, required: false }])
  );
}

function allPredicateFields(structure, entityType) {
  const entity = structure[entityType] || {};
  const fields = Object.entries(entity.fields || {})
    .filter(([, field]) => !isGroupField(field))
    .map(([name, field]) => ({ name, ...field }));
  const nested = Object.entries(entity.fields || {})
    .filter(([, field]) => isGroupField(field))
    .flatMap(([groupName, group]) => [
      ...(group?.predicate ? [{ name: groupName, ...group }] : []),
      ...groupSubfieldEntries(group)
        .map(([name, field]) => ({ name: `${groupName}.${name}`, ...field })),
    ]);

  const conditional = Object.entries(entity.fields || {})
    .flatMap(([fieldName, field]) => Object.entries(field.options || {})
      .flatMap(([optionName, option]) => Object.entries(option.fields || {})
        .filter(([, subfield]) => subfield && typeof subfield === "object" && subfield.predicate)
        .map(([subfieldName, subfield]) => ({ name: `${fieldName}.${optionName}.${subfieldName}`, ...subfield }))));

  return [...fields, ...nested, ...conditional];
}

function entityTypesFromStructure(structure) {
  return Object.keys({ ...(structure.classes || {}), ...(structure.uriTemplates || {}) });
}

function changedPredicates(oldStructure, nextStructure, entityType) {
  // Detect renamed predicates so saved data can move with the structure instead
  // of disappearing from the UI.
  const nextFieldsByName = new Map(allPredicateFields(nextStructure, entityType).map(field => [field.name, field]));
  return allPredicateFields(oldStructure, entityType)
    .map(oldField => ({ oldField, nextField: nextFieldsByName.get(oldField.name) }))
    .filter(({ oldField, nextField }) => nextField?.predicate && oldField.predicate !== nextField.predicate);
}

function matchingPredicateFieldPairs(oldStructure, nextStructure, entityType) {
  const nextFieldsByName = new Map(allPredicateFields(nextStructure, entityType).map(field => [field.name, field]));
  return allPredicateFields(oldStructure, entityType)
    .map(oldField => ({ oldField, nextField: nextFieldsByName.get(oldField.name) }))
    .filter(({ oldField, nextField }) => oldField.predicate && nextField?.predicate);
}

function migrationPredicatePairs(oldStructure, nextStructure, entityType) {
  const nextFieldsByName = new Map(allPredicateFields(nextStructure, entityType).map(field => [field.name, field]));
  const candidateStructures = [oldStructure, defaultRdfStructure()];
  const pairs = [];
  const seen = new Set();

  for (const candidateStructure of candidateStructures) {
    for (const oldField of allPredicateFields(candidateStructure, entityType)) {
      const nextField = nextFieldsByName.get(oldField.name);
      if (!nextField?.predicate || oldField.predicate === nextField.predicate) continue;

      const key = `${oldField.predicate}->${nextField.predicate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ oldPredicate: oldField.predicate, nextPredicate: nextField.predicate });
    }
  }

  return pairs;
}

function deletedPredicateFields(oldStructure, nextStructure, entityType) {
  const nextFields = allPredicateFields(nextStructure, entityType);
  const nextFieldNames = new Set(nextFields.map(field => field.name));
  // Imported classes and conditional options can share predicates. If a field
  // path changes during structure refresh, keep triples while the predicate is
  // still represented anywhere on the entity.
  const nextPredicates = new Set(nextFields.map(field => field.predicate).filter(Boolean));
  return allPredicateFields(oldStructure, entityType)
    .filter(oldField => (
      oldField.predicate
      && !nextFieldNames.has(oldField.name)
      && !nextPredicates.has(oldField.predicate)
    ));
}

function changedClasses(oldStructure, nextStructure) {
  return entityTypesFromStructure(nextStructure)
    .map(entityType => ({
      oldClassName: oldStructure.classes?.[entityType],
      nextClassName: nextStructure.classes?.[entityType],
    }))
    .filter(change => change.oldClassName && change.nextClassName && change.oldClassName !== change.nextClassName);
}

function deletedEntityTypes(oldStructure, nextStructure) {
  const nextEntityTypes = new Set(entityTypesFromStructure(nextStructure));
  return entityTypesFromStructure(oldStructure)
    .filter(entityType => entityType !== "report" && entityType !== "reportItem" && !nextEntityTypes.has(entityType));
}

function changedUriPrefixes(oldStructure, nextStructure) {
  return entityTypesFromStructure(nextStructure)
    .map(entityType => ({
      entityType,
      oldBase: entityIdReplacePatternForStructure(oldStructure, entityType),
      nextBase: entityIdReplacePatternForStructure(nextStructure, entityType),
    }))
    .filter(change => change.oldBase && change.nextBase && change.oldBase !== change.nextBase);
}

function migrationStructureFor(oldStructure) {
  const nextStructure = JSON.parse(JSON.stringify(oldStructure));
  const defaultStructure = defaultRdfStructure();
  nextStructure.prefixes = { ...(nextStructure.prefixes || {}), id: defaultStructure.prefixes.id };
  nextStructure.uriTemplates = Object.fromEntries(
    Object.entries(nextStructure.uriTemplates || {}).map(([entityType, template]) => {
      const targetTemplate = String(template).replace(/^resource:/, "id:");
      return [entityType, String(template).startsWith("resource:") ? targetTemplate : template];
    })
  );
  const migrateFields = fields => Object.fromEntries(
    Object.entries(fields || {}).map(([fieldName, field]) => {
      if (!field || typeof field !== "object") return [fieldName, field];
      const nestedFields = groupSubfieldEntries(field);
      const nextField = {
        ...field,
        ...(field.predicate && String(field.predicate).startsWith("hds:")
          ? { predicate: String(field.predicate).replace(/^hds:/, "sitrep:") }
          : {}),
        ...(field.targetTemplate && String(field.targetTemplate).startsWith("resource:")
          ? { targetTemplate: String(field.targetTemplate).replace(/^resource:/, "id:") }
          : {}),
      };
      if (nestedFields.length > 0) Object.assign(nextField, migrateFields(Object.fromEntries(nestedFields)));
      if (field.options) {
        nextField.options = Object.fromEntries(Object.entries(field.options).map(([optionName, option]) => [
          optionName,
          { ...option, fields: migrateFields(option.fields || {}) },
        ]));
      }
      return [fieldName, nextField];
    })
  );
  Object.keys(nextStructure).forEach(entityType => {
    if (nextStructure[entityType]?.fields) nextStructure[entityType].fields = migrateFields(nextStructure[entityType].fields);
  });
  return nextStructure;
}

async function countUriPrefixTriples(base) {
  if (!base) return 0;
  const result = await runSparqlQuery(`${PREFIXES}
    SELECT (COUNT(*) AS ?count) WHERE {
      { ?subject ?predicate ?object . FILTER(isIRI(?subject) && STRSTARTS(STR(?subject), "${escapeSparqlString(base)}")) }
      UNION
      { ?subject ?predicate ?object . FILTER(isIRI(?object) && STRSTARTS(STR(?object), "${escapeSparqlString(base)}")) }
    }
  `);
  return parseInt(result.results.bindings[0]?.count?.value || "0", 10);
}

async function organisationUriMigrationStatus(organisationId) {
  const oldStructureJson = await organisationRdfStructureJson(organisationId);
  const oldStructure = oldStructureJson ? parseRdfStructureJson(oldStructureJson) : legacyDefaultRdfStructure();
  const nextStructure = migrationStructureFor(oldStructure);
  const changes = changedUriPrefixes(oldStructure, nextStructure);
  const predicateChanges = migrationPredicatePairs(oldStructure, nextStructure, "reportItem")
    .concat(migrationPredicatePairs(oldStructure, nextStructure, "report"))
    .concat(entityTypesFromStructure(nextStructure).flatMap(entityType => migrationPredicatePairs(oldStructure, nextStructure, entityType)))
    .filter((change, index, all) => all.findIndex(candidate => candidate.oldPredicate === change.oldPredicate && candidate.nextPredicate === change.nextPredicate) === index);
  const uriCounts = await Promise.all(changes.map(({ oldBase }) => countUriPrefixTriples(oldBase)));
  const predicateCounts = await Promise.all(predicateChanges.map(({ oldPredicate }) => countPredicateTriples(oldPredicate)));
  const affectedTriples = uriCounts.concat(predicateCounts)
    .reduce((total, count) => total + count, 0);
  return {
    organisationId,
    needsMigration: changes.length > 0,
    currentTemplates: changes.map(({ oldBase }) => oldBase),
    targetTemplates: changes.map(({ nextBase }) => nextBase),
    predicateChanges: predicateChanges.map(({ oldPredicate, nextPredicate }) => `${oldPredicate} -> ${nextPredicate}`),
    affectedTriples,
  };
}

function termKind(field = {}) {
  return field.objectType === "uri" || field.createEntityFromInput || field.targetEntityType ? "uri" : "literal";
}

function datatypeOf(field = {}) {
  return termKind(field) === "literal" ? field.datatype || "" : "";
}

function targetClassForField(structure, field = {}) {
  return field.targetClass || (field.targetEntityType ? structure.classes?.[field.targetEntityType] : null);
}

function templateBaseForField(structure, field = {}) {
  const template = field.targetTemplate || (field.targetEntityType ? structure.uriTemplates?.[field.targetEntityType] : "");
  if (!template) return "";
  const token = String(template).match(/\{([^}]+)\}/)?.[1] || field.targetLabelField || "id";
  const absoluteTemplate = String(template).replace(/^([A-Za-z][\w-]*):(.*)$/, (_, prefix, localName) => {
    return structure.prefixes?.[prefix] ? `${structure.prefixes[prefix]}${localName}` : template;
  });
  return absoluteTemplate.split(`{${token}}`)[0];
}

function changedStorageFieldPairs(oldStructure, nextStructure, entityType) {
  return matchingPredicateFieldPairs(oldStructure, nextStructure, entityType)
    .filter(({ oldField, nextField }) => (
      termKind(oldField) !== termKind(nextField)
      || datatypeOf(oldField) !== datatypeOf(nextField)
      || targetClassForField(oldStructure, oldField) !== targetClassForField(nextStructure, nextField)
      || templateBaseForField(oldStructure, oldField) !== templateBaseForField(nextStructure, nextField)
    ));
}

function changedConditionalOptionValues(oldStructure, nextStructure, entityType) {
  const nextFields = nextStructure[entityType]?.fields || {};
  const className = nextStructure.classes?.[entityType];
  return Object.entries(oldStructure[entityType]?.fields || {})
    .flatMap(([fieldName, oldField]) => {
      const nextField = nextFields[fieldName];
      if (!oldField?.options || !nextField?.options || !nextField.predicate) return [];
      return Object.entries(oldField.options).flatMap(([optionName, oldOption]) => {
        const nextOption = nextField.options?.[optionName];
        if (!nextOption) return [];
        const oldValue = oldOption.value || optionName;
        const nextValue = nextOption.value || optionName;
        return oldValue !== nextValue
          ? [{ className, field: nextField, oldOption, nextOption, oldValue, nextValue }]
          : [];
      });
    });
}

function changedGroupClassPairs(oldStructure, nextStructure, entityType) {
  const nextFields = nextStructure[entityType]?.fields || {};
  const className = nextStructure.classes?.[entityType];
  return Object.entries(oldStructure[entityType]?.fields || {})
    .filter(([, field]) => isGroupField(field))
    .map(([groupName, oldGroup]) => ({
      entityType,
      groupName,
      className,
      oldClassName: oldGroup.className,
      nextClassName: nextFields[groupName]?.className,
      predicate: nextFields[groupName]?.predicate || oldGroup.predicate,
    }))
    .filter(change => change.className && change.predicate && change.oldClassName && change.nextClassName && change.oldClassName !== change.nextClassName);
}

function classPropertyPairs(structure) {
  return classPropertyTriples(structure)
    .map(property => ({
      className: property.subject,
      predicate: property.predicate,
      objectName: property.object,
    }));
}

async function syncEquivalentClassTriples(structure = RDF) {
  const updates = classPropertyPairs(structure)
    .map(({ className, predicate, objectName }) => `
      DELETE WHERE {
        ${className} ${predicate} ${objectName} .
      };
      INSERT DATA {
        ${className} ${predicate} ${objectName} .
      }
    `)
    .join(";\n");
  if (!updates) return;
  await runSparqlUpdate(`${PREFIXES}\n${updates}`);
}

function deletedEquivalentClassPairs(oldStructure, nextStructure) {
  const nextPairs = new Set(
    classPropertyPairs(nextStructure).map(pair => `${pair.className}|${pair.predicate}|${pair.objectName}`)
  );
  return classPropertyPairs(oldStructure)
    .filter(pair => !nextPairs.has(`${pair.className}|${pair.predicate}|${pair.objectName}`));
}

async function renamePredicate(oldPredicate, nextPredicate) {
  // Copy all triples to the new predicate before deleting the old one so the
  // migration preserves subject/object values exactly.
  const before = await countPredicateTriples(oldPredicate);
  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?s ${oldPredicate} ?o .
    }
    INSERT {
      ?s ${nextPredicate} ?o .
    }
    WHERE {
      ?s ${oldPredicate} ?o .
      FILTER NOT EXISTS { ?s ${nextPredicate} ?o }
    };
    DELETE WHERE {
      ?s ${oldPredicate} ?o .
    }
  `);
  const after = await countPredicateTriples(nextPredicate);
  return { oldPredicate, nextPredicate, before, after };
}

async function rewritePredicateObjects(predicate, bindExpression, filterExpression = "") {
  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?s ${predicate} ?oldObject .
    }
    INSERT {
      ?s ${predicate} ?nextObject .
    }
    WHERE {
      ?s ${predicate} ?oldObject .
      ${filterExpression}
      BIND(${bindExpression} AS ?nextObject)
      FILTER(!sameTerm(?oldObject, ?nextObject))
      FILTER NOT EXISTS { ?s ${predicate} ?nextObject . }
    };
    DELETE {
      ?s ${predicate} ?oldObject .
    }
    WHERE {
      ?s ${predicate} ?oldObject .
      ${filterExpression}
      BIND(${bindExpression} AS ?nextObject)
      FILTER(!sameTerm(?oldObject, ?nextObject))
    }
  `);
}

async function migrateFieldTermKindAndDatatype(predicate, oldField, nextField, nextStructure) {
  const oldKind = termKind(oldField);
  const nextKind = termKind(nextField);
  if (oldKind === "literal" && nextKind === "uri") {
    const resourceBase = nextStructure.prefixes?.resource || nextStructure.prefixes?.sitrep || "http://sitrep.example.org/resource/";
    await rewritePredicateObjects(
      predicate,
      `IF(REGEX(STR(?oldObject), "^[A-Za-z][A-Za-z0-9+.-]*:"), IRI(STR(?oldObject)), IRI(CONCAT("${resourceBase}", ENCODE_FOR_URI(STR(?oldObject)))))`,
      "FILTER(isLiteral(?oldObject))"
    );
    return;
  }

  if (oldKind === "uri" && nextKind === "literal") {
    await rewritePredicateObjects(predicate, "STR(?oldObject)", "FILTER(isIRI(?oldObject))");
    return;
  }

  if (nextKind === "literal" && datatypeOf(oldField) !== datatypeOf(nextField)) {
    const nextDatatype = datatypeOf(nextField);
    const bindExpression = nextDatatype ? `STRDT(STR(?oldObject), ${nextDatatype})` : "STR(?oldObject)";
    await rewritePredicateObjects(predicate, bindExpression, "FILTER(isLiteral(?oldObject))");
  }
}

async function migrateLinkedTargetClass(entityType, oldField, nextField, oldStructure, nextStructure) {
  const oldClassName = targetClassForField(oldStructure, oldField);
  const nextClassName = targetClassForField(nextStructure, nextField);
  if (!oldClassName || !nextClassName || oldClassName === nextClassName || !nextField.predicate) return;
  const entityClassName = nextStructure.classes?.[entityType];
  if (!entityClassName) return;
  const linkedPattern = `?entity ${nextField.predicate} ?linked .`;

  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?linked rdf:type ${oldClassName} .
    }
    INSERT {
      ?linked rdf:type ${nextClassName} .
    }
    WHERE {
      ?entity rdf:type ${entityClassName} .
      ${linkedPattern}
      ?linked rdf:type ${oldClassName} .
      FILTER NOT EXISTS { ?linked rdf:type ${nextClassName} . }
    };
    DELETE {
      ?linked rdf:type ${oldClassName} .
    }
    WHERE {
      ?entity rdf:type ${entityClassName} .
      ${linkedPattern}
      ?linked rdf:type ${oldClassName} .
    }
  `);
}

async function migrateLinkedTemplateBase(oldField, nextField, oldStructure, nextStructure) {
  const oldBase = templateBaseForField(oldStructure, oldField);
  const nextBase = templateBaseForField(nextStructure, nextField);
  if (!oldBase || !nextBase || oldBase === nextBase || !nextField.predicate) return;
  const deleteTriple = `?entity ${nextField.predicate} ?oldLinked .`;
  const insertTriple = `?entity ${nextField.predicate} ?nextLinked .`;

  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ${deleteTriple}
    }
    INSERT {
      ${insertTriple}
    }
    WHERE {
      ${deleteTriple}
      FILTER(STRSTARTS(STR(?oldLinked), "${oldBase}"))
      BIND(IRI(CONCAT("${nextBase}", STRAFTER(STR(?oldLinked), "${oldBase}"))) AS ?nextLinked)
      FILTER NOT EXISTS { ${insertTriple} }
    };
    DELETE {
      ${deleteTriple}
    }
    WHERE {
      ${deleteTriple}
      FILTER(STRSTARTS(STR(?oldLinked), "${oldBase}"))
    }
  `);
}

async function migrateConditionalOptionValue({ className, field, oldOption, nextOption, oldValue, nextValue }) {
  if (!className || !field?.predicate) return;
  const oldTerm = objectTerm(oldValue, { ...field, ...oldOption, predicate: field.predicate, objectType: oldOption.objectType || field.objectType });
  const nextTerm = objectTerm(nextValue, { ...field, ...nextOption, predicate: field.predicate, objectType: nextOption.objectType || field.objectType });
  if (!oldTerm || !nextTerm || oldTerm === nextTerm) return;

  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?entity ${field.predicate} ${oldTerm} .
    }
    INSERT {
      ?entity ${field.predicate} ${nextTerm} .
    }
    WHERE {
      ?entity rdf:type ${className} .
      ?entity ${field.predicate} ${oldTerm} .
      FILTER NOT EXISTS { ?entity ${field.predicate} ${nextTerm} . }
    };
    DELETE {
      ?entity ${field.predicate} ${oldTerm} .
    }
    WHERE {
      ?entity rdf:type ${className} .
      ?entity ${field.predicate} ${oldTerm} .
    }
  `);
}

async function migrateGroupClassName({ className, oldClassName, nextClassName, predicate }) {
  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?group rdf:type ${oldClassName} .
    }
    INSERT {
      ?group rdf:type ${nextClassName} .
    }
    WHERE {
      ?entity rdf:type ${className} .
      ?entity ${predicate} ?group .
      ?group rdf:type ${oldClassName} .
      FILTER NOT EXISTS { ?group rdf:type ${nextClassName} . }
    };
    DELETE {
      ?group rdf:type ${oldClassName} .
    }
    WHERE {
      ?entity rdf:type ${className} .
      ?entity ${predicate} ?group .
      ?group rdf:type ${oldClassName} .
    }
  `);
}

async function deletePredicateForEntity(entityType, structure, predicate) {
  const className = structure.classes?.[entityType];
  if (!className) return;

  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?s ${predicate} ?o .
    }
    WHERE {
      ?s rdf:type ${className} .
      ?s ${predicate} ?o .
    }
  `);
}

async function deleteEntityTypeData(entityType, structure) {
  const className = structure.classes?.[entityType];
  if (!className) return;

  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?entity ?p ?o .
      ?ref ?refP ?entity .
    }
    WHERE {
      ?entity rdf:type ${className} .
      OPTIONAL { ?entity ?p ?o . }
      OPTIONAL { ?ref ?refP ?entity . }
    }
  `);
}

async function refreshItemReportMetadata(itemId, organisationId, context) {
  if (!RDF.itemReportMetadataFields?.length) return;
  const reports = await resolvers.Query.reports(null, { organisationId }, context);
  const report = reports.find(candidate => (
    candidate.selectedItemIds || []
  ).some(selectedItemId => Number(selectedItemId) === Number(itemId)));

  if (report) {
    await setItemReportMetadata(itemId, {
      id: report.id,
      title: report.title || report.fieldValues?.find(field => field.name === "title")?.value || `Report ${report.id}`,
      reportNumber: report.reportNumber || report.id,
      reportDate: report.reportDate || report.fieldValues?.find(field => field.name === "reportDate")?.value,
    });
    return;
  }

  await clearItemReportMetadata(itemId);
}

async function countClassInstances(className) {
  const result = await runSparqlQuery(`${PREFIXES}
    SELECT (COUNT(*) AS ?count) WHERE {
      ?entity rdf:type ${className} .
    }
  `);
  return parseInt(result.results.bindings[0]?.count?.value || "0", 10);
}

async function deleteEquivalentClassTriple(className, objectName, predicate = "owl:equivalentClass") {
  if (!className || !objectName || !predicate) return;
  await runSparqlUpdate(`${PREFIXES}
    DELETE WHERE {
      ${className} ${predicate} ${objectName} .
    };
    DELETE WHERE {
      ${objectName} ${predicate} ${className} .
    }
  `);
}

async function deleteEquivalentClassTriplesForEntityType(entityType, structure = RDF) {
  const className = structure.classes?.[entityType];
  const equivalentClasses = equivalentClassValues(structure.equivalentClasses?.[entityType]);
  if (!className) return;
  for (const equivalentClass of equivalentClasses) {
    await deleteEquivalentClassTriple(className, classTermForEquivalentClass(structure, equivalentClass));
  }
  for (const property of classPropertyPairs(structure).filter(pair => pair.className === className || pair.objectName === className)) {
    await deleteEquivalentClassTriple(property.className, property.objectName, property.predicate);
  }
}

async function countPredicateTriples(predicate) {
  const result = await runSparqlQuery(`${PREFIXES}
    SELECT (COUNT(*) AS ?count) WHERE {
      ?s ${predicate} ?o .
    }
  `);
  return parseInt(result.results.bindings[0]?.count?.value || "0", 10);
}

async function renameClass(oldClassName, nextClassName) {
  await renamePredicateObject("rdf:type", oldClassName, nextClassName);
}

async function renamePredicateObject(predicate, oldObject, nextObject) {
  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?s ${predicate} ${oldObject} .
    }
    INSERT {
      ?s ${predicate} ${nextObject} .
    }
    WHERE {
      ?s ${predicate} ${oldObject} .
      FILTER NOT EXISTS { ?s ${predicate} ${nextObject} }
    };
    DELETE WHERE {
      ?s ${predicate} ${oldObject} .
    }
  `);
}

async function renameEntitySubjects(oldBase, nextBase) {
  await runSparqlUpdate(`${PREFIXES}
    DELETE {
      ?s ?p ?o .
    }
    INSERT {
      ?nextSubject ?p ?o .
    }
    WHERE {
      ?s ?p ?o .
      FILTER(STRSTARTS(STR(?s), "${oldBase}"))
      BIND(IRI(CONCAT("${nextBase}", STRAFTER(STR(?s), "${oldBase}"))) AS ?nextSubject)
      FILTER NOT EXISTS { ?nextSubject ?p ?o }
    };
    DELETE {
      ?s ?p ?o .
    }
    WHERE {
      ?s ?p ?o .
      FILTER(STRSTARTS(STR(?s), "${oldBase}"))
      FILTER(!STRSTARTS(STR(?s), "${nextBase}"))
    }
    ;
    DELETE {
      ?sRef ?pRef ?oldObject .
    }
    INSERT {
      ?sRef ?pRef ?nextObject .
    }
    WHERE {
      ?sRef ?pRef ?oldObject .
      FILTER(isIRI(?oldObject))
      FILTER(STRSTARTS(STR(?oldObject), "${oldBase}"))
      BIND(IRI(CONCAT("${nextBase}", STRAFTER(STR(?oldObject), "${oldBase}"))) AS ?nextObject)
      FILTER NOT EXISTS { ?sRef ?pRef ?nextObject }
    };
    DELETE {
      ?sRef ?pRef ?oldObject .
    }
    WHERE {
      ?sRef ?pRef ?oldObject .
      FILTER(isIRI(?oldObject))
      FILTER(STRSTARTS(STR(?oldObject), "${oldBase}"))
      FILTER(!STRSTARTS(STR(?oldObject), "${nextBase}"))
    }
  `);
}

async function migrateStoredRdf(oldStructure, nextStructure) {
  // Apply best-effort migrations for structural changes made in the RDF editor.
  // Each operation reports its outcome so the UI can display what was migrated.
  const results = [];
  for (const entityType of deletedEntityTypes(oldStructure, nextStructure)) {
    await deleteEntityTypeData(entityType, oldStructure);
    await deleteEquivalentClassTriplesForEntityType(entityType, oldStructure);
  }

  for (const { className, predicate, objectName } of deletedEquivalentClassPairs(oldStructure, nextStructure)) {
    await deleteEquivalentClassTriple(className, objectName, predicate);
  }

  for (const entityType of entityTypesFromStructure(nextStructure)) {
    for (const oldField of deletedPredicateFields(oldStructure, nextStructure, entityType)) {
      await deletePredicateForEntity(entityType, oldStructure, oldField.predicate);
    }

    for (const { oldPredicate, nextPredicate } of migrationPredicatePairs(oldStructure, nextStructure, entityType)) {
      results.push(await renamePredicate(oldPredicate, nextPredicate));
    }

    for (const { oldField, nextField } of changedStorageFieldPairs(oldStructure, nextStructure, entityType)) {
      await migrateFieldTermKindAndDatatype(nextField.predicate, oldField, nextField, nextStructure);
      await migrateLinkedTargetClass(entityType, oldField, nextField, oldStructure, nextStructure);
      await migrateLinkedTemplateBase(oldField, nextField, oldStructure, nextStructure);
    }

    for (const optionChange of changedConditionalOptionValues(oldStructure, nextStructure, entityType)) {
      await migrateConditionalOptionValue(optionChange);
    }

    for (const groupClassChange of changedGroupClassPairs(oldStructure, nextStructure, entityType)) {
      await migrateGroupClassName(groupClassChange);
    }
  }

  for (const { oldClassName, nextClassName } of changedClasses(oldStructure, nextStructure)) {
    await renameClass(oldClassName, nextClassName);
  }

  for (const { oldBase, nextBase } of changedUriPrefixes(oldStructure, nextStructure)) {
    await renameEntitySubjects(oldBase, nextBase);
  }

  return results;
}

// ---------------------------------------------------------------------------
// GraphQL resolver map
// ---------------------------------------------------------------------------

const resolvers = {
  ReportItem: {
    fieldValues: item => fieldValuesForEntity("reportItem", item),
  },
  Report: {
    fieldValues: report => fieldValuesForEntity("report", report),
  },
  RdfStructurePreset: {
    canDelete: async (preset, _, context) => {
      const user = context.currentUser;
      if (!user) return false;
      if (preset.scope === "global") return user.role === "admin";
      return canWriteOrganisation(user, preset.organisationId);
    },
  },
  Query: {
    me: async (_, __, context) => context.currentUser,

    users: async (_, __, context) => {
      requireAdmin(context);
      return listUsers();
    },

    organisations: async (_, __, context) => listOrganisations(context.currentUser),

    myOrganisations: async (_, __, context) => listMyOrganisations(context.currentUser),

    rdfStructure: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      await applyOrganisationRdfStructure(organisationId);
      return rdfStructurePayload();
    },

    rdfStructurePresets: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      return listOrganisationRdfStructurePresets(organisationId);
    },

    rdfUriMigrationStatus: async (_, { organisationId }, context) => {
      requireAdmin(context);
      return withOrganisationRepository(organisationId, async () => {
        await applyOrganisationRdfStructure(organisationId);
        return organisationUriMigrationStatus(organisationId);
      });
    },

    rdfEntities: async (_, { entityType, organisationId, limit, offset }, context) => rdfEntitiesForType(entityType, organisationId, context, { limit, offset }),

    rdfEntityCount: async (_, { entityType, organisationId }, context) => rdfEntityCountForType(entityType, organisationId, context),

    reportItems: async (_, { organisationId, limit, offset }, context) => {
      // Report items are aggregated by URI because optional fields can produce
      // multiple SPARQL bindings for the same item.
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const itemFields = queryFields(RDF.reportItem.fields, ["entryNumber"]);
      const entryNumberPredicate = RDF.reportItem.fields.entryNumber.predicate;
      const sparqlQuery = `${PREFIXES}
        SELECT ?item ${selectVariables(itemFields)}
        WHERE {
          {
            SELECT ?item ?entryNumber WHERE {
              ?item rdf:type ${RDF.classes.reportItem} ;
                    ${entryNumberPredicate} ?entryNumber .
            }
            ORDER BY DESC(?entryNumber)
            ${paginationClause({ limit, offset })}
          }
          ${fieldPatterns("?item", itemFields)}
        }
        ORDER BY DESC(?entryNumber)
      `;

      const result = await runSparqlQuery(sparqlQuery);
      const itemsMap = new Map();

      result.results.bindings.forEach(binding => {
        const itemUri = binding.item.value;
        if (!itemsMap.has(itemUri)) {
          itemsMap.set(itemUri, reportItemFromBinding(binding));
        }
      });

      const items = Array.from(itemsMap.values());
      for (const item of items) {
        await loadReportItemCollections(item);
      }

      return items;
      });
    },

    reportItemCount: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
        const entryNumberPredicate = RDF.reportItem.fields.entryNumber.predicate;
        const result = await runSparqlQuery(`${PREFIXES}
          SELECT (COUNT(DISTINCT ?item) AS ?count)
          WHERE {
            ?item rdf:type ${RDF.classes.reportItem} ;
                  ${entryNumberPredicate} ?entryNumber .
          }
        `);
        return parseInt(result.results.bindings[0]?.count?.value || "0", 10);
      });
    },

    reportItem: async (_, { id, organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const subject = entityUri("reportItem", id);
      const itemFields = queryFields(RDF.reportItem.fields, ["entryNumber"]);
      const sparqlQuery = `${PREFIXES}
        SELECT ${selectVariables(itemFields)}
        WHERE {
          ${subject} rdf:type ${RDF.classes.reportItem} .
          ${fieldPatterns(subject, itemFields)}
        }
      `;

      const result = await runSparqlQuery(sparqlQuery);
      if (result.results.bindings.length === 0) return null;

      const item = reportItemFromBinding(result.results.bindings[0]);
      return loadReportItemCollections(item);
      });
    },

    reports: async (_, { organisationId, limit, offset }, context) => {
      // Report IDs are derived from URI templates, then enriched with selected
      // report-item links from a separate helper query.
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const reportFields = queryFields(RDF.report.fields, []);
      const reportIdBase = entityIdReplacePattern("report");
      const createdAtPredicate = RDF.report.fields.createdAt.predicate;
      const sparqlQuery = `${PREFIXES}
        SELECT ?report ?id ${selectVariables(reportFields)}
        WHERE {
          {
            SELECT ?report ?id ?createdAtSort WHERE {
              ?report rdf:type ${RDF.classes.report} .
              FILTER(STRSTARTS(STR(?report), "${reportIdBase}"))
              BIND(REPLACE(STR(?report), "${reportIdBase}", "") AS ?id)
              FILTER(REGEX(?id, "^[0-9]+$"))
              OPTIONAL { ?report ${createdAtPredicate} ?createdAtSort . }
            }
            ORDER BY DESC(?createdAtSort) DESC(xsd:integer(?id))
            ${paginationClause({ limit, offset })}
          }
          ${fieldPatterns("?report", reportFields)}
        }
        ORDER BY DESC(?createdAtSort) DESC(xsd:integer(?id))
      `;

      const result = await runSparqlQuery(sparqlQuery);
      const reports = [];

      for (const binding of result.results.bindings) {
        const report = reportFromBinding(binding, binding.id.value);
        if (!report) continue;
        await loadReportSelectedItemIds(report, `<${binding.report.value}>`);
        reports.push(report);
      }

      return reports;
      });
    },

    reportCount: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
        const reportIdBase = entityIdReplacePattern("report");
        const result = await runSparqlQuery(`${PREFIXES}
          SELECT (COUNT(DISTINCT ?report) AS ?count)
          WHERE {
            ?report rdf:type ${RDF.classes.report} .
            FILTER(STRSTARTS(STR(?report), "${reportIdBase}"))
            BIND(REPLACE(STR(?report), "${reportIdBase}", "") AS ?id)
            FILTER(REGEX(?id, "^[0-9]+$"))
          }
        `);
        return parseInt(result.results.bindings[0]?.count?.value || "0", 10);
      });
    },

    report: async (_, { id, organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const subject = entityUri("report", id);
      const reportFields = queryFields(RDF.report.fields, []);
      const sparqlQuery = `${PREFIXES}
        SELECT ${selectVariables(reportFields)}
        WHERE {
          ${subject} rdf:type ${RDF.classes.report} .
          ${fieldPatterns(subject, reportFields)}
        }
      `;

      const result = await runSparqlQuery(sparqlQuery);
      if (result.results.bindings.length === 0) return null;

      const report = reportFromBinding(result.results.bindings[0], id);
      if (!report) return null;
      return loadReportSelectedItemIds(report, subject);
      });
    },

    compiledReportConfig: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      const store = await readCompiledReportStore(organisationId);
      return normalizeCompiledReportConfig(store.config);
    },

    compiledReports: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      const store = await readCompiledReportStore(organisationId);
      return store.reports
        .map(compiledReportPayload)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    compiledReport: async (_, { id, organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      const store = await readCompiledReportStore(organisationId);
      const report = store.reports.find(candidate => String(candidate.id) === String(id));
      return report ? compiledReportPayload(report) : null;
    },

    reportAutomations: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      const store = await readReportAutomationStore(organisationId);
      return store.schedules.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
  },

  Mutation: {
    requestSignUpCode: async (_, { email, password, name, captchaToken }, context) => {
      const forwardedFor = context.req.headers["x-forwarded-for"];
      const remoteIp = String(Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || context.req.ip || "")
        .split(",")[0]
        .trim();
      return requestSignUpCode({ email, password, name, captchaToken, remoteIp });
    },

    signUp: async (_, { email, password, name, verificationCode }, context) => {
      const verified = await consumeSignUpCode({ email, code: verificationCode });
      const user = await createUser({ email: verified.email, password, name: name || verified.name });
      context.res.cookie(sessionCookieName(), createSessionToken(user), sessionCookieOptions());
      return { user };
    },

    signIn: async (_, { email, password }, context) => {
      const user = await authenticateUser({ email, password });
      context.res.cookie(sessionCookieName(), createSessionToken(user), sessionCookieOptions());
      return { user };
    },

    signOut: async (_, __, context) => {
      const options = sessionCookieOptions();
      delete options.maxAge;
      context.res.clearCookie(sessionCookieName(), options);
      return true;
    },

    updateMyAccount: async (_, { email, name }, context) => {
      const user = requireAuth(context);
      const nextUser = await updateUserProfile(user.id, { email, name });
      context.res.cookie(sessionCookieName(), createSessionToken(nextUser), sessionCookieOptions());
      return nextUser;
    },

    updateMyPassword: async (_, { currentPassword, newPassword }, context) => {
      const user = requireAuth(context);
      await updateUserPassword(user.id, { currentPassword, newPassword });
      return true;
    },

    deleteUser: async (_, { id }, context) => {
      const user = requireAdmin(context);
      if (user.id === id) {
        throw new Error("You cannot delete your own account.");
      }
      await removeUserFromOrganisations(id);
      return deleteUser(id);
    },

    createOrganisation: async (_, { name, description, joinRequiresPassword, joinPassword }, context) => {
      const user = requireAuth(context);
      return createOrganisation(user.id, { name, description, joinRequiresPassword, joinPassword });
    },

    provisionOrganisationRepository: async (_, { id }, context) => {
      const user = requireAuth(context);
      return provisionOrganisationRepository(user, id);
    },

    joinOrganisation: async (_, { id, password }, context) => {
      const user = requireAuth(context);
      return joinOrganisation(user.id, id, password);
    },

    leaveOrganisation: async (_, { id }, context) => {
      const user = requireAuth(context);
      return leaveOrganisation(user, id);
    },

    updateOrganisation: async (_, { id, name, description, joinRequiresPassword, joinPassword }, context) => {
      const user = requireAuth(context);
      return updateOrganisation(user, id, { name, description, joinRequiresPassword, joinPassword });
    },

    updateOrganisationMemberRole: async (_, { organisationId, userId, role }, context) => {
      const user = requireAuth(context);
      return updateOrganisationMemberRole(user, organisationId, userId, role);
    },

    upsertOrganisationRole: async (_, { organisationId, id, name, permissions }, context) => {
      const user = requireAuth(context);
      return upsertOrganisationRole(user, organisationId, { id, name, permissions });
    },

    deleteOrganisation: async (_, { id }, context) => {
      const user = requireAuth(context);
      return deleteOrganisation(user, id);
    },

    updateRdfStructure: async (_, { json, organisationId }, context) => {
      // Admins may edit the global unscoped structure; organisation structures
      // require write access to that organisation.
      const user = requireAuth(context);
      if (!(user.role === "admin" && !organisationId)) {
        await requireOrganisationWrite(context, organisationId);
      }
      parseRdfStructureJson(json, { strict: true });
      return withOrganisationRepository(organisationId, async () => {
      return updateActiveRdfStructure(organisationId, json);
      });
    },

    migrateOrganisationUris: async (_, { organisationId }, context) => {
      requireAdmin(context);
      return withOrganisationRepository(organisationId, async () => {
        const oldStructureJson = await organisationRdfStructureJson(organisationId);
        const oldStructure = oldStructureJson ? parseRdfStructureJson(oldStructureJson) : legacyDefaultRdfStructure();
        const nextStructure = migrationStructureFor(oldStructure);
        await migrateStoredRdf(oldStructure, nextStructure);
        applyRdfStructureFromJson(JSON.stringify(nextStructure));
        await updateOrganisationRdfStructureJson(organisationId, JSON.stringify(nextStructure));
        return organisationUriMigrationStatus(organisationId);
      });
    },

    saveRdfStructurePreset: async (_, { name, json, organisationId, scope }, context) => {
      const user = requireAuth(context);
      const presetOrganisationId = presetScopeOrganisationId(organisationId, scope);
      if (isGlobalPresetScope(scope)) {
        if (user.role !== "admin") throw new Error("You must be an admin to save a global preset.");
      } else if (!(user.role === "admin" && !organisationId)) {
        await requireOrganisationWrite(context, organisationId);
      }
      parseRdfStructureJson(json, { strict: true });
      return saveOrganisationRdfStructurePreset(presetOrganisationId, { name, json, createdBy: user.id });
    },

    loadRdfStructurePreset: async (_, { id, organisationId, scope }, context) => {
      const user = requireAuth(context);
      if (!(user.role === "admin" && !organisationId)) {
        await requireOrganisationWrite(context, organisationId);
      }
      const json = await rdfStructurePresetJson(presetScopeOrganisationId(organisationId, scope), id);
      parseRdfStructureJson(json, { strict: true });
      return withOrganisationRepository(organisationId, async () => updateActiveRdfStructure(organisationId, json));
    },

    deleteRdfStructurePreset: async (_, { id, organisationId, scope }, context) => {
      const user = requireAuth(context);
      const presetOrganisationId = presetScopeOrganisationId(organisationId, scope);
      if (isGlobalPresetScope(scope)) {
        if (user.role !== "admin") throw new Error("You must be an admin to delete a global preset.");
      } else if (!(user.role === "admin" && !organisationId)) {
        await requireOrganisationWrite(context, organisationId);
      }
      return deleteOrganisationRdfStructurePreset(presetOrganisationId, id);
    },

    createReportItemFromFields: async (_, { fieldValues, organisationId }, context) => {
      // Form payloads are normalized, linked-entity IDs are allocated, and then
      // the final item is inserted as RDF triples.
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const entryNumber = await nextEntityId("reportItem");

      const now = new Date().toISOString();
      const item = await allocateCreatedEntityInputs("reportItem", {
        ...dataFromFieldValues("reportItem", fieldValues),
        entryNumber,
        createdAt: now,
        updatedAt: now,
      });

      await syncEquivalentClassTriples();
      await runSparqlUpdate(`${PREFIXES} INSERT DATA {
        ${reportItemTriples(item)}
      }`);
      return item;
      });
    },

    updateReportItemFromFields: async (_, { id, fieldValues, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const subject = entityUri("reportItem", id);
      const existing = await runSparqlQuery(`${PREFIXES}
        SELECT ?createdAt WHERE {
          ${subject} ${RDF.reportItem.fields.createdAt.predicate} ?createdAt .
        }
      `);
      if (existing.results.bindings.length === 0) throw new Error("Report item not found in this organisation.");
      const createdAt = existing.results.bindings[0]?.createdAt.value || new Date().toISOString();

      await deleteNestedGroupTriples("reportItem", id);
      await runSparqlUpdate(`${PREFIXES}
        DELETE WHERE {
          ${subject} ?p ?o .
        }
      `);

      const item = await allocateCreatedEntityInputs("reportItem", {
        entryNumber: parseInt(id, 10),
        ...dataFromFieldValues("reportItem", fieldValues),
        createdAt,
        updatedAt: new Date().toISOString(),
      });

      await syncEquivalentClassTriples();
      await runSparqlUpdate(`${PREFIXES} INSERT DATA {
        ${reportItemTriples(item)}
      }`);
      return item;
      });
    },

    deleteReportItem: async (_, { id, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      await deleteNestedGroupTriples("reportItem", id);
      await runSparqlUpdate(`${PREFIXES}
        ${reportItemLinkDelete(id)};
        ${scopedSubjectDelete(entityUri("reportItem", id))}
      `);
      return true;
      });
    },

    createReportFromFields: async (_, { fieldValues, selectedItemIds = [], organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const id = await nextEntityId("report");
      const now = new Date().toISOString();

      const report = {
        ...dataFromFieldValues("report", fieldValues),
        id,
        reportNumber: id,
        selectedItemIds: selectedItemIds || [],
        createdAt: now,
        updatedAt: now,
      };

      await syncEquivalentClassTriples();
      await runSparqlUpdate(`${PREFIXES} INSERT DATA {
        ${reportTriples(report)}
      }`);

      for (const itemId of selectedItemIds || []) {
        await setItemReportMetadata(itemId, report);
      }

      return report;
      });
    },

    updateReportFromFields: async (_, { id, fieldValues, selectedItemIds, organisationId }, context) => {
      // Updating a report also refreshes denormalized metadata stored on selected
      // report items so list views can show report context cheaply.
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const subject = entityUri("report", id);
      const existingReport = await resolvers.Query.report(null, { id, organisationId }, context);
      const nextSelectedItemIds = selectedItemIds || existingReport?.selectedItemIds || [];
      if (existingReport) {
        for (const itemId of existingReport.selectedItemIds) {
          await clearItemReportMetadata(itemId);
        }
      }

      const existing = await runSparqlQuery(`${PREFIXES}
        SELECT ?createdAt WHERE {
          ${subject} ${RDF.report.fields.createdAt.predicate} ?createdAt .
        }
      `);
      if (existing.results.bindings.length === 0) throw new Error("Report not found in this organisation.");
      const createdAt = existing.results.bindings[0]?.createdAt.value || new Date().toISOString();

      await deleteNestedGroupTriples("report", id);
      await runSparqlUpdate(`${PREFIXES}
        DELETE WHERE {
          ${subject} ?p ?o .
        }
      `);

      const report = {
        ...dataFromFieldValues("report", fieldValues),
        id: parseInt(id, 10),
        reportNumber: parseInt(id, 10),
        selectedItemIds: nextSelectedItemIds,
        createdAt,
        updatedAt: new Date().toISOString(),
      };

      await syncEquivalentClassTriples();
      await runSparqlUpdate(`${PREFIXES} INSERT DATA {
        ${reportTriples(report)}
      }`);

      for (const itemId of nextSelectedItemIds) {
        await setItemReportMetadata(itemId, report);
      }

      return report;
      });
    },

    deleteReport: async (_, { id, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const report = await resolvers.Query.report(null, { id, organisationId }, context);
      if (report) {
        for (const itemId of report.selectedItemIds) {
          await clearItemReportMetadata(itemId);
        }
      }

      await deleteNestedGroupTriples("report", id);
      await runSparqlUpdate(`${PREFIXES}
        ${scopedSubjectDelete(entityUri("report", id))}
      `);
      return true;
      });
    },

    addItemToReport: async (_, { reportId, itemId, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const report = await getReportMetadata(reportId);
      if (!report) throw new Error(`Report ${reportId} not found`);
      const existingReport = await resolvers.Query.report(null, { id: reportId, organisationId }, context);
      if (existingReport?.selectedItemIds?.some(id => Number(id) === Number(itemId))) {
        return true;
      }

      const selectedItemsField = reportSelectedItemsField();
      const selectedItemValue = selectedItemsField.targetTemplate
        ? applyTemplate(selectedItemsField.targetTemplate, { entryNumber: itemId, id: itemId })
        : itemId;

      await runSparqlUpdate(`${PREFIXES}
        INSERT DATA {
          ${triple(entityUri("report", reportId), selectedItemsField.predicate, selectedItemValue, selectedItemsField)}
        }
      `);
      await setItemReportMetadata(itemId, report);
      return true;
      });
    },

    removeItemFromReport: async (_, { reportId, itemId, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const selectedItemsField = reportSelectedItemsField();
      const selectedItemValue = selectedItemsField.targetTemplate
        ? applyTemplate(selectedItemsField.targetTemplate, { entryNumber: itemId, id: itemId })
        : itemId;
      await runSparqlUpdate(`${PREFIXES}
        DELETE WHERE {
          ${triple(entityUri("report", reportId), selectedItemsField.predicate, selectedItemValue, selectedItemsField)}
        }
      `);
      await refreshItemReportMetadata(itemId, organisationId, context);
      return true;
      });
    },

    updateCompiledReportConfig: async (_, { config, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      const store = await readCompiledReportStore(organisationId);
      const nextConfig = normalizeCompiledReportConfig({ ...store.config, ...config });
      await writeCompiledReportStore(organisationId, { ...store, config: nextConfig });
      return nextConfig;
    },

    createCompiledReport: async (_, { input, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      const store = await readCompiledReportStore(organisationId);
      const now = new Date().toISOString();
      const report = compiledReportPayload({
        id: `${Date.now()}`,
        sourceReportId: input.sourceReportId,
        title: input.title,
        subtitle: input.subtitle || "",
        executiveSummary: input.executiveSummary || "",
        bodyMarkdown: input.bodyMarkdown || "",
        bodyHtml: input.bodyHtml,
        selectedItemIds: input.selectedItemIds || [],
        itemFieldNames: input.itemFieldNames || [],
        configSnapshot: input.configSnapshot || JSON.stringify(store.config || defaultCompiledReportConfig()),
        createdAt: now,
        updatedAt: now,
      });
      await writeCompiledReportStore(organisationId, {
        ...store,
        reports: [report, ...store.reports],
      });
      return report;
    },

    updateCompiledReport: async (_, { id, input, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      const store = await readCompiledReportStore(organisationId);
      const reportIndex = store.reports.findIndex(candidate => String(candidate.id) === String(id));
      if (reportIndex === -1) throw new Error("Compiled report not found in this organisation.");
      const nextReport = compiledReportPayload({
        ...store.reports[reportIndex],
        ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
        updatedAt: new Date().toISOString(),
      });
      const nextReports = [...store.reports];
      nextReports[reportIndex] = nextReport;
      await writeCompiledReportStore(organisationId, { ...store, reports: nextReports });
      return nextReport;
    },

    upsertReportAutomation: async (_, { id, input, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      const store = await readReportAutomationStore(organisationId);
      const existing = id ? store.schedules.find(schedule => String(schedule.id) === String(id)) : null;
      const schedule = normalizeReportAutomationInput(input, existing || {});
      const schedules = existing
        ? store.schedules.map(candidate => String(candidate.id) === String(id) ? schedule : candidate)
        : [schedule, ...store.schedules];
      await writeReportAutomationStore(organisationId, { schedules });
      return schedule;
    },

    deleteReportAutomation: async (_, { id, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      const store = await readReportAutomationStore(organisationId);
      await writeReportAutomationStore(organisationId, {
        schedules: store.schedules.filter(schedule => String(schedule.id) !== String(id)),
      });
      return true;
    },

    runReportAutomation: async (_, { id, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      const store = await readReportAutomationStore(organisationId);
      const scheduleIndex = store.schedules.findIndex(schedule => String(schedule.id) === String(id));
      if (scheduleIndex === -1) throw new Error("Report automation not found.");
      const schedule = store.schedules[scheduleIndex];
      const now = new Date();
      try {
        const result = await executeReportAutomation(organisationId, schedule, context);
        const nextSchedule = reportAutomationPayload({
          ...schedule,
          lastRunAt: now.toISOString(),
          nextRunAt: nextAutomationRunAt(now, schedule.intervalMinutes),
          lastReportId: result.report.id,
          lastCompiledReportId: result.compiledReport?.id || null,
          lastRunMessage: `Created report ${result.report.id} with ${result.selectedItemIds.length} item${result.selectedItemIds.length === 1 ? "" : "s"}.`,
          updatedAt: now.toISOString(),
        });
        const schedules = [...store.schedules];
        schedules[scheduleIndex] = nextSchedule;
        await writeReportAutomationStore(organisationId, { schedules });
        return nextSchedule;
      } catch (error) {
        const nextSchedule = reportAutomationPayload({
          ...schedule,
          lastRunAt: now.toISOString(),
          nextRunAt: nextAutomationRunAt(now, schedule.intervalMinutes),
          lastRunMessage: `Failed: ${error.message}`,
          updatedAt: now.toISOString(),
        });
        const schedules = [...store.schedules];
        schedules[scheduleIndex] = nextSchedule;
        await writeReportAutomationStore(organisationId, { schedules });
        throw error;
      }
    },

    createRdfEntityFromFields: async (_, { entityType, fieldValues, organisationId }, context) => {
      // Custom entity creation shares the same dynamic field machinery as report
      // items, then emits a generic RdfEntity response for the frontend.
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      if (entityType === "reportItem") {
        const item = await resolvers.Mutation.createReportItemFromFields(null, { fieldValues, organisationId }, context);
        return rdfEntityFromObject("reportItem", item);
      }
      if (entityType === "report") {
        const report = await resolvers.Mutation.createReportFromFields(null, { fieldValues, selectedItemIds: [], organisationId }, context);
        return rdfEntityFromObject("report", report);
      }
      if (!RDF.classes?.[entityType]) throw new Error(`Unknown RDF entity type: ${entityType}`);

      const id = await nextEntityId(entityType);
      const idFieldName = entityIdField(entityType);
      const data = await allocateCreatedEntityInputs(entityType, {
        ...dataFromFieldValues(entityType, fieldValues),
        [idFieldName]: id,
        id,
      });
      const subject = entityUri(entityType, id);
      const triples = rdfTypeTriple(subject, RDF.classes[entityType])
        + triplesFromFields(subject, RDF[entityType]?.fields || {}, data)
        + triplesFromNestedGroups(subject, RDF[entityType]?.fields || {}, data);

      await syncEquivalentClassTriples();
      await runSparqlUpdate(`${PREFIXES} INSERT DATA {
        ${triples}
      }`);

      return rdfEntityFromObject(entityType, { ...data, uri: expandPrefixedName(subject) });
      });
    },

    deleteRdfEntity: async (_, { entityType, id, uri, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      if (entityType === "report") throw new Error("Reports must be deleted from the reports page");
      if (entityType === "reportItem") return resolvers.Mutation.deleteReportItem(null, { id, organisationId }, context);
      if (!RDF.classes?.[entityType]) throw new Error(`Unknown RDF entity type: ${entityType}`);

      const subject = subjectFromEntityIdentifier(entityType, id, uri);
      await deleteNestedGroupTriplesForSubject(entityType, subject);
      await runSparqlUpdate(`${PREFIXES}
        ${scopedSubjectDelete(subject)};
        DELETE WHERE {
          ?s ?p ${subject} .
        }
      `);
      if (await countClassInstances(RDF.classes[entityType]) === 0) {
        await deleteEquivalentClassTriplesForEntityType(entityType);
      }
      return true;
      });
    },

    updateRdfEntity: async (_, { entityType, id, uri, fieldValues, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      if (entityType === "report") throw new Error("Reports must be updated from the reports page");
      if (entityType === "reportItem") {
        const item = await resolvers.Mutation.updateReportItemFromFields(null, { id, fieldValues, organisationId }, context);
        return rdfEntityFromObject("reportItem", item);
      }
      if (!RDF.classes?.[entityType]) throw new Error(`Unknown RDF entity type: ${entityType}`);

      const subject = subjectFromEntityIdentifier(entityType, id, uri);
      const idFieldName = entityIdField(entityType);
      const data = {
        ...dataFromFieldValues(entityType, fieldValues),
        [idFieldName]: id,
        id,
      };
      const triples = rdfTypeTriple(subject, RDF.classes[entityType])
        + triplesFromFields(subject, RDF[entityType]?.fields || {}, data)
        + triplesFromNestedGroups(subject, RDF[entityType]?.fields || {}, data);

      await deleteNestedGroupTriplesForSubject(entityType, subject);
      await runSparqlUpdate(`${PREFIXES}
        DELETE WHERE {
          ${subject} ?p ?o .
        };
        INSERT DATA {
          ${triples}
        }
      `);

      return rdfEntityFromObject(entityType, { ...data, uri: uri || expandPrefixedName(entityUri(entityType, id)) });
      });
    },
  },
};

// Secure every query by default, leaving only me available for unauthenticated
// callers so the frontend can determine sign-in state.
for (const [name, resolver] of Object.entries(resolvers.Query)) {
  if (name === "me") continue;
  resolvers.Query[name] = (parent, args, context, info) => {
    requireAuth(context);
    return resolver(parent, args, context, info);
  };
}

// Secure mutations by default and require organisation data-write permission for
// data-changing operations outside account and organisation membership flows.
for (const [name, resolver] of Object.entries(resolvers.Mutation)) {
  if (["requestSignUpCode", "signUp", "signIn", "signOut"].includes(name)) continue;
  resolvers.Mutation[name] = async (parent, args, context, info) => {
    const user = requireAuth(context);
    const accountMutations = new Set(["updateMyAccount", "updateMyPassword"]);
    const organisationMutations = new Set([
      "createOrganisation",
      "provisionOrganisationRepository",
      "joinOrganisation",
      "leaveOrganisation",
      "updateOrganisation",
      "updateOrganisationMemberRole",
      "upsertOrganisationRole",
      "deleteOrganisation",
    ]);
    if (!accountMutations.has(name) && !organisationMutations.has(name)) {
      const canWriteData = await canWriteOrganisationData(user);
      if (!canWriteData) {
        throw new Error("You must be an organisation member or owner to change data.");
      }
    }
    return resolver(parent, args, context, info);
  };
}

export async function runDueReportAutomations() {
  const context = systemContext();
  const organisations = await listOrganisations(context.currentUser);
  const now = new Date();
  const results = [];

  for (const organisation of organisations) {
    if (automationRunLocks.has(organisation.id)) continue;
    automationRunLocks.add(organisation.id);
    try {
      const store = await readReportAutomationStore(organisation.id);
      const dueSchedules = store.schedules.filter(schedule => (
        schedule.enabled && Date.parse(schedule.nextRunAt || "") <= now.getTime()
      ));
      for (const schedule of dueSchedules) {
        try {
          const nextSchedule = await resolvers.Mutation.runReportAutomation(
            null,
            { id: schedule.id, organisationId: organisation.id },
            context
          );
          results.push({ organisationId: organisation.id, scheduleId: schedule.id, ok: true, nextSchedule });
        } catch (error) {
          results.push({ organisationId: organisation.id, scheduleId: schedule.id, ok: false, error: error.message });
        }
      }
    } finally {
      automationRunLocks.delete(organisation.id);
    }
  }

  return results;
}

export default resolvers;
