import { runSparqlQuery, runSparqlUpdate } from "../services/allegroClient.js";
import {
  PREFIXES,
  RDF,
  defaultRdfStructure,
  entityIdField,
  editableFieldEntries,
  entityIdReplacePattern,
  entityIdFromUri,
  entityUri,
  expandPrefixedName,
  fieldPatterns,
  itemReportMetadataTriples,
  literal,
  nestedGroupUri,
  objectTerm,
  objectFromBinding,
  parseRdfStructureJson,
  pickFields,
  reportItemTriples,
  reportTriples,
  rdfStructureJson,
  selectVariables,
  updateRdfStructureFromJson,
  triple,
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

async function allocateEntityInput(field, value, nextIds) {
  if (!field.createEntityFromInput) return value;
  const targetEntityType = field.targetEntityType;
  if (!targetEntityType) return value;

  const values = Array.isArray(value)
    ? value.filter(Boolean)
    : String(value || "").split(/[\n,]+/).map(item => item.trim()).filter(Boolean);

  const allocatedValues = [];
  for (const label of values) {
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
    nextData[fieldName] = await allocateEntityInput(field, nextData[fieldName], nextIds);
  }

  for (const [fieldName, field] of Object.entries(entity.arrays || {})) {
    nextData[fieldName] = await allocateEntityInput(field, nextData[fieldName], nextIds);
  }

  for (const [groupName, group] of Object.entries(entity.nested || {})) {
    nextData[groupName] = await allocateCreatedEntityInputsForFields(group, nextData[groupName] || {}, nextIds);
  }

  return nextData;
}

async function allocateCreatedEntityInputsForFields(fields, data, nextIds) {
  const nextData = { ...data };
  for (const [fieldName, field] of Object.entries(fields || {})) {
    if (!field || typeof field !== "object" || !field.predicate) continue;
    nextData[fieldName] = await allocateEntityInput(field, nextData[fieldName], nextIds);
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

async function deleteReverseLinksForEntity(entityType, id) {
  const subject = entityUri(entityType, id);
  const deletes = reversePredicateFields(RDF, entityType)
    .map((field, index) => `DELETE WHERE { ?reverseSubject${index} ${field.predicate} ${subject} . }`)
    .join(";\n");
  if (!deletes) return;

  await runSparqlUpdate(`${PREFIXES}
    ${deletes}
  `);
}

async function deleteNestedGroupTriples(entityType, id) {
  const subject = entityUri(entityType, id);
  const deletes = Object.entries(RDF[entityType]?.nested || {})
    .filter(([, group]) => group?.resourceMode !== "reusable")
    .map(([groupName]) => `DELETE WHERE { ${nestedGroupUri(subject, groupName)} ?p ?o . }`)
    .join(";\n");
  if (!deletes) return;

  await runSparqlUpdate(`${PREFIXES}
    ${deletes}
  `);
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

  for (const [fieldName, field] of Object.entries(RDF.reportItem.arrays)) {
    const variable = sparqlVariableName(fieldName, field);
    const pattern = field.direction === "reverse"
      ? `?${variable} ${field.predicate} ${subject} .`
      : `${subject} ${field.predicate} ?${variable} .`;
    const result = await runSparqlQuery(`${PREFIXES}
      SELECT ?${variable} WHERE {
        ${pattern}
      }
    `);
    item[fieldName] = result.results.bindings.map(binding => binding[variable].value);
  }

  for (const [groupName, group] of Object.entries(RDF.reportItem.nested || {})) {
    const subfields = Object.entries(group)
      .filter(([, field]) => field && typeof field === "object" && field.predicate);
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
        const pattern = subfield.direction === "reverse"
          ? `?${variable} ${subfield.predicate} ${subject} .`
          : `${subject} ${subfield.predicate} ?${variable} .`;
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
    ...Object.fromEntries(Object.keys(RDF.reportItem.arrays || {}).map(fieldName => [fieldName, []])),
    ...Object.fromEntries(Object.keys(RDF.reportItem.nested || {}).map(fieldName => [fieldName, null])),
  };
}

async function loadReportSelectedItemIds(report, subject) {
  const selectedItemsField = RDF.report.selectedItems;
  const variableName = selectedItemsField.objectType === "uri" ? "item" : "itemId";
  const itemResult = await runSparqlQuery(`${PREFIXES}
    SELECT ?${variableName} WHERE {
      ${subject} ${selectedItemsField.predicate} ?${variableName} .
    }
  `);
  report.selectedItemIds = itemResult.results.bindings.map(binding => {
    const value = binding[variableName].value;
    return selectedItemsField.objectType === "uri"
      ? parseInt(entityIdFromUri("reportItem", value), 10)
      : parseInt(value, 10);
  });
  return report;
}

function reportFromBinding(binding, id) {
  return {
    id: parseInt(id, 10),
    ...objectFromBinding(binding, RDF.report.fields),
    selectedItemIds: [],
  };
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
      fieldMap.has(field.name) ? parseFieldValue(field, fieldMap.get(field.name)) : undefined,
    ])
  );
}

