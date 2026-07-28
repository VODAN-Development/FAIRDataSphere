import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RDF } from "./defaultRdfStructure.js";

const structurePath = join(dirname(fileURLToPath(import.meta.url)), "reportRdfStructure.json");

// These keys describe group behavior rather than child fields, so they must be
// skipped when walking nested group subfields.
const GROUP_PROPERTY_NAMES = new Set([
  "label",
  "predicate",
  "previousPredicates",
  "inputType",
  "required",
  "encrypted",
  "resourceMode",
  "className",
  "targetEntityType",
  "targetClass",
  "targetTemplate",
  "targetLabelField",
  "importedFields",
]);
const LEGACY_EVENT_TYPE_OPTION_NAMES = new Set(Object.keys(DEFAULT_RDF.reportItem.fields.eventType.options || {}));

// Turn prefix config into the PREFIX block shared by all generated SPARQL.
function prefixesFromStructure(structure) {
  return Object.entries(structure.prefixes || DEFAULT_RDF.prefixes)
    .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
    .join("\n");
}

export let PREFIXES = prefixesFromStructure(DEFAULT_RDF);

// Structures are plain JSON-compatible objects, so JSON cloning is sufficient
// and keeps mutations from leaking into DEFAULT_RDF.
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function groupSubfieldEntries(group = {}) {
  // Imported class fields can carry a preferred order; local fields fall back to
  // their object-entry order.
  const entries = Object.entries(group || {})
    .filter(([key, field]) => !GROUP_PROPERTY_NAMES.has(key) && field && typeof field === "object" && field.predicate);
  if (!Array.isArray(group.importedFields)) return entries;

  const order = new Map(
    group.importedFields
      .map(key => String(key).split(".").pop())
      .map((key, index) => [key, index])
  );
  return entries.sort(([leftName], [rightName]) => (
    (order.get(leftName) ?? Number.MAX_SAFE_INTEGER)
    - (order.get(rightName) ?? Number.MAX_SAFE_INTEGER)
  ));
}

export function isGroupField(field = {}) {
  return !field.options && groupSubfieldEntries(field).length > 0;
}

export function isArrayField(field = {}) {
  return !!(field.allowMultiple || field.inputType === "uri-list" || field.inputType === "text-list");
}

function scalarFieldEntries(fields = {}) {
  return Object.entries(fields).filter(([, field]) => !isGroupField(field));
}

function groupFieldEntries(fields = {}) {
  return Object.entries(fields).filter(([, field]) => isGroupField(field));
}

function normalizeUnifiedFields(entity = {}) {
  // Earlier structures had separate arrays/nested buckets. Normalize them into a
  // single fields object so the rest of the code can use one traversal path.
  const fields = { ...(entity.fields || {}) };
  Object.entries(entity.arrays || {}).forEach(([name, field]) => {
    fields[name] = {
      ...field,
      inputType: field.inputType || "text-list",
      allowMultiple: field.allowMultiple ?? true,
    };
  });
  Object.entries(entity.nested || {}).forEach(([name, group]) => {
    fields[name] = {
      ...group,
      inputType: group.inputType || "location",
      resourceMode: "per-instance",
    };
  });
  const nextEntity = { ...entity, fields };
  delete nextEntity.arrays;
  delete nextEntity.nested;
  return nextEntity;
}

function mergeRdfStructure(defaultStructure, persistedStructure) {
  // Keep required core defaults while allowing persisted structures to override
  // editable fields and ontology metadata.
  const merged = { ...persistedStructure };
  merged.prefixes = { ...(defaultStructure.prefixes || {}), ...(persistedStructure.prefixes || {}) };
  for (const key of ["classes", "equivalentClasses", "uriTemplates"]) {
    merged[key] = persistedStructure[key] ? { ...persistedStructure[key] } : { ...(defaultStructure[key] || {}) };
  }
  merged.classProperties = Array.isArray(persistedStructure.classProperties)
    ? [...persistedStructure.classProperties]
    : [...(defaultStructure.classProperties || [])];
  for (const entityType of Object.keys(defaultStructure)) {
    if (!defaultStructure[entityType]?.fields) continue;
    if (!persistedStructure[entityType] && entityType !== "report" && entityType !== "reportItem") continue;
    merged[entityType] = {
      ...defaultStructure[entityType],
      ...(persistedStructure[entityType] || {}),
      fields: {
        ...(defaultStructure[entityType].fields || {}),
        ...(persistedStructure[entityType]?.fields || {}),
      },
    };
  }
  return merged;
}

export function defaultRdfStructure() {
  return normalizeStructure(deepClone(DEFAULT_RDF));
}

function loadPersistedStructure() {
  if (!existsSync(structurePath)) return normalizeStructure(deepClone(DEFAULT_RDF));
  return normalizeStructure(mergeRdfStructure(deepClone(DEFAULT_RDF), JSON.parse(readFileSync(structurePath, "utf8"))));
}

