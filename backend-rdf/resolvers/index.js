import { runSparqlQuery, runSparqlUpdate, withRepository } from "../services/allegroClient.js";
import { decryptFieldValueSafe, encryptFieldValue } from "../services/fieldEncryption.js";
import { authenticateUser, createUser, updateUserPassword, updateUserProfile } from "../auth/authStore.js";
import {
  canViewOrganisation,
  canWriteOrganisation,
  canWriteOrganisationData,
  createOrganisation,
  deleteOrganisation,
  joinOrganisation,
  listMyOrganisations,
  listOrganisations,
  organisationRdfStructureJson,
  organisationRepositoryConfig,
  updateOrganisationRdfStructureJson,
  updateOrganisation,
  updateOrganisationMemberRole,
} from "../auth/organisationStore.js";
import { requireAuth } from "../auth/requireAuth.js";
import { createSessionToken, sessionCookieName, sessionCookieOptions } from "../auth/tokens.js";
import {
  PREFIXES,
  RDF,
  classTermForEquivalentClass,
  classPropertyTriples,
  defaultRdfStructure,
  entityIdField,
  equivalentClassValues,
  editableFieldEntries,
  entityIdReplacePattern,
  entityIdReplacePatternForStructure,
  entityIdFromUri,
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
  triplesFromFields,
  triplesFromNestedGroups,
  applyRdfStructureFromJson,
  triple,
  termToIri,
  applyTemplate,
} from "../rdf/reportRdfConfig.js";

function maxNumericBinding(result, variableName) {
  const values = result.results.bindings
    .map(binding => parseInt(binding[variableName]?.value, 10))
    .filter(Number.isFinite);

  return values.length > 0 ? Math.max(...values) : 0;
}

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
      ${className ? `?entity rdf:type ${className} .` : "?entity ?p ?o ."}
    }
    LIMIT 1
  `);
  return result.results.bindings.length > 0;
}

async function nextEntityId(entityType) {
  const idFieldName = entityIdField(entityType);
  const idField = RDF[entityType]?.fields?.[idFieldName];
  const className = RDF.classes?.[entityType];
  const idValues = [];

  if (idField?.predicate && className) {
    const fieldResult = await runSparqlQuery(`${PREFIXES}
      SELECT ?id WHERE {
        ?entity rdf:type ${className} ;
                ${idField.predicate} ?id .
      }
    `);
    idValues.push(maxNumericBinding(fieldResult, "id"));
  }

  if (className && RDF.uriTemplates?.[entityType]) {
    const uriResult = await runSparqlQuery(`${PREFIXES}
      SELECT ?id WHERE {
        ?entity rdf:type ${className} .
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

async function allocateEntityInput(fieldName, field, value, nextIds) {
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

    if (!nextIds.has(targetEntityType)) {
      nextIds.set(targetEntityType, await nextEntityId(targetEntityType));
    }
    const id = nextIds.get(targetEntityType);
    nextIds.set(targetEntityType, id + 1);
    allocatedValues.push({ id, label });
  }

  return field.allowMultiple || field.inputType === "uri-list" || field.inputType === "text-list"
    ? allocatedValues
    : allocatedValues[0];
}

async function allocateCreatedEntityInputs(entityType, data, nextIds = new Map()) {
  const nextData = { ...data };
  const entity = RDF[entityType] || {};

  for (const [fieldName, field] of Object.entries(entity.fields || {})) {
    if (isGroupField(field)) {
      nextData[fieldName] = await allocateCreatedEntityInputsForFields(field, nextData[fieldName] || {}, nextIds);
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
    nextData[fieldName] = await allocateEntityInput(fieldName, field, nextData[fieldName], nextIds);
  }
  return nextData;
}

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
    .map(([fieldName, field]) => `DELETE WHERE { ${subject} ${field.predicate} ?${fieldName} . }`)
    .join(";\n");

  await runSparqlUpdate(`${PREFIXES}
    ${deletes}
  `);
}