function fieldValuesForEntity(entityType, entity) {
  return editableFieldEntries(entityType).map(field => ({
    name: field.name,
    label: field.label || field.name,
    kind: field.kind,
    datatype: field.datatype,
    subfields: field.subfields || [],
    options: field.options || [],
    value: field.kind === "array" || field.kind === "group" || field.kind === "location" || field.kind === "conditional"
      ? JSON.stringify(entity[field.name] || (field.kind === "array" ? [] : null))
      : entity[field.name] ?? null,
  }));
}

function queryFields(fields, requiredFieldNames) {
  const requiredNames = new Set(requiredFieldNames);
  return Object.fromEntries(
    Object.entries(fields).map(([fieldName, field]) => [
      fieldName,
      { ...field, required: requiredNames.has(fieldName) },
    ])
  );
}

function allPredicateFields(structure, entityType) {
  const entity = structure[entityType] || {};
  const fields = Object.entries(entity.fields || {}).map(([name, field]) => ({ name, ...field }));
  const arrays = Object.entries(entity.arrays || {}).map(([name, field]) => ({ name, ...field }));
  const nested = Object.entries(entity.nested || {})
    .flatMap(([groupName, group]) => [
      ...(group?.predicate ? [{ name: groupName, ...group }] : []),
      ...Object.entries(group || {})
        .filter(([, field]) => field && typeof field === "object" && field.predicate)
        .map(([name, field]) => ({ name: `${groupName}.${name}`, ...field })),
    ]);

  const selectedItems = entityType === "report" && entity.selectedItems
    ? [{ name: "selectedItems", ...entity.selectedItems }]
    : [];

  const conditional = Object.entries(entity.fields || {})
    .flatMap(([fieldName, field]) => Object.entries(field.options || {})
      .flatMap(([optionName, option]) => Object.entries(option.fields || {})
        .filter(([, subfield]) => subfield && typeof subfield === "object" && subfield.predicate)
        .map(([subfieldName, subfield]) => ({ name: `${fieldName}.${optionName}.${subfieldName}`, ...subfield }))));

  return [...fields, ...arrays, ...nested, ...conditional, ...selectedItems];
}