// RDF and PREFIXES are module-level because resolvers regenerate them when an
// organisation-specific structure becomes active.
export let RDF = loadPersistedStructure();
PREFIXES = prefixesFromStructure(RDF);

export function rdfStructureJson() {
  return JSON.stringify(RDF, null, 2);
}

export function updateRdfStructureFromJson(json) {
  const nextStructure = parseRdfStructureJson(json);
  RDF = nextStructure;
  PREFIXES = prefixesFromStructure(RDF);
  writeFileSync(structurePath, `${JSON.stringify(RDF, null, 2)}\n`);
  return rdfStructureJson();
}

export function applyRdfStructureFromJson(json) {
  // Apply without writing when a resolver is temporarily switching to an
  // organisation-specific structure for one request.
  const nextStructure = parseRdfStructureJson(json);
  RDF = nextStructure;
  PREFIXES = prefixesFromStructure(RDF);
  return rdfStructureJson();
}

export function reloadPersistedRdfStructure() {
  RDF = loadPersistedStructure();
  PREFIXES = prefixesFromStructure(RDF);
  return rdfStructureJson();
}

export function parseRdfStructureJson(json, { strict = false } = {}) {
  const nextStructure = normalizeStructure(JSON.parse(json));
  validateRdfStructure(nextStructure);
  if (strict) validateDuplicateQueryablePredicates(nextStructure);
  return nextStructure;
}

function validateRdfStructure(structure) {
  // Core report fields are required because resolvers and report metadata updates
  // depend on these predicates always existing.
  const requiredPaths = [
    ["prefixes", "sitrep"],
    ["prefixes", "resource"],
    ["classes", "report"],
    ["classes", "reportItem"],
    ["uriTemplates", "report"],
    ["uriTemplates", "reportItem"],
    ["reportItem", "fields", "entryNumber"],
    ["reportItem", "fields", "createdAt"],
    ["reportItem", "fields", "updatedAt"],
    ["report", "fields", "title"],
    ["report", "fields", "createdAt"],
    ["report", "fields", "updatedAt"],
    ["report", "fields", "selectedItems"],
  ];

  requiredPaths.forEach(path => {
    const found = path.reduce((value, key) => value?.[key], structure);
    if (!found) throw new Error(`RDF structure is missing ${path.join(".")}`);
  });

  Object.entries(structure.uriTemplates || {}).forEach(([entityType, template]) => {
    const token = uriTemplateToken(template);
    if (!token) throw new Error(`URI template for ${entityType} must include an ID placeholder, such as {id}`);
    const idField = structure[entityType]?.idField;
    if (idField && token !== idField) {
      throw new Error(`URI template placeholder {${token}} for ${entityType} must match idField "${idField}"`);
    }
  });
}

function duplicatePredicatesInFields(fields = {}, contextPath) {
  const byPredicate = new Map();
  Object.entries(fields || {}).forEach(([fieldName, field]) => {
    if (!field || typeof field !== "object" || !field.predicate || field.generated || field.metadataOnly) return;
    const fieldPaths = byPredicate.get(field.predicate) || [];
    fieldPaths.push(`${contextPath}.${fieldName}`);
    byPredicate.set(field.predicate, fieldPaths);
  });

  const issues = Array.from(byPredicate.entries())
    .filter(([, paths]) => paths.length > 1)
    .map(([predicate, paths]) => ({ predicate, paths }));

  Object.entries(fields || {}).forEach(([fieldName, field]) => {
    if (!field || typeof field !== "object") return;
    if (isGroupField(field)) {
      issues.push(...duplicatePredicatesInFields(
        Object.fromEntries(groupSubfieldEntries(field)),
        `${contextPath}.${fieldName}`
      ));
    }
    Object.entries(field.options || {}).forEach(([optionName, option]) => {
      issues.push(...duplicatePredicatesInFields(
        option.fields || {},
        `${contextPath}.${fieldName}.options.${optionName}`
      ));
    });
  });

  return issues;
}

export function duplicateQueryablePredicateIssues(structure = RDF) {
  return Object.keys({ ...(structure.classes || {}), ...(structure.uriTemplates || {}) })
    .flatMap(entityType => duplicatePredicatesInFields(structure[entityType]?.fields || {}, entityType));
}

export function validateDuplicateQueryablePredicates(structure = RDF) {
  const issues = duplicateQueryablePredicateIssues(structure);
  if (issues.length === 0) return;
  const summary = issues
    .slice(0, 5)
    .map(issue => `${issue.predicate} is used by ${issue.paths.join(", ")}`)
    .join("; ");
  const extra = issues.length > 5 ? `; and ${issues.length - 5} more duplicate predicate group(s)` : "";
  throw new Error(`RDF structure has duplicate predicates that would make data queries ambiguous: ${summary}${extra}`);
}