async function deleteNestedGroupTriplesForSubject(entityType, subject) {
  const deletes = Object.entries(RDF[entityType]?.fields || {})
    .filter(([, group]) => isGroupField(group))
    .filter(([, group]) => group?.resourceMode !== "reusable")
    .map(([groupName]) => `DELETE WHERE { ${nestedGroupUri(subject, groupName)} ?p ?o . }`)
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

async function loadReportItemCollections(item) {
  const subject = entityUri("reportItem", item.entryNumber);

  for (const [fieldName, field] of Object.entries(RDF.reportItem.fields || {}).filter(([, field]) => isArrayField(field) && !field.options)) {
    const variable = sparqlVariableName(fieldName, field);
    const pattern = `${subject} ${field.predicate} ?${variable} .`;
    const result = await runSparqlQuery(`${PREFIXES}
      SELECT ?${variable} WHERE {
        ${pattern}
      }
    `);
    item[fieldName] = result.results.bindings.map(binding => binding[variable].value);
  }

  for (const [groupName, group] of Object.entries(RDF.reportItem.fields || {}).filter(([, field]) => isGroupField(field))) {
    const subfields = groupSubfieldEntries(group);
    if (subfields.length === 0) continue;

    const variables = subfields.map(([fieldName, field]) => sparqlVariableName(fieldName, field));
    const groupSubjectVariable = `${sparqlVariableName(groupName, group)}Subject`;
    const perInstanceGroupSubject = nestedGroupUri(subject, groupName);
    const locResult = await runSparqlQuery(`${PREFIXES}
      SELECT ${variables.map(variable => `?${variable}`).join(" ")} WHERE {
        ${group.predicate ? `OPTIONAL { ${subject} ${group.predicate} ?${groupSubjectVariable}Linked . }` : ""}
        BIND(COALESCE(?${groupSubjectVariable}Linked, ${perInstanceGroupSubject}) AS ?${groupSubjectVariable})
        ${subfields.map(([fieldName, field]) => {
          const variable = sparqlVariableName(fieldName, field);
          return `
            ${group.predicate ? `OPTIONAL { ?${groupSubjectVariable} ${field.predicate} ?${variable}Grouped . }` : ""}
            OPTIONAL { ${subject} ${field.predicate} ?${variable}Legacy . }
            BIND(COALESCE(?${variable}Grouped, ?${variable}Legacy) AS ?${variable})
          `;
        }).join("\n")}
      }
    `);

    if (locResult.results.bindings.length > 0) {
      const binding = locResult.results.bindings[0];
      item[groupName] = Object.fromEntries(
        subfields.map(([fieldName, field]) => {
          const variable = sparqlVariableName(fieldName, field);
          return [fieldName, binding[variable]?.value];
        })
      );
    }
  }

  for (const [fieldName, field] of Object.entries(RDF.reportItem.fields || {})) {
    if (!field.options || !item[fieldName]) continue;

    const selectedOption = optionKeyFromStoredValue(field, item[fieldName]);
    const option = field.options[selectedOption];
    const subfields = Object.entries(option?.fields || {});
    if (subfields.length === 0) {
      item[fieldName] = { selectedOption, values: {} };
      continue;
    }

    const optionalPatterns = subfields
      .map(([subfieldName, subfield]) => {
        const variable = sparqlVariableName(subfieldName, subfield);
        const pattern = `${subject} ${subfield.predicate} ?${variable} .`;
        return `OPTIONAL { ${pattern} }`;
      })
      .join("\n");
    const variables = subfields.map(([subfieldName, subfield]) => `?${sparqlVariableName(subfieldName, subfield)}`).join(" ");
    const optionResult = await runSparqlQuery(`${PREFIXES}
      SELECT ${variables} WHERE {
        ${optionalPatterns}
      }
    `);
    const binding = optionResult.results.bindings[0] || {};
    item[fieldName] = {
      selectedOption,
      values: Object.fromEntries(
        subfields.map(([subfieldName, subfield]) => {
          const variable = sparqlVariableName(subfieldName, subfield);
          if (subfield.allowMultiple || subfield.inputType === "uri-list" || subfield.inputType === "text-list") {
            const values = optionResult.results.bindings
              .map(resultBinding => resultBinding[variable]?.value)
              .filter(Boolean);
            return [subfieldName, values];
          }
          return [subfieldName, binding[variable]?.value];
        })
      ),
    };
  }

  return item;
}

function reportItemFromBinding(binding) {
  return {
    ...objectFromBinding(binding, RDF.reportItem.fields),
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
    if (isArrayField(field)) {
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
        OPTIONAL { ?${groupSubjectVariable} ${field.predicate} ?${variable}Grouped . }
        OPTIONAL { ${subject} ${field.predicate} ?${variable}Direct . }
        BIND(COALESCE(?${variable}Grouped, ?${variable}Direct) AS ?${variable})
      `;
    }).join("\n");

    const result = await runSparqlQuery(`${PREFIXES}
      SELECT ${variables.map(variable => `?${variable}`).join(" ")} WHERE {
        ${group.predicate ? `OPTIONAL { ${subject} ${group.predicate} ?${groupSubjectVariable}Linked . }` : ""}
        BIND(COALESCE(?${groupSubjectVariable}Linked, ${subject}) AS ?${groupSubjectVariable})
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

async function rdfEntitiesForType(entityType, organisationId, context) {
  await requireOrganisationView(context, organisationId);
  return withOrganisationRepository(organisationId, async () => {
  if (!RDF.classes?.[entityType]) throw new Error(`Unknown RDF entity type: ${entityType}`);
  if (entityType === "report") return [];
  if (entityType === "reportItem") {
    const items = await resolvers.Query.reportItems(null, { organisationId }, context);
    return items.map(item => rdfEntityFromObject("reportItem", item));
  }

  const entity = RDF[entityType] || {};
  const fields = genericEntityQueryFields(entity.fields || {});
  const variables = selectVariables(fields);
  const sparqlQuery = `${PREFIXES}
    SELECT ?entity ${variables}
    WHERE {
      ?entity rdf:type ${RDF.classes[entityType]} .
      ${organisationDataPattern("?entity", organisationId)}
      ${fieldPatterns("?entity", fields)}
    }
    ORDER BY STR(?entity)
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

function subjectFromEntityIdentifier(entityType, id, uri) {
  return uri ? termToIri(uri) : entityUri(entityType, id);
}

function organisationDataTriple(subject, organisationId) {
  if (!organisationId) return "";
  return triple(subject, "sitrep:organisationId", organisationId);
}

function organisationDataPattern(subject, organisationId) {
  if (!organisationId) {
    return `FILTER NOT EXISTS {
      ${subject} sitrep:organisationId ?organisationId .
      FILTER(DATATYPE(?organisationId) != xsd:integer)
    }`;
  }
  return `${subject} sitrep:organisationId ${literal(organisationId)} .`;
}

function scopedSubjectDelete(subject, organisationId) {
  if (organisationId) {
    return `DELETE WHERE {
      ${subject} sitrep:organisationId ${literal(organisationId)} ;
                 ?p ?o .
    }`;
  }
  return `DELETE {
    ${subject} ?p ?o .
  }
  WHERE {
    ${subject} ?p ?o .
    ${organisationDataPattern(subject, organisationId)}
  }`;
}

function scopedReportLinkDelete(selectedItemsField, selectedItemObject, organisationId) {
  if (organisationId) {
    return `DELETE WHERE {
      ?report ${selectedItemsField.predicate} ${selectedItemObject} ;
               sitrep:organisationId ${literal(organisationId)} .
    }`;
  }
  return `DELETE {
    ?report ${selectedItemsField.predicate} ${selectedItemObject} .
  }
  WHERE {
    ?report ${selectedItemsField.predicate} ${selectedItemObject} .
    ${organisationDataPattern("?report", organisationId)}
  }`;
}

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
  const repositoryConfig = await organisationRepositoryConfig(organisationId);
  await applyOrganisationRdfStructure(organisationId);
  return withRepository(repositoryConfig, callback);
}

async function applyOrganisationRdfStructure(organisationId) {
  const structureJson = await organisationRdfStructureJson(organisationId);
  applyRdfStructureFromJson(structureJson || JSON.stringify(defaultRdfStructure()));
}

function rdfStructurePayload() {
  return {
    json: rdfStructureJson(),
    reportItemFields: editableFieldEntries("reportItem"),
    reportFields: editableFieldEntries("report"),
  };
}

function parseFieldValue(field, value) {
  if (value === null || value === undefined) return value;
  if (field.kind === "array") return JSON.parse(value);
  if (field.kind === "group" || field.kind === "location") return JSON.parse(value);
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
  if (field.kind === "group" || field.kind === "location" || field.kind === "conditional") {
    return value ? JSON.stringify(value) : null;
  }
  return decryptDataForField(field, value) ?? null;
}

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
  const nextFieldNames = new Set(allPredicateFields(nextStructure, entityType).map(field => field.name));
  return allPredicateFields(oldStructure, entityType)
    .filter(oldField => oldField.predicate && !nextFieldNames.has(oldField.name));
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

const resolvers = {
  ReportItem: {
    fieldValues: item => fieldValuesForEntity("reportItem", item),
  },
  Report: {
    fieldValues: report => fieldValuesForEntity("report", report),
  },
  Query: {
    me: async (_, __, context) => context.currentUser,

    organisations: async (_, __, context) => listOrganisations(context.currentUser.id),

    myOrganisations: async (_, __, context) => listMyOrganisations(context.currentUser.id),

    rdfStructure: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      await applyOrganisationRdfStructure(organisationId);
      return rdfStructurePayload();
    },

    rdfEntities: async (_, { entityType, organisationId }, context) => rdfEntitiesForType(entityType, organisationId, context),

    reportItems: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const itemFields = queryFields(RDF.reportItem.fields, ["entryNumber"]);
      const sparqlQuery = `${PREFIXES}
        SELECT ?item ${selectVariables(itemFields)}
        WHERE {
          ?item rdf:type ${RDF.classes.reportItem} .
          ${organisationDataPattern("?item", organisationId)}
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

    reportItem: async (_, { id, organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const subject = entityUri("reportItem", id);
      const itemFields = queryFields(RDF.reportItem.fields, ["entryNumber"]);
      const sparqlQuery = `${PREFIXES}
        SELECT ${selectVariables(itemFields)}
        WHERE {
          ${subject} rdf:type ${RDF.classes.reportItem} .
          ${organisationDataPattern(subject, organisationId)}
          ${fieldPatterns(subject, itemFields)}
        }
      `;

      const result = await runSparqlQuery(sparqlQuery);
      if (result.results.bindings.length === 0) return null;

      const item = reportItemFromBinding(result.results.bindings[0]);
      return loadReportItemCollections(item);
      });
    },

    reports: async (_, { organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const reportFields = queryFields(RDF.report.fields, []);
      const reportIdBase = entityIdReplacePattern("report");
      const sparqlQuery = `${PREFIXES}
        SELECT ?report ?id ${selectVariables(reportFields)}
        WHERE {
          ?report rdf:type ${RDF.classes.report} .
          FILTER(STRSTARTS(STR(?report), "${reportIdBase}"))
          ${organisationDataPattern("?report", organisationId)}
          ${fieldPatterns("?report", reportFields)}
          BIND(REPLACE(STR(?report), "${reportIdBase}", "") AS ?id)
          FILTER(REGEX(?id, "^[0-9]+$"))
        }
        ORDER BY DESC(?id)
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

    report: async (_, { id, organisationId }, context) => {
      await requireOrganisationView(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const subject = entityUri("report", id);
      const reportFields = queryFields(RDF.report.fields, []);
      const sparqlQuery = `${PREFIXES}
        SELECT ${selectVariables(reportFields)}
        WHERE {
          ${subject} rdf:type ${RDF.classes.report} .
          ${organisationDataPattern(subject, organisationId)}
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
  },

  Mutation: {
    signUp: async (_, { email, password, name }, context) => {
      const user = await createUser({ email, password, name });
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

    createOrganisation: async (_, { name, description }, context) => {
      const user = requireAuth(context);
      return createOrganisation(user.id, { name, description });
    },

    joinOrganisation: async (_, { id }, context) => {
      const user = requireAuth(context);
      return joinOrganisation(user.id, id);
    },

    updateOrganisation: async (_, { id, name, description }, context) => {
      const user = requireAuth(context);
      return updateOrganisation(user, id, { name, description });
    },

    updateOrganisationMemberRole: async (_, { organisationId, userId, role }, context) => {
      const user = requireAuth(context);
      return updateOrganisationMemberRole(user, organisationId, userId, role);
    },

    deleteOrganisation: async (_, { id }, context) => {
      const user = requireAuth(context);
      return deleteOrganisation(user, id);
    },

    updateRdfStructure: async (_, { json, organisationId }, context) => {
      const user = requireAuth(context);
      if (!(user.role === "admin" && !organisationId)) {
        await requireOrganisationWrite(context, organisationId);
      }
      return withOrganisationRepository(organisationId, async () => {
      const oldStructure = JSON.parse(rdfStructureJson());
      const nextStructure = encryptSourceFieldsInStructure(parseRdfStructureJson(json));
      await migrateStoredRdf(oldStructure, nextStructure);
      applyRdfStructureFromJson(JSON.stringify(nextStructure));
      await updateOrganisationRdfStructureJson(organisationId, JSON.stringify(nextStructure));
      await syncEquivalentClassTriples(nextStructure);
      return rdfStructurePayload();
      });
    },

    createReportItemFromFields: async (_, { fieldValues, organisationId }, context) => {
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
        ${organisationDataTriple(entityUri("reportItem", entryNumber), organisationId)}
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
          ${organisationDataPattern(subject, organisationId)}
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
        ${organisationDataTriple(subject, organisationId)}
      }`);
      return item;
      });
    },

    deleteReportItem: async (_, { id, organisationId }, context) => {
      await requireOrganisationWrite(context, organisationId);
      return withOrganisationRepository(organisationId, async () => {
      const selectedItemsField = reportSelectedItemsField();
      const selectedItemValue = selectedItemsField.targetTemplate
        ? applyTemplate(selectedItemsField.targetTemplate, { entryNumber: id, id })
        : id;
      const selectedItemObject = objectTerm(selectedItemValue, selectedItemsField);
      await deleteNestedGroupTriples("reportItem", id);
      await runSparqlUpdate(`${PREFIXES}
        ${scopedReportLinkDelete(selectedItemsField, selectedItemObject, organisationId)};
        ${scopedSubjectDelete(entityUri("reportItem", id), organisationId)}
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
        ${organisationDataTriple(entityUri("report", id), organisationId)}
      }`);

      for (const itemId of selectedItemIds || []) {
        await setItemReportMetadata(itemId, report);
      }

      return report;
      });
    },

    updateReportFromFields: async (_, { id, fieldValues, selectedItemIds, organisationId }, context) => {
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
          ${organisationDataPattern(subject, organisationId)}
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
        ${organisationDataTriple(subject, organisationId)}
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
        ${scopedSubjectDelete(entityUri("report", id), organisationId)}
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

    createRdfEntityFromFields: async (_, { entityType, fieldValues, organisationId }, context) => {
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
        ${organisationDataTriple(subject, organisationId)}
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
        ${scopedSubjectDelete(subject, organisationId)};
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
          ${organisationDataTriple(subject, organisationId)}
        }
      `);

      return rdfEntityFromObject(entityType, { ...data, uri: uri || expandPrefixedName(entityUri(entityType, id)) });
      });
    },
  },
};

for (const [name, resolver] of Object.entries(resolvers.Query)) {
  if (name === "me") continue;
  resolvers.Query[name] = (parent, args, context, info) => {
    requireAuth(context);
    return resolver(parent, args, context, info);
  };
}

for (const [name, resolver] of Object.entries(resolvers.Mutation)) {
  if (["signUp", "signIn", "signOut"].includes(name)) continue;
  resolvers.Mutation[name] = async (parent, args, context, info) => {
    const user = requireAuth(context);
    const accountMutations = new Set(["updateMyAccount", "updateMyPassword"]);
    const organisationMutations = new Set([
      "createOrganisation",
      "joinOrganisation",
      "updateOrganisation",
      "updateOrganisationMemberRole",
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

export default resolvers;