function reversePredicateFields(structure, entityType) {
  return allPredicateFields(structure, entityType).filter(field => field.direction === "reverse" && field.predicate);
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

function migrationPredicatePairs(oldStructure, nextStructure, entityType) {
  const nextFieldsByName = new Map(allPredicateFields(nextStructure, entityType).map(field => [field.name, field]));
  const candidateStructures = [oldStructure, defaultRdfStructure()];
  const pairs = [];
  const seen = new Set();

  for (const nextField of allPredicateFields(nextStructure, entityType)) {
    for (const previousPredicate of nextField.previousPredicates || []) {
      if (previousPredicate === nextField.predicate) continue;
      const key = `${previousPredicate}->${nextField.predicate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ oldPredicate: previousPredicate, nextPredicate: nextField.predicate });
    }
  }

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

function findFieldInStructure(structure, entityType, fieldName) {
  return allPredicateFields(structure, entityType).find(field => field.name === fieldName);
}

function mutableFieldByName(structure, entityType, fieldName) {
  if (fieldName.includes(".")) {
    const parts = fieldName.split(".");
    if (parts.length === 3) {
      const [fieldNamePart, optionName, subfieldName] = parts;
      return structure[entityType]?.fields?.[fieldNamePart]?.options?.[optionName]?.fields?.[subfieldName];
    }
    const [groupName, subfieldName] = parts;
    return structure[entityType]?.nested?.[groupName]?.[subfieldName];
  }
  return structure[entityType]?.fields?.[fieldName]
    || structure[entityType]?.arrays?.[fieldName]
    || structure[entityType]?.nested?.[fieldName]
    || null;
}

function augmentPredicateHistory(oldStructure, nextStructure) {
  const augmented = JSON.parse(JSON.stringify(nextStructure));
  const candidateStructures = [oldStructure, defaultRdfStructure()];

  for (const entityType of entityTypesFromStructure(augmented)) {
    for (const nextField of allPredicateFields(augmented, entityType)) {
      const mutableField = mutableFieldByName(augmented, entityType, nextField.name);
      if (!mutableField) continue;

      const previousPredicates = new Set(mutableField.previousPredicates || []);
      for (const candidateStructure of candidateStructures) {
        const oldField = findFieldInStructure(candidateStructure, entityType, nextField.name);
        if (!oldField?.predicate || oldField.predicate === nextField.predicate) continue;
        previousPredicates.add(oldField.predicate);
      }

      mutableField.previousPredicates = Array.from(previousPredicates);
    }
  }

  return augmented;
}

function changedClasses(oldStructure, nextStructure) {
  return entityTypesFromStructure(nextStructure)
    .map(entityType => ({
      oldClassName: oldStructure.classes?.[entityType],
      nextClassName: nextStructure.classes?.[entityType],
    }))
    .filter(change => change.oldClassName && change.nextClassName && change.oldClassName !== change.nextClassName);
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

function entityIdReplacePatternForStructure(structure, entityType) {
  const token = String(structure.uriTemplates?.[entityType] || "").match(/\{([^}]+)\}/)?.[1]
    || structure[entityType]?.idField
    || (entityType === "reportItem" ? "entryNumber" : "id");
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
  `);
}

async function migrateStoredRdf(oldStructure, nextStructure) {
  const results = [];
  for (const entityType of entityTypesFromStructure(nextStructure)) {
    for (const oldField of deletedPredicateFields(oldStructure, nextStructure, entityType)) {
      await deletePredicateForEntity(entityType, oldStructure, oldField.predicate);
      for (const previousPredicate of oldField.previousPredicates || []) {
        await deletePredicateForEntity(entityType, oldStructure, previousPredicate);
      }
    }

    for (const { oldPredicate, nextPredicate } of migrationPredicatePairs(oldStructure, nextStructure, entityType)) {
      results.push(await renamePredicate(oldPredicate, nextPredicate));
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
    rdfStructure: async () => rdfStructurePayload(),

    reportItems: async () => {
      const itemFields = queryFields(RDF.reportItem.fields, ["entryNumber"]);
      const sparqlQuery = `${PREFIXES}
        SELECT ?item ${selectVariables(itemFields)}
        WHERE {
          ?item rdf:type ${RDF.classes.reportItem} .
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
    },

    reportItem: async (_, { id }) => {
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
    },

    reports: async () => {
      const reportFields = queryFields(RDF.report.fields, []);
      const sparqlQuery = `${PREFIXES}
        SELECT ?report ?id ${selectVariables(reportFields)}
        WHERE {
          ?report rdf:type ${RDF.classes.report} .
          ${fieldPatterns("?report", reportFields)}
          BIND(REPLACE(STR(?report), "${entityIdReplacePattern("report")}", "") AS ?id)
        }
        ORDER BY DESC(?id)
      `;

      const result = await runSparqlQuery(sparqlQuery);
      const reports = [];

      for (const binding of result.results.bindings) {
        const report = reportFromBinding(binding, binding.id.value);
        await loadReportSelectedItemIds(report, `<${binding.report.value}>`);
        reports.push(report);
      }

      return reports;
    },

    report: async (_, { id }) => {
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
      return loadReportSelectedItemIds(report, subject);
    },
  },

  Mutation: {
    updateRdfStructure: async (_, { json }) => {
      const oldStructure = JSON.parse(rdfStructureJson());
      const nextStructure = parseRdfStructureJson(json);
      const nextStructureWithHistory = augmentPredicateHistory(oldStructure, nextStructure);
      await migrateStoredRdf(oldStructure, nextStructureWithHistory);
      updateRdfStructureFromJson(JSON.stringify(nextStructureWithHistory));
      return rdfStructurePayload();
    },

    createReportItemFromFields: async (_, { fieldValues }) => {
      const entryNumber = await nextEntityId("reportItem");

      const now = new Date().toISOString();
      const item = await allocateCreatedEntityInputs("reportItem", {
        ...dataFromFieldValues("reportItem", fieldValues),
        entryNumber,
        createdAt: now,
        updatedAt: now,
      });

      await runSparqlUpdate(`${PREFIXES} INSERT DATA { ${reportItemTriples(item)} }`);
      return item;
    },

    updateReportItemFromFields: async (_, { id, fieldValues }) => {
      const subject = entityUri("reportItem", id);
      const existing = await runSparqlQuery(`${PREFIXES}
        SELECT ?createdAt WHERE {
          ${subject} ${RDF.reportItem.fields.createdAt.predicate} ?createdAt .
        }
      `);
      const createdAt = existing.results.bindings[0]?.createdAt.value || new Date().toISOString();

      await deleteReverseLinksForEntity("reportItem", id);
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

      await runSparqlUpdate(`${PREFIXES} INSERT DATA { ${reportItemTriples(item)} }`);
      return item;
    },

    deleteReportItem: async (_, { id }) => {
      const selectedItemsField = RDF.report.selectedItems;
      const selectedItemValue = selectedItemsField.targetTemplate
        ? applyTemplate(selectedItemsField.targetTemplate, { entryNumber: id, id })
        : id;
      const selectedItemObject = objectTerm(selectedItemValue, selectedItemsField);
      await deleteReverseLinksForEntity("reportItem", id);
      await deleteNestedGroupTriples("reportItem", id);
      await runSparqlUpdate(`${PREFIXES}
        DELETE WHERE {
          ?report ${selectedItemsField.predicate} ${selectedItemObject} .
        };
        DELETE WHERE {
          ${entityUri("reportItem", id)} ?p ?o .
        }
      `);
      return true;
    },

    createReportFromFields: async (_, { fieldValues, selectedItemIds }) => {
      const id = await nextEntityId("report");

      const report = {
        ...dataFromFieldValues("report", fieldValues),
        id,
        reportNumber: id,
        selectedItemIds,
        createdAt: new Date().toISOString(),
      };

      await runSparqlUpdate(`${PREFIXES} INSERT DATA { ${reportTriples(report)} }`);

      for (const itemId of selectedItemIds) {
        await setItemReportMetadata(itemId, report);
      }

      return report;
    },

    updateReportFromFields: async (_, { id, fieldValues, selectedItemIds }) => {
      const subject = entityUri("report", id);
      const existingReport = await resolvers.Query.report(null, { id });
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
      };

      await runSparqlUpdate(`${PREFIXES} INSERT DATA { ${reportTriples(report)} }`);

      for (const itemId of nextSelectedItemIds) {
        await setItemReportMetadata(itemId, report);
      }

      return report;
    },

    deleteReport: async (_, { id }) => {
      const report = await resolvers.Query.report(null, { id });
      if (report) {
        for (const itemId of report.selectedItemIds) {
          await clearItemReportMetadata(itemId);
        }
      }

      await deleteNestedGroupTriples("report", id);
      await runSparqlUpdate(`${PREFIXES}
        DELETE WHERE {
          ${entityUri("report", id)} ?p ?o .
        }
      `);
      return true;
    },

    addItemToReport: async (_, { reportId, itemId }) => {
      const report = await getReportMetadata(reportId);
      if (!report) throw new Error(`Report ${reportId} not found`);

      const selectedItemsField = RDF.report.selectedItems;
      const selectedItemValue = selectedItemsField.targetTemplate
        ? applyTemplate(selectedItemsField.targetTemplate, { entryNumber: itemId, id: itemId })
        : itemId;
      const selectedItemObject = objectTerm(selectedItemValue, selectedItemsField);
      await runSparqlUpdate(`${PREFIXES}
        DELETE WHERE {
          ?report ${selectedItemsField.predicate} ${selectedItemObject} .
        }
      `);

      await runSparqlUpdate(`${PREFIXES}
        INSERT DATA {
          ${triple(entityUri("report", reportId), selectedItemsField.predicate, selectedItemValue, selectedItemsField)}
        }
      `);
      await setItemReportMetadata(itemId, report);
      return true;
    },

    removeItemFromReport: async (_, { reportId, itemId }) => {
      const selectedItemsField = RDF.report.selectedItems;
      const selectedItemValue = selectedItemsField.targetTemplate
        ? applyTemplate(selectedItemsField.targetTemplate, { entryNumber: itemId, id: itemId })
        : itemId;
      await runSparqlUpdate(`${PREFIXES}
        DELETE WHERE {
          ${triple(entityUri("report", reportId), selectedItemsField.predicate, selectedItemValue, selectedItemsField)}
        }
      `);
      await clearItemReportMetadata(itemId);
      return true;
    },
  },
};

export default resolvers;