function normalizeStructure(structure) {
  // The normalizer accepts older saved shapes and fills derived defaults so every
  // caller can assume classes, URI templates, and generated ID fields exist.
  const normalized = { ...structure };
  normalized.prefixes = normalized.prefixes || {
    sitrep: normalized.namespace || "http://sitrep.example.org/",
    resource: normalized.namespace || "http://sitrep.example.org/",
    xsd: DEFAULT_RDF.prefixes.xsd,
    rdf: DEFAULT_RDF.prefixes.rdf,
    rdfs: DEFAULT_RDF.prefixes.rdfs,
    owl: DEFAULT_RDF.prefixes.owl,
  };
  normalized.uriTemplates = normalized.uriTemplates || {
    report: `${Object.keys(normalized.prefixes).includes("resource") ? "resource" : "sitrep"}:${normalized.uriPrefixes?.report || "Report_"}{reportNumber}`,
    reportItem: `${Object.keys(normalized.prefixes).includes("resource") ? "resource" : "sitrep"}:${normalized.uriPrefixes?.reportItem || "ReportItem_"}{entryNumber}`,
  };
  normalized.classes = {
    ...(normalized.classes || {}),
    report: DEFAULT_RDF.classes.report,
    reportItem: DEFAULT_RDF.classes.reportItem,
  };
  normalized.equivalentClasses = normalized.equivalentClasses || {};
  normalized.classProperties = Array.isArray(normalized.classProperties) ? normalized.classProperties : [];
  normalized.uriTemplates = {
    ...(normalized.uriTemplates || {}),
    report: DEFAULT_RDF.uriTemplates.report,
    reportItem: DEFAULT_RDF.uriTemplates.reportItem,
  };
  Object.keys({ ...normalized.classes, ...normalized.uriTemplates }).forEach(entityType => {
    normalized[entityType] = normalizeEntityStructure(entityType, normalizeUnifiedFields(normalized[entityType]), normalized.uriTemplates?.[entityType]);
  });
  normalized.report = normalized.report || DEFAULT_RDF.report;
  normalized.report.fields = normalized.report.fields || {};
  normalized.report.idField = DEFAULT_RDF.report.idField;
  if (normalized.report.fields.id?.generated) delete normalized.report.fields.id;
  normalized.report.fields.reportNumber = DEFAULT_RDF.report.fields.reportNumber;
  normalized.report.fields.updatedAt = {
    ...DEFAULT_RDF.report.fields.updatedAt,
    ...(normalized.report.fields.updatedAt || {}),
    generated: true,
  };
  normalized.report.fields.selectedItems = {
    ...DEFAULT_RDF.report.fields.selectedItems,
    ...(normalized.report.fields.selectedItems || normalized.report.selectedItems || {}),
    metadataOnly: true,
  };
  delete normalized.report.selectedItems;
  delete normalized.report.fieldOrder;
  normalized.uriTemplates.report = DEFAULT_RDF.uriTemplates.report;
  normalizeEventTypeOptions(normalized);
  normalizeCreateEntityTemplates(normalized);
  stripDirectionSettings(normalized);
  return normalized;
}

function stripDirectionSettings(structure) {
  // Direction used to be editable UI metadata. It is now derived elsewhere, so
  // persisted structures should not keep stale direction flags.
  Object.keys({ ...(structure.classes || {}), ...(structure.uriTemplates || {}) }).forEach(entityType => {
    stripDirectionSettingsFromFields(structure[entityType]?.fields || {});
  });
}

function stripDirectionSettingsFromFields(fields = {}) {
  Object.values(fields || {}).forEach(field => {
    if (!field || typeof field !== "object") return;
    delete field.direction;
    Object.values(field.options || {}).forEach(option => {
      delete option.direction;
      stripDirectionSettingsFromFields(option.fields || {});
    });
    if (isGroupField(field)) {
      stripDirectionSettingsFromFields(Object.fromEntries(groupSubfieldEntries(field)));
    }
  });
}

function normalizeCreateEntityTemplates(structure) {
  // Linked fields need enough target metadata to create or reference entities
  // from user input without additional frontend configuration.
  Object.keys({ ...(structure.classes || {}), ...(structure.uriTemplates || {}) }).forEach(entityType => {
    normalizeCreateEntityTemplatesForFields(structure, structure[entityType]?.fields || {});
    normalizeNestedGroupPredicates(Object.fromEntries(groupFieldEntries(structure[entityType]?.fields || {})));
    groupFieldEntries(structure[entityType]?.fields || {}).forEach(([, group]) => {
      normalizeCreateEntityTemplatesForFields(structure, group || {});
    });
  });
}

function normalizeNestedGroupPredicates(groups) {
  Object.entries(groups || {}).forEach(([groupName, group]) => {
    if (!group || typeof group !== "object") return;
    group.predicate = group.predicate || `sitrep:${groupName}`;
    group.resourceMode = "per-instance";
  });
}

function labelFieldForEntityInStructure(structure, entityType) {
  const fields = structure?.[entityType]?.fields || {};
  if (fields.name && !fields.name.generated && !fields.name.metadataOnly) return "name";
  return Object.entries(fields).find(([, field]) => !field.generated && !field.metadataOnly)?.[0]
    || structure?.[entityType]?.idField
    || "name";
}

function normalizeCreateEntityTemplatesForFields(structure, fields) {
  Object.values(fields || {}).forEach(field => {
    if (!field || typeof field !== "object") return;
    if (field.inputType === "import-class") {
      delete field.allowMultiple;
    }
    if (field.targetEntityType) {
      field.targetClass = field.targetClass || structure.classes?.[field.targetEntityType];
      field.targetTemplate = field.targetTemplate || structure.uriTemplates?.[field.targetEntityType];
      const targetFields = structure[field.targetEntityType]?.fields || {};
      const isNestedGroup = isGroupField(field);
      if (!isNestedGroup && (!field.targetLabelField || !targetFields[field.targetLabelField])) {
        field.targetLabelField = labelFieldForEntityInStructure(structure, field.targetEntityType);
      }
      if (!isNestedGroup && field.targetLabelField && field.createEntityFromInput === undefined) {
        field.createEntityFromInput = true;
      }
    }
    Object.values(field.options || {}).forEach(option => {
      if (option.targetEntityType) {
        option.targetClass = option.targetClass || structure.classes?.[option.targetEntityType];
        option.targetTemplate = option.targetTemplate || structure.uriTemplates?.[option.targetEntityType];
      }
      normalizeCreateEntityTemplatesForFields(structure, option.fields || {});
    });
  });
}

function defaultIdFieldName(entityType) {
  if (entityType === "reportItem") return "entryNumber";
  if (entityType === "report") return "reportNumber";
  return "id";
}

function defaultIdField(entityType, fieldName = defaultIdFieldName(entityType)) {
  if (entityType === "reportItem" && fieldName === "entryNumber") {
    return DEFAULT_RDF.reportItem.fields.entryNumber;
  }
  if (entityType === "report" && fieldName === "reportNumber") {
    return DEFAULT_RDF.report.fields.reportNumber;
  }
  return {
    predicate: `sitrep:${fieldName === "id" ? `${entityType}Id` : fieldName}`,
    datatype: "xsd:integer",
    required: true,
    parse: "int",
    generated: true,
    label: "ID",
    inputType: "number",
  };
}

function normalizeEntityStructure(entityType, entity = {}, uriTemplate = "") {
  const previousIdField = entity.idField;
  const idField = uriTemplateToken(uriTemplate) || entity.idField || defaultIdFieldName(entityType);
  const fields = { ...(entity.fields || {}) };
  if (previousIdField && previousIdField !== idField && fields[previousIdField]?.generated) {
    delete fields[previousIdField];
  }
  const normalized = {
    ...entity,
    idField,
    fields: {
      [idField]: defaultIdField(entityType, idField),
      ...fields,
      ...(fields[idField] ? { [idField]: { ...defaultIdField(entityType, idField), ...fields[idField], generated: true } } : {}),
    },
  };
  delete normalized.fieldOrder;
  return normalized;
}

function normalizeEventTypeOptions(structure) {
  // Legacy event-type groups are converted into conditional options so old
  // structures still render in the current DynamicFieldForm.
  const reportItem = structure.reportItem || {};
  reportItem.fields = reportItem.fields || {};
  const eventType = reportItem.fields.eventType || {
    predicate: "sitrep:eventType",
    required: true,
    label: "Event Type",
  };

  eventType.inputType = "select";
  eventType.objectType = "uri";
  eventType.options = eventType.options || {};
  eventType.options = Object.fromEntries(
    Object.entries(eventType.options).map(([optionName, option]) => [
      optionName,
      normalizeEventTypeOption(optionName, option),
    ])
  );

  groupFieldEntries(reportItem.fields).forEach(([groupName, group]) => {
    if (!LEGACY_EVENT_TYPE_OPTION_NAMES.has(groupName)) return;
    eventType.options[groupName] = normalizeEventTypeOption(groupName, group);
    delete reportItem.fields[groupName];
  });

  reportItem.fields.eventType = eventType;
  delete reportItem.fieldOrder;
}

function normalizeEventTypeOption(optionName, option) {
  if (option.fields) {
    return {
      ...option,
      value: option.value || classValueForOption(optionName),
    };
  }
  const { label = optionName, inputType = "text", ...fields } = option || {};
  return {
    label,
    value: classValueForOption(optionName),
    inputType,
    fields: Object.fromEntries(
      Object.entries(fields).filter(([, field]) => field && typeof field === "object" && field.predicate)
    ),
  };
}

function classValueForOption(optionName) {
  const words = String(optionName || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const localName = words.length
    ? words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join("")
    : "Option";
  return `sitrep:${localName}`;
}

export function editableFieldEntries(entityType) {
  // GraphQL exposes a UI-friendly array form instead of the internal keyed map.
  const entity = RDF[entityType];
  const fieldKind = field => field.inputType === "import-class"
    ? "importClass"
    : isGroupField(field)
    ? "group"
    : field.options
    ? "conditional"
    : isArrayField(field)
      ? "array"
      : "scalar";
  function editableOption(optionName, option) {
    return {
      ...option,
      name: optionName,
      label: option.label || optionName,
      value: option.value || classValueForOption(optionName),
      subfields: Object.entries(option.fields || {})
        .map(([subfieldName, subfield]) => editableSubfield(subfieldName, subfield)),
    };
  }

  function editableSubfield(name, field) {
    return {
      ...field,
      name,
      kind: fieldKind(field),
      options: field.options
        ? Object.entries(field.options).map(([optionName, option]) => editableOption(optionName, option))
        : undefined,
      subfields: isGroupField(field)
        ? groupSubfieldEntries(field).map(([subfieldName, subfield]) => editableSubfield(subfieldName, subfield))
        : undefined,
    };
  }
  const scalarFields = Object.entries(entity.fields || {})
    .filter(([, field]) => !field.generated && !field.metadataOnly)
    .map(([name, field]) => ({
      ...field,
      name,
      kind: fieldKind(field),
      options: field.options
        ? Object.entries(field.options).map(([optionName, option]) => editableOption(optionName, option))
        : undefined,
      subfields: isGroupField(field)
        ? groupSubfieldEntries(field).map(([subfieldName, subfield]) => editableSubfield(subfieldName, subfield))
        : undefined,
    }));

  return scalarFields;
}

export function escapeSparqlString(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function entityUri(entityType, id) {
  // Entity URIs are generated from the active RDF structure so organisations can
  // customize templates without changing resolver code.
  return applyTemplate(RDF.uriTemplates[entityType], entityTemplateValues(entityType, id));
}

export function nestedGroupUri(parentSubject, groupName) {
  // Per-instance nested groups live under the parent subject to avoid collisions
  // between repeated group names across entities.
  if (!parentSubject) return null;
  if (String(parentSubject).startsWith("<")) {
    return String(parentSubject).replace(/>$/, `_${groupName}>`);
  }
  return `${parentSubject}_${groupName}`;
}

export function nestedGroupSubject(parentSubject, groupName, group, groupData = {}) {
  if (group?.targetEntityType && groupData?.id) {
    const template = group.targetTemplate || RDF.uriTemplates?.[group.targetEntityType];
    if (template) {
      return applyTemplate(template, entityTemplateValues(group.targetEntityType, groupData.id));
    }
  }
  return nestedGroupUri(parentSubject, groupName);
}

function groupInputObject(group, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...value };
  const labelFieldName = group.targetLabelField
    || groupSubfieldEntries(group).find(([fieldName]) => fieldName === "name")?.[0]
    || groupSubfieldEntries(group)[0]?.[0]
    || "name";
  return value === undefined || value === null || value === "" ? {} : { [labelFieldName]: value };
}

export function entityIri(entityType, id) {
  return termToIri(entityUri(entityType, id));
}

export function entityIdFromUri(entityType, uri) {
  const token = entityUriToken(entityType);
  const template = RDF.uriTemplates[entityType];
  const absoluteTemplate = expandPrefixedName(template);
  const [beforeToken, afterToken = ""] = absoluteTemplate.split(`{${token}}`);
  return String(uri).replace(beforeToken, "").replace(afterToken, "");
}

export function entityIdReplacePattern(entityType) {
  return entityIdReplacePatternForStructure(RDF, entityType);
}

export function entityIdReplacePatternForStructure(structure, entityType) {
  const token = entityUriToken(entityType, structure);
  if (structure.uriTemplates?.[entityType]) {
    const template = structure.uriTemplates[entityType];
    const absoluteTemplate = String(template).replace(/^([A-Za-z][\w-]*):(.*)$/, (_, prefix, localName) => {
      return structure.prefixes?.[prefix] ? `${structure.prefixes[prefix]}${localName}` : template;
    });
    return absoluteTemplate.split(`{${token}}`)[0];
  }
  if (structure.namespace && structure.uriPrefixes?.[entityType]) {
    return `${structure.namespace}${structure.uriPrefixes[entityType]}`;
  }
  return "";
}

export function entityIdField(entityType) {
  return RDF[entityType]?.idField || defaultIdFieldName(entityType);
}

export function entityTemplateValues(entityType, id) {
  const idField = entityIdField(entityType);
  return {
    id,
    entryNumber: id,
    slug: id,
    [idField]: id,
  };
}

export function entityUriToken(entityType, structure = RDF) {
  const template = structure.uriTemplates?.[entityType] || "";
  const token = uriTemplateToken(template);
  return token || structure[entityType]?.idField || defaultIdFieldName(entityType);
}

function uriTemplateToken(template) {
  return String(template || "").match(/\{([^}]+)\}/)?.[1];
}

export function applyTemplate(template, values) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function resourceTermFromLabel(value) {
  const localName = String(value)
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
  return `resource:${localName}`;
}

export function expandPrefixedName(term) {
  const match = String(term).match(/^([A-Za-z][\w-]*):(.*)$/);
  if (!match) return term;
  const [, prefix, localName] = match;
  return RDF.prefixes?.[prefix] ? `${RDF.prefixes[prefix]}${localName}` : term;
}

export function termToIri(term) {
  if (!term) return null;
  const trimmedTerm = String(term).trim();
  if (trimmedTerm.startsWith("<")) return trimmedTerm;
  // Plain labels become resource IRIs so text input can create linked entities.
  const safeTerm = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmedTerm)
    ? trimmedTerm
    : resourceTermFromLabel(trimmedTerm);
  return `<${expandPrefixedName(safeTerm)}>`;
}

export function literal(value, datatype) {
  if (value === null || value === undefined) return null;
  const escapedValue = datatype === "xsd:integer" ? String(value) : escapeSparqlString(value);
  const typedSuffix = datatype ? `^^${datatype}` : "";
  return `"${escapedValue}"${typedSuffix}`;
}

export function objectTerm(value, field = {}) {
  // Field metadata decides whether a value is emitted as an IRI or a typed
  // literal in generated triples.
  if (value === null || value === undefined || value === "") return null;
  if (field.objectType === "uri") return termToIri(value);
  return literal(value, field.datatype);
}

export function triple(subject, predicate, value, datatypeOrField) {
  const field = typeof datatypeOrField === "object" ? datatypeOrField : { datatype: datatypeOrField };
  const object = objectTerm(value, field);
  if (!object) return "";
  return `${subject} ${predicate} ${object} .\n`;
}

export function rdfTypeTriple(subject, className) {
  return `${subject} rdf:type ${className} .\n`;
}

export function classTermForEquivalentClass(structure, equivalentClass) {
  return structure.classes?.[equivalentClass] || equivalentClass;
}

export function equivalentClassValues(equivalentClass) {
  if (Array.isArray(equivalentClass)) return equivalentClass.filter(Boolean);
  return equivalentClass ? [equivalentClass] : [];
}

export function classTermForEntityOrClass(structure, value) {
  return structure.classes?.[value] || value;
}

export function classPropertyTriples(structure = RDF) {
  // Support both the older equivalentClasses map and the newer explicit
  // classProperties array while producing one canonical triple list.
  const legacyEquivalentTriples = Object.entries(structure.equivalentClasses || {})
    .flatMap(([entityType, equivalentClass]) => {
      const className = structure.classes?.[entityType];
      return equivalentClassValues(equivalentClass).map(value => ({
        subject: className,
        predicate: "owl:equivalentClass",
        object: classTermForEquivalentClass(structure, value),
      }));
    });

  const explicitTriples = (structure.classProperties || []).map(property => ({
    subject: classTermForEntityOrClass(structure, property.subject),
    predicate: property.predicate,
    object: classTermForEntityOrClass(structure, property.object),
  }));

  return [...legacyEquivalentTriples, ...explicitTriples]
    .filter(property => property.subject && property.predicate && property.object);
}

export function ontologyTriples(structure = RDF) {
  return classPropertyTriples(structure)
    .map(({ subject, predicate, object }) => `${subject} ${predicate} ${object} .\n`)
    .join("");
}

export function selectVariables(fields) {
  return Object.keys(fields).map(fieldName => `?${fieldName}`).join(" ");
}

export function fieldPatterns(subject, fields) {
  // Query patterns mirror field definitions and make optional fields optional in
  // SPARQL so missing values do not hide the whole entity.
  const seenOptionalPredicates = new Set();
  return Object.entries(fields)
    .map(([fieldName, field]) => {
      if (!field.required && field.predicate) {
        if (seenOptionalPredicates.has(field.predicate)) return "";
        seenOptionalPredicates.add(field.predicate);
      }
      if (field.options) {
        const optionPatterns = Object.values(field.options).map(() => `{ ${subject} ${field.predicate} ?${fieldName} . }`);
        const pattern = optionPatterns.length > 0
          ? optionPatterns.join("\nUNION\n")
          : `${subject} ${field.predicate} ?${fieldName} .`;
        return field.required ? pattern : `OPTIONAL { ${pattern} }`;
      }
      const triplePattern = `${subject} ${field.predicate} ?${fieldName} .`;
      const pattern = triplePattern;
      return field.required ? pattern : `OPTIONAL { ${pattern} }`;
    })
    .filter(Boolean)
    .join("\n");
}

export function objectFromBinding(binding, fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([fieldName, field]) => {
      const value = binding[fieldName]?.value;
      if (value === undefined) return [fieldName, undefined];
      if (field.objectType === "uri") return [fieldName, value];
      return [fieldName, field.parse === "int" ? parseInt(value, 10) : value];
    })
  );
}

export function triplesFromFields(subject, fields, data) {
  // Scalar, array, linked, and conditional fields all produce triples through
  // this path; nested groups are handled separately below.
  const sharedLinkedEntityIds = sharedLinkedEntityIdsForFields(fields, data);
  return scalarFieldEntries(fields)
    .map(([fieldName, field]) => {
      if (field.options) return triplesFromConditionalField(subject, fieldName, field, data[fieldName]);
      return triplesFromFieldValue(subject, field, data[fieldName], sharedLinkedEntityIds.get(linkedEntityGroupKey(field)));
    })
    .join("");
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
  if (value && typeof value === "object") return Object.values(value).some(fieldHasInputValue);
  return String(value || "").trim() !== "";
}

function firstAllocatedLinkedEntityId(value) {
  const values = Array.isArray(value) ? value : [value];
  const match = values.find(candidate => (
    candidate
    && typeof candidate === "object"
    && candidate.id !== undefined
    && !candidate.uri
  ));
  return match?.id;
}

function sharedLinkedEntityIdsForFields(fields = {}, data = {}) {
  // When multiple fields create the same linked entity in one form submission,
  // share the allocated ID so both predicates point to the same resource.
  const entriesByKey = new Map();
  for (const [fieldName, field] of Object.entries(fields || {})) {
    if (!field || typeof field !== "object") continue;
    if (!fieldHasInputValue(data[fieldName])) continue;
    const shouldShare = field.createEntityFromInput || (isGroupField(field) && field.targetEntityType);
    if (!shouldShare) continue;
    const key = linkedEntityGroupKey(field);
    if (!key) continue;
    entriesByKey.set(key, [...(entriesByKey.get(key) || []), { field, value: data[fieldName] }]);
  }

  return new Map(Array.from(entriesByKey.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => [
      key,
      entries.map(entry => firstAllocatedLinkedEntityId(entry.value) ?? entry.value?.id).find(id => id !== undefined),
    ])
    .filter(([, id]) => id !== undefined));
}

function valuesForField(value, field) {
  if (field.allowMultiple || field.inputType === "uri-list" || field.inputType === "text-list") {
    return Array.isArray(value) ? value.filter(Boolean) : String(value || "").split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
  }
  return value === undefined || value === null || value === "" ? [] : [value];
}

function entityTriplesFromInput(entitySubject, entityType, input, field) {
  const className = field.targetClass || RDF.classes?.[entityType];
  const idFieldName = entityIdField(entityType);
  const idField = RDF[entityType]?.fields?.[idFieldName];
  const labelFieldName = field.targetLabelField || "name";
  const labelField = RDF[entityType]?.fields?.[labelFieldName] || { predicate: "rdfs:label" };
  let triples = className ? rdfTypeTriple(entitySubject, className) : "";
  if (idField) triples += triple(entitySubject, idField.predicate, input.id, idField);
  triples += triple(entitySubject, labelField.predicate, input.label, labelField);
  return triples;
}

function triplesFromFieldValue(subject, field, value, sharedId = null) {
  // createEntityFromInput turns label text into a new target entity plus a link
  // from the current subject to that entity.
  return valuesForField(value, field)
    .map(inputValue => {
      if (!field.createEntityFromInput) return triple(subject, field.predicate, inputValue, field);
      if (typeof inputValue === "object" && inputValue.uri) {
        return triple(subject, field.predicate, inputValue.uri, { ...field, objectType: "uri", createEntityFromInput: false });
      }

      const entityType = field.targetEntityType;
      const template = field.targetTemplate || (entityType ? RDF.uriTemplates?.[entityType] : null);
      const inputLabel = typeof inputValue === "object" ? inputValue.label : inputValue;
      const inputId = sharedId ?? (typeof inputValue === "object" ? inputValue.id : slugify(inputValue));
      const entitySubject = template
        ? applyTemplate(template, entityTemplateValues(entityType, inputId))
        : inputValue;

      return entityTriplesFromInput(entitySubject, entityType, { label: inputLabel, id: inputId }, field)
        + triple(subject, field.predicate, entitySubject, { ...field, objectType: "uri", createEntityFromInput: false });
    })
    .join("");
}

function triplesFromConditionalField(subject, fieldName, field, value) {
  const selectedOption = typeof value === "object" ? value?.selectedOption : value;
  if (!selectedOption) return "";

  const option = field.options?.[selectedOption];
  let triples = triplesFromConditionalOption(subject, field, selectedOption, option);
  const optionValues = typeof value === "object" ? value?.values || {} : {};
  const sharedLinkedEntityIds = sharedLinkedEntityIdsForFields(option?.fields || {}, optionValues);
  triples += triplesFromFields(subject, option?.fields || {}, optionValues);
  triples += triplesFromNestedGroups(subject, option?.fields || {}, optionValues, sharedLinkedEntityIds);
  return triples;
}

function triplesFromConditionalOption(subject, field, selectedOption, option = {}) {
  const optionValue = option?.value || selectedOption;
  const optionField = {
    ...field,
    ...option,
    predicate: field.predicate,
    objectType: option.objectType || field.objectType,
  };
  if (!option.createEntityFromInput) return triple(subject, field.predicate, optionValue, optionField);

  const entityType = option.targetEntityType;
  const template = option.targetTemplate || (entityType ? RDF.uriTemplates?.[entityType] : null);
  const inputId = optionValue ? slugify(optionValue) : slugify(selectedOption);
  const entitySubject = optionValue || (template
    ? applyTemplate(template, entityTemplateValues(entityType, inputId))
    : selectedOption);

  return entityTriplesFromInput(entitySubject, entityType, { label: option.label || selectedOption, id: inputId }, option)
    + triple(subject, field.predicate, entitySubject, { ...optionField, objectType: "uri", createEntityFromInput: false });
}

export function triplesFromNestedGroups(subject, groups, data, sharedLinkedEntityIds = sharedLinkedEntityIdsForFields(groups, data)) {
  // Nested groups are emitted as separate resources and then linked from the
  // parent subject, preserving group structure in RDF.
  return groupFieldEntries(groups || {})
    .map(([groupName, group]) => {
      const rawGroupValue = data[groupName];
      const groupValues = group.allowMultiple
        ? (Array.isArray(rawGroupValue) ? rawGroupValue : (rawGroupValue ? [rawGroupValue] : []))
        : [rawGroupValue || {}];
      const sharedId = group.allowMultiple ? undefined : sharedLinkedEntityIds.get(linkedEntityGroupKey(group));

      return groupValues
        .map((rawGroupData, groupIndex) => {
          const groupData = {
            ...groupInputObject(group, rawGroupData),
            ...(sharedId !== undefined ? { id: sharedId } : {}),
          };
          const groupSubject = nestedGroupSubject(
            subject,
            group.allowMultiple ? `${groupName}_${groupIndex + 1}` : groupName,
            group,
            groupData
          );
          const sharedNestedIds = sharedLinkedEntityIdsForFields(group, groupData);
          const subfieldTriples = triplesFromFields(groupSubject, group, groupData)
            + triplesFromNestedGroups(groupSubject, group, groupData, sharedNestedIds);
          if (!subfieldTriples || !group.predicate) return subfieldTriples;
          const groupTypeTriple = group.className ? rdfTypeTriple(groupSubject, group.className) : "";
          const idFieldName = group.targetEntityType ? entityIdField(group.targetEntityType) : null;
          const idField = idFieldName ? RDF[group.targetEntityType]?.fields?.[idFieldName] : null;
          const idTriple = idField && groupData.id !== undefined
            ? triple(groupSubject, idField.predicate, groupData.id, idField)
            : "";
          return triple(subject, group.predicate, groupSubject, { objectType: "uri" }) + groupTypeTriple + idTriple + subfieldTriples;
        })
        .join("");
    })
    .join("");
}

export function reportItemTriples(item) {
  // Report items include type triples, editable fields, and any nested/linked
  // group resources generated by the active structure.
  const subject = entityUri("reportItem", item.entryNumber);
  const sharedLinkedEntityIds = sharedLinkedEntityIdsForFields(RDF.reportItem.fields, item);
  let triples = rdfTypeTriple(subject, RDF.classes.reportItem);
  triples += triplesFromFields(subject, RDF.reportItem.fields, item);
  triples += triplesFromNestedGroups(subject, RDF.reportItem.fields, item, sharedLinkedEntityIds);

  return triples;
}

export function reportTriples(report) {
  // Reports use the same field machinery, then add report-item membership links
  // from selectedItemIds.
  const subject = entityUri("report", report.id);
  const sharedLinkedEntityIds = sharedLinkedEntityIdsForFields(RDF.report.fields, report);
  let triples = rdfTypeTriple(subject, RDF.classes.report);
  triples += triplesFromFields(subject, RDF.report.fields, report);
  triples += triplesFromNestedGroups(subject, RDF.report.fields, report, sharedLinkedEntityIds);
  (report.selectedItemIds || []).forEach(id => {
    const field = RDF.report.fields.selectedItems;
    const value = field.targetTemplate ? applyTemplate(field.targetTemplate, { entryNumber: id, id }) : id;
    triples += triple(subject, field.predicate, value, field);
  });
  return triples;
}

export function itemReportMetadataTriples(itemId, report) {
  const subject = entityUri("reportItem", itemId);
  return triplesFromFields(subject, pickFields(RDF.reportItem.fields, RDF.itemReportMetadataFields), {
    reportId: report.id,
    reportTitle: report.title,
    reportNumber: report.reportNumber,
    reportDate: report.reportDate,
  });
}

export function pickFields(fields, fieldNames) {
  return Object.fromEntries(
    (fieldNames || [])
      .filter(fieldName => fields[fieldName])
      .map(fieldName => [fieldName, fields[fieldName]])
  );
}
