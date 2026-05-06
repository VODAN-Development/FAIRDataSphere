import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const structurePath = join(dirname(fileURLToPath(import.meta.url)), "reportRdfStructure.json");

const DEFAULT_RDF = {
  prefixes: {
    sitrep: "http://sitrep.example.org/ontology#",
    resource: "http://sitrep.example.org/resource/",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    owl: "http://www.w3.org/2002/07/owl#",
    geo: "http://www.w3.org/2003/01/geo/wgs84_pos#",
    gn: "http://www.geonames.org/ontology#",
    hds: "http://example.org/hds#",
    schema: "http://schema.org/",
    foaf: "http://xmlns.com/foaf/0.1/",
  },
  classes: {
    report: "hds:SituationReport",
    reportItem: "hds:Situation",
    location: "hds:Location",
    organisation: "hds:Organisation",
    perpetrator: "hds:Perpetrator",
    person: "schema:Person",
    place: "schema:Place",
    victim: "hds:Victim",
  },
  equivalentClasses: {
    location: "schema:Place",
    perpetrator: "schema:Person",
    victim: "schema:Person",
  },
  uriTemplates: {
    report: "resource:Report_{reportNumber}",
    reportItem: "resource:ReportItem_{entryNumber}",
    location: "resource:Location_{id}",
    organisation: "resource:Organisation_{id}",
    perpetrator: "resource:Perpetrator_{id}",
    person: "resource:Person_{id}",
    place: "resource:Place_{id}",
    victim: "resource:Victim_{id}",
  },
  reportItem: {
    idField: "entryNumber",
    fields: {
      entryNumber: { predicate: "sitrep:entryNumber", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "Entry Number", inputType: "number" },
      paragraph: { predicate: "sitrep:paragraph", required: true, label: "Paragraph", inputType: "textarea" },
      dateOfEvent: { predicate: "hds:date", datatype: "xsd:date", required: true, label: "Date of Event", inputType: "date" },
      eventType: { predicate: "sitrep:eventType", required: true, label: "Event Type", inputType: "select", options: {} },
      source: { predicate: "hds:source", label: "Source", inputType: "text" },
      createdAt: { predicate: "sitrep:createdAt", datatype: "xsd:dateTime", required: true, generated: true, label: "Created At", inputType: "datetime" },
      updatedAt: { predicate: "hds:updatedAt", datatype: "xsd:dateTime", required: true, generated: true, label: "Updated At", inputType: "datetime" },
    },
    arrays: {
      countries: { predicate: "sitrep:country", variable: "country", objectType: "uri", vocabulary: "geonames", targetEntityType: "location", targetField: "country", required: true, label: "Countries", inputType: "uri-list" },
      regions: { predicate: "sitrep:region", variable: "region", objectType: "uri", vocabulary: "geonames", targetEntityType: "location", targetField: "region", label: "Regions", inputType: "uri-list" },
      villagesCities: { predicate: "sitrep:settlement", previousPredicates: ["sitrep:villageCity"], variable: "vc", objectType: "uri", vocabulary: "geonames", targetEntityType: "location", targetField: "settlement", required: true, label: "Settlements", inputType: "uri-list" },
    },
    nested: {
      exactLocation: {
        label: "Exact location",
        predicate: "sitrep:coordinates",
        previousPredicates: ["sitrep:exactLocation"],
        inputType: "location",
        className: "hds:Location",
        targetEntityType: "location",
        targetField: "coordinates",
        lat: { predicate: "geo:lat", variable: "lat", datatype: "xsd:decimal", label: "Latitude" },
        lon: { predicate: "geo:long", variable: "lon", datatype: "xsd:decimal", label: "Longitude" },
      },
      militaryConflict: {
        label: "Military conflict",
        inputType: "text",
        attakingForces: { predicate: "sitrep:attackingForces", variable: "attfor", label: "Attacking forces" },
        defendingForces: { predicate: "sitrep:defendingForces", variable: "deffor", label: "Defending forces" },
        weaponsUsed: { predicate: "sitrep:weaponsUsed", variable: "weapons", label: "Weapons used" },
        mcDeaths: { predicate: "sitrep:deaths", variable: "mcdeaths", datatype: "xsd:integer", label: "Deaths", inputType: "number" },
        mcInjuries: { predicate: "sitrep:injuries", variable: "mcinjuries", datatype: "xsd:integer", label: "Injuries", inputType: "number"},
        mcDescription: { predicate: "hds:description", variable: "mcdescription", label: "Description", inputType: "textarea" },
      },
      humanRightsAbuses: {
        label: "Human rights abuses",
        inputType: "text",
        abusesReported: { predicate: "sitrep:abusesReported", variable: "abuses", label: "Human rights abuses reported", inputType: "textarea" },
        hrDeaths: { predicate: "sitrep:deaths", variable: "hrdeaths", datatype: "xsd:integer", label: "Deaths", inputType: "number" },
        hrInjuries: { predicate: "sitrep:injuries", variable: "hrinjuries", datatype: "xsd:integer", label: "Injuries", inputType: "number" },
        hrallegedPerpetrators: {
          predicate: "hds:isPerpetratorOf",
          direction: "reverse",
          objectType: "uri",
          targetEntityType: "perpetrator",
          targetClass: "hds:Perpetrator",
          targetTemplate: "resource:Perpetrator_{id}",
          targetLabelField: "name",
          createEntityFromInput: true,
          allowMultiple: true,
          variable: "hrperps",
          label: "Alleged perpetrators",
          inputType: "uri-list",
        },
        hrvictimIdentity: {
          predicate: "hds:isVictimOf",
          direction: "reverse",
          objectType: "uri",
          targetEntityType: "victim",
          targetClass: "hds:Victim",
          targetTemplate: "resource:Victim_{id}",
          targetLabelField: "name",
          createEntityFromInput: true,
          allowMultiple: true,
          variable: "hrVictims",
          label: "Victim identity",
          inputType: "uri-list",
        },
        hrnumberOfVictims: { predicate: "sitrep:numberOfVictims", variable: "hrNumvictims", datatype: "xsd:integer", label: "Number of victims", inputType: "number" },
        hrDescription: { predicate: "hds:description", variable: "hrdescription", label: "Description", inputType: "textarea" },
      },
      humanitarionAndHealthCrisis: {
        label: "Humanitarian and health crisis",
        inputType: "text",
        crisisType: { predicate: "sitrep:crisisType", variable: "crisistype", label: "Type of crisis", inputType: "text" },
        intermediateNeeds: { predicate: "hds:needs", variable: "needs", label: "Intermediate needs", inputType: "textarea" },
        affectedIndividuals: {
          predicate: "hds:affected",
          objectType: "uri",
          targetEntityType: "victim",
          targetClass: "hds:Victim",
          targetTemplate: "resource:Victim_{id}",
          targetLabelField: "name",
          createEntityFromInput: true,
          allowMultiple: true,
          variable: "affectedIndividuals",
          label: "Affected individuals",
          inputType: "uri-list",
        },
        identity: { predicate: "sitrep:identity", variable: "identity", label: "Identity of affected individuals", inputType: "text" },
        hcDeaths: { predicate: "sitrep:deaths", variable: "hcdeaths", datatype: "xsd:integer", label: "Deaths", inputType: "number" },
        hcInjuries: { predicate: "sitrep:injuries", variable: "hcinjuries", datatype: "xsd:integer", label: "Injuries", inputType: "number" },
        hcInvolvedParties: { predicate: "hds:involved", variable: "hcInvolvedParties", label: "Involved parties", inputType: "text-list" },
        hcDescription: { predicate: "hds:description", variable: "hcdescription", label: "Description", inputType: "textarea" },
      },
      politicalDevelopment: {
        label: "Political development",
        inputType: "text",
        politicalType: { predicate: "sitrep:politicalType", variable: "politicalType", label: "Type of political event", inputType: "text" },
        pdInvolvedParties: { predicate: "hds:involved", variable: "pdInvolvedParties", label: "Involved parties", inputType: "text-list" },
        outcome: { predicate: "sitrep:outcome", variable: "outcome", label: "Outcome", inputType: "textarea" },
        pdDescription: { predicate: "hds:description", variable: "pdDescription", label: "Description", inputType: "textarea" },
      },
      economicIssue: {
        label: "Economic issue",
        inputType: "text",
        economicType: { predicate: "sitrep:economicType", variable: "economicType", label: "Type of economic event", inputType: "text" },
        economicAffectedPopulation: { predicate: "hds:affected", variable: "economicAffectedPopulation", label: "Affected population", inputType: "textarea" },
        governmentAction: { predicate: "sitrep:governmentAction", variable: "governmentAction", label: "Government action taken", inputType: "text-list" },
        economicDescription: { predicate: "hds:description", variable: "economicDescription", label: "Description", inputType: "textarea" },
      },
      socialDevelopment: {
        label: "Social development",
        inputType: "text",
        socialType: { predicate: "sitrep:socialType", variable: "socialType", label: "Type of social event", inputType: "text" },
        sdInvolvedPartiess: { predicate: "hds:involved", variable: "sdInvolvedParties", label: "Involved parties", inputType: "text-list" },
        socialDescription: { predicate: "hds:description", variable: "socialDescription", label: "Description", inputType: "textarea" },
      },
      environmentIssue: {
        label: "Environment issue",
        inputType: "text",
        environmentType: { predicate: "sitrep:environmentType", variable: "environmentType", label: "Type of environmental event", inputType: "text" },
        environmentaffectedPopulation: { predicate: "hds:affected", variable: "environmentAffectedPopulation", label: "Affected population", inputType: "textarea" },
        environmentDescription: { predicate: "hds:description", variable: "environmentDescription", label: "Description", inputType: "textarea" },
      },
      internationalResponse: {
        label: "International response or event",
        inputType: "text",
        responseType: { predicate: "sitrep:responseType", variable: "responseType", label: "Type of event", inputType: "text" },
        involvedGovernments: { predicate: "hds:involved", variable: "involvedGovernments", label: "Involved governments", inputType: "text-list" },
        involvedOrganisations: {
          predicate: "hds:involved",
          objectType: "uri",
          targetEntityType: "organisation",
          targetClass: "hds:Organisation",
          targetTemplate: "resource:Organisation_{id}",
          targetLabelField: "name",
          createEntityFromInput: true,
          allowMultiple: true,
          variable: "involvedOrganizations",
          label: "Involved international organizations",
          inputType: "uri-list",
        },
        irInvolvedParties: { predicate: "hds:involved", variable: "irInvolvedParties", label: "Other involved parties", inputType: "text-list" },
        responseDescription: { predicate: "hds:description", variable: "responseDescription", label: "Description", inputType: "textarea" },
      },
      humanTrafficking: {
        label: "Human trafficking/smuggling/deportation",
        inputType: "text",
        traffickingType: { predicate: "sitrep:traffickingType", variable: "traffickingType", label: "Type of trafficking event", inputType: "text" },
        abusesMentioned: { predicate: "sitrep:abusesMentioned", variable: "abusesMentioned", label: "Human rights abuses mentioned", inputType: "textarea" },
        htvictimIdentity: {
          predicate: "hds:isVictimOf",
          direction: "reverse",
          objectType: "uri",
          targetEntityType: "victim",
          targetClass: "hds:Victim",
          targetTemplate: "resource:Victim_{id}",
          targetLabelField: "name",
          createEntityFromInput: true,
          allowMultiple: true,
          variable: "traffickingVictimIdentity",
          label: "Identity of victims",
          inputType: "uri-list",
        },
        htnumberOfVictims: { predicate: "sitrep:numberOfVictims", variable: "traffickingNumVictims", datatype: "xsd:integer", label: "Number of victims", inputType: "number" },
        traffickingDescription: { predicate: "hds:description", variable: "traffickingDescription", label: "Description", inputType: "textarea" },
      },
      mediaTargeting: {
        label: "Targeting of media/propaganda",
        targetingType: { predicate: "sitrep:targetingType", variable: "targetingType", label: "Type of targeting event", inputType: "text" },
        tmallegedPerpetrators: {
          predicate: "hds:isPerpetratorOf",
          direction: "reverse",
          objectType: "uri",
          targetEntityType: "perpetrator",
          targetClass: "hds:Perpetrator",
          targetTemplate: "resource:Perpetrator_{id}",
          targetLabelField: "name",
          createEntityFromInput: true,
          allowMultiple: true,
          variable: "tmperps",
          label: "Alleged perpetrators",
          inputType: "uri-list",
        },
        targetedMedia: { predicate: "sitrep:targetedMedia", variable: "targetedMedia", label: "Targeted media", inputType: "text-list" },
        mediaTargetingDescription: { predicate: "hds:description", variable: "mediaTargetingDescription", label: "Description", inputType: "textarea" },
      },
    },
    fieldOrder: ["paragraph", "dateOfEvent", "countries", "regions", "villagesCities", "exactLocation", "source", "eventType"],
  },
  report: {
    idField: "reportNumber",
    fields: {
      title: { predicate: "sitrep:title", required: true, label: "Report Title", inputType: "text" },
      reportNumber: { predicate: "hds:number", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "Report Number", inputType: "number" },
      reportDate: { predicate: "hds:date", datatype: "xsd:date", required: true, label: "Report Date", inputType: "date" },
      createdAt: { predicate: "sitrep:createdAt", datatype: "xsd:dateTime", required: true, generated: true, label: "Created At", inputType: "datetime" },
    },
    fieldOrder: ["title", "reportDate"],
    selectedItems: { predicate: "sitrep:hasReportItem", objectType: "uri", targetTemplate: "resource:ReportItem_{entryNumber}" },
  },
  location: {
    idField: "id",
    fields: {
      id: { predicate: "sitrep:locationId", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "ID", inputType: "number" },
      name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
      country: { predicate: "sitrep:country", objectType: "uri", vocabulary: "geonames", label: "Country", inputType: "uri-list" },
      region: { predicate: "sitrep:region", objectType: "uri", vocabulary: "geonames", label: "Region", inputType: "uri-list" },
      settlement: { predicate: "sitrep:settlement", objectType: "uri", vocabulary: "geonames", label: "Settlement", inputType: "uri-list" },
    },
    nested: {
      coordinates: {
        label: "Coordinates",
        predicate: "sitrep:coordinates",
        inputType: "location",
        lat: { predicate: "geo:lat", variable: "lat", datatype: "xsd:decimal", label: "Latitude" },
        lon: { predicate: "geo:long", variable: "lon", datatype: "xsd:decimal", label: "Longitude" },
      },
    },
    fieldOrder: ["country", "region", "settlement", "coordinates", "name"],
  },
  organisation: {
    idField: "id",
    fields: {
      id: { predicate: "sitrep:organisationId", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "ID", inputType: "number" },
      name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
    },
  },
  perpetrator: {
    idField: "id",
    fields: {
      id: { predicate: "sitrep:perpetratorId", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "ID", inputType: "number" },
      name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
    },
  },
  person: {
    idField: "id",
    fields: {
      id: { predicate: "sitrep:personId", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "ID", inputType: "number" },
      name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
    },
  },
  place: {
    idField: "id",
    fields: {
      id: { predicate: "sitrep:placeId", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "ID", inputType: "number" },
      name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
    },
  },
  victim: {
    idField: "id",
    fields: {
      id: { predicate: "sitrep:victimId", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "ID", inputType: "number" },
      name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
    },
  }
};

function prefixesFromStructure(structure) {
  return Object.entries(structure.prefixes || DEFAULT_RDF.prefixes)
    .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
    .join("\n");
}

export let PREFIXES = prefixesFromStructure(DEFAULT_RDF);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeRdfStructure(defaultStructure, persistedStructure) {
  const merged = { ...defaultStructure, ...persistedStructure };
  for (const key of ["prefixes", "classes", "equivalentClasses", "uriTemplates"]) {
    merged[key] = { ...(defaultStructure[key] || {}), ...(persistedStructure[key] || {}) };
  }
  for (const entityType of Object.keys(defaultStructure)) {
    if (!defaultStructure[entityType]?.fields) continue;
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

export function parseRdfStructureJson(json) {
  const nextStructure = normalizeStructure(JSON.parse(json));
  validateRdfStructure(nextStructure);
  return nextStructure;
}

function validateRdfStructure(structure) {
  const requiredPaths = [
    ["prefixes", "sitrep"],
    ["prefixes", "resource"],
    ["classes", "report"],
    ["classes", "reportItem"],
    ["classes", "perpetrator"],
    ["uriTemplates", "report"],
    ["uriTemplates", "reportItem"],
    ["uriTemplates", "perpetrator"],
    ["reportItem", "fields", "entryNumber"],
    ["reportItem", "fields", "createdAt"],
    ["reportItem", "fields", "updatedAt"],
    ["report", "fields", "title"],
    ["report", "fields", "createdAt"],
    ["report", "selectedItems"],
    ["perpetrator", "fields", "name"],
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

function normalizeStructure(structure) {
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
  normalized.classes = { ...DEFAULT_RDF.classes, ...(normalized.classes || {}) };
  normalized.equivalentClasses = { ...DEFAULT_RDF.equivalentClasses, ...(normalized.equivalentClasses || {}) };
  normalized.uriTemplates = { ...DEFAULT_RDF.uriTemplates, ...normalized.uriTemplates };
  Object.keys({ ...normalized.classes, ...normalized.uriTemplates }).forEach(entityType => {
    normalized[entityType] = normalizeEntityStructure(entityType, normalized[entityType], normalized.uriTemplates?.[entityType]);
  });
  normalized.perpetrator = {
    ...DEFAULT_RDF.perpetrator,
    ...(normalized.perpetrator || {}),
    fields: {
      ...DEFAULT_RDF.perpetrator.fields,
      ...(normalized.perpetrator?.fields || {}),
    },
  };
  normalized.report = normalized.report || DEFAULT_RDF.report;
  normalized.report.fields = normalized.report.fields || {};
  normalized.report.idField = DEFAULT_RDF.report.idField;
  if (normalized.report.fields.id?.generated) delete normalized.report.fields.id;
  normalized.report.fields.reportNumber = DEFAULT_RDF.report.fields.reportNumber;
  normalized.report.fieldOrder = (normalized.report.fieldOrder || DEFAULT_RDF.report.fieldOrder)
    .filter(fieldName => fieldName !== "reportNumber");
  normalized.uriTemplates.report = DEFAULT_RDF.uriTemplates.report;
  normalizeEventTypeOptions(normalized);
  normalizeCreateEntityTemplates(normalized);
  return normalized;
}

function normalizeCreateEntityTemplates(structure) {
  Object.keys({ ...(structure.classes || {}), ...(structure.uriTemplates || {}) }).forEach(entityType => {
    normalizeCreateEntityTemplatesForFields(structure, structure[entityType]?.fields || {});
    normalizeCreateEntityTemplatesForFields(structure, structure[entityType]?.arrays || {});
    normalizeNestedGroupPredicates(structure[entityType]?.nested || {});
    Object.values(structure[entityType]?.nested || {}).forEach(group => {
      normalizeCreateEntityTemplatesForFields(structure, group || {});
    });
  });
}

function normalizeNestedGroupPredicates(groups) {
  Object.entries(groups || {}).forEach(([groupName, group]) => {
    if (!group || typeof group !== "object") return;
    group.predicate = group.predicate || `sitrep:${groupName}`;
    group.resourceMode = group.resourceMode || "per-instance";
  });
}

function normalizeCreateEntityTemplatesForFields(structure, fields) {
  Object.values(fields || {}).forEach(field => {
    if (!field || typeof field !== "object") return;
    if (field.createEntityFromInput && field.targetEntityType && structure.uriTemplates?.[field.targetEntityType]) {
      field.targetTemplate = structure.uriTemplates[field.targetEntityType];
    }
    Object.values(field.options || {}).forEach(option => {
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
  return {
    ...entity,
    idField,
    fields: {
      [idField]: defaultIdField(entityType, idField),
      ...fields,
      ...(fields[idField] ? { [idField]: { ...defaultIdField(entityType, idField), ...fields[idField], generated: true } } : {}),
    },
    fieldOrder: (entity.fieldOrder || []).filter(fieldName => fieldName !== idField),
  };
}

function normalizeEventTypeOptions(structure) {
  const reportItem = structure.reportItem || {};
  reportItem.fields = reportItem.fields || {};
  reportItem.nested = reportItem.nested || {};
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

  Object.entries(reportItem.nested).forEach(([groupName, group]) => {
    if (groupName === "exactLocation") return;
    eventType.options[groupName] = normalizeEventTypeOption(groupName, group);
    delete reportItem.nested[groupName];
  });

  reportItem.fields.eventType = eventType;
  reportItem.fieldOrder = (reportItem.fieldOrder || [])
    .filter(fieldName => fieldName && fieldName !== "entryNumber" && !eventType.options[fieldName])
    .map(fieldName => (fieldName === "eventData" ? "paragraph" : fieldName));

  if (!reportItem.fieldOrder.includes("eventType")) {
    const dateIndex = reportItem.fieldOrder.indexOf("dateOfEvent");
    reportItem.fieldOrder.splice(dateIndex >= 0 ? dateIndex + 1 : reportItem.fieldOrder.length, 0, "eventType");
  }
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

function sortFieldsByOrder(fields, fieldOrder = []) {
  if (!fieldOrder?.length) return fields;
  const orderIndex = new Map(fieldOrder.map((name, index) => [name, index]));
  return fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => {
      const aOrder = orderIndex.has(a.field.name) ? orderIndex.get(a.field.name) : Number.MAX_SAFE_INTEGER;
      const bOrder = orderIndex.has(b.field.name) ? orderIndex.get(b.field.name) : Number.MAX_SAFE_INTEGER;
      return aOrder === bOrder ? a.index - b.index : aOrder - bOrder;
    })
    .map(({ field }) => field);
}

export function editableFieldEntries(entityType) {
  const entity = RDF[entityType];
  const scalarFields = Object.entries(entity.fields || {})
    .filter(([, field]) => !field.generated && !field.metadataOnly)
    .map(([name, field]) => ({
      name,
      kind: field.options ? "conditional" : "scalar",
      ...field,
      options: field.options
        ? Object.entries(field.options).map(([optionName, option]) => ({
            name: optionName,
            label: option.label || optionName,
            value: option.value || classValueForOption(optionName),
            subfields: Object.entries(option.fields || {})
              .map(([subfieldName, subfield]) => ({ name: subfieldName, kind: "scalar", ...subfield })),
          }))
        : undefined,
    }));
  const arrayFields = Object.entries(entity.arrays || {})
    .map(([name, field]) => ({ name, kind: "array", ...field }));
  const nestedFields = Object.entries(entity.nested || {})
    .map(([name, group]) => ({
      name,
      kind: "group",
      ...group,
      subfields: Object.entries(group || {})
        .filter(([, field]) => field && typeof field === "object" && field.predicate)
        .map(([subfieldName, field]) => ({ name: subfieldName, kind: "scalar", ...field })),
    }));

  return sortFieldsByOrder([...scalarFields, ...arrayFields, ...nestedFields], entity.fieldOrder);
}

export function escapeSparqlString(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function entityUri(entityType, id) {
  return applyTemplate(RDF.uriTemplates[entityType], entityTemplateValues(entityType, id));
}

export function nestedGroupUri(parentSubject, groupName) {
  if (!parentSubject) return null;
  if (String(parentSubject).startsWith("<")) {
    return String(parentSubject).replace(/>$/, `_${groupName}>`);
  }
  return `${parentSubject}_${groupName}`;
}

function capitalizedName(value) {
  return String(value || "resource").charAt(0).toUpperCase() + String(value || "resource").slice(1);
}

function reusableGroupUri(groupName, group = {}, groupData = {}) {
  const values = Object.entries(group)
    .filter(([, field]) => field && typeof field === "object" && field.predicate)
    .map(([fieldName]) => groupData[fieldName])
    .filter(value => value !== null && value !== undefined && value !== "")
    .map(value => slugify(String(value).replace(/\./g, "p")));
  return `resource:${capitalizedName(groupName)}_${values.length ? values.join("_") : "unknown"}`;
}

export function nestedGroupSubject(parentSubject, groupName, group, groupData = {}) {
  return group?.resourceMode === "reusable"
    ? reusableGroupUri(groupName, group, groupData)
    : nestedGroupUri(parentSubject, groupName);
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
  const token = entityUriToken(entityType);
  const absoluteTemplate = expandPrefixedName(RDF.uriTemplates[entityType]);
  return absoluteTemplate.split(`{${token}}`)[0];
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
  if (value === null || value === undefined || value === "") return null;
  if (field.objectType === "uri") return termToIri(value);
  return literal(value, field.datatype);
}

export function triple(subject, predicate, value, datatypeOrField) {
  const field = typeof datatypeOrField === "object" ? datatypeOrField : { datatype: datatypeOrField };
  const object = objectTerm(value, field);
  if (!object) return "";
  return field.direction === "reverse"
    ? `${object} ${predicate} ${subject} .\n`
    : `${subject} ${predicate} ${object} .\n`;
}

export function rdfTypeTriple(subject, className) {
  return `${subject} rdf:type ${className} .\n`;
}

function classTermForEquivalentClass(structure, equivalentClass) {
  return structure.classes?.[equivalentClass] || equivalentClass;
}

export function ontologyTriples(structure = RDF) {
  return Object.entries(structure.equivalentClasses || {})
    .map(([entityType, equivalentClass]) => {
      const className = structure.classes?.[entityType];
      const equivalentClassName = classTermForEquivalentClass(structure, equivalentClass);
      return className && equivalentClassName
        ? `${className} owl:equivalentClass ${equivalentClassName} .\n`
        : "";
    })
    .join("");
}

export function selectVariables(fields) {
  return Object.keys(fields).map(fieldName => `?${fieldName}`).join(" ");
}

export function fieldPatterns(subject, fields) {
  return Object.entries(fields)
    .map(([fieldName, field]) => {
      const predicateVariable = `?${fieldName}Predicate`;
      const predicates = [field.predicate, ...(field.previousPredicates || [])]
        .filter(Boolean)
        .map(predicate => predicate)
        .join(" ");
      const triplePattern = field.direction === "reverse"
        ? `?${fieldName} ${predicateVariable} ${subject} .`
        : `${subject} ${predicateVariable} ?${fieldName} .`;
      const pattern = `VALUES ${predicateVariable} { ${predicates} }\n${triplePattern}`;
      return field.required ? pattern : `OPTIONAL { ${pattern} }`;
    })
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
  return Object.entries(fields)
    .map(([fieldName, field]) => {
      if (field.options) return triplesFromConditionalField(subject, fieldName, field, data[fieldName]);
      return triplesFromFieldValue(subject, field, data[fieldName]);
    })
    .join("");
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

function triplesFromFieldValue(subject, field, value) {
  return valuesForField(value, field)
    .map(inputValue => {
      if (!field.createEntityFromInput) return triple(subject, field.predicate, inputValue, field);

      const entityType = field.targetEntityType;
      const template = field.targetTemplate || (entityType ? RDF.uriTemplates?.[entityType] : null);
      const inputLabel = typeof inputValue === "object" ? inputValue.label : inputValue;
      const inputId = typeof inputValue === "object" ? inputValue.id : slugify(inputValue);
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
  const optionValue = option?.value || selectedOption;
  let triples = triple(subject, field.predicate, optionValue, field);
  const optionValues = typeof value === "object" ? value?.values || {} : {};
  triples += triplesFromFields(subject, option?.fields || {}, optionValues);
  return triples;
}

export function triplesFromNestedGroups(subject, groups, data) {
  return Object.entries(groups || {})
    .map(([groupName, group]) => {
      const groupData = data[groupName] || {};
      const groupSubject = nestedGroupSubject(subject, groupName, group, groupData);
      const subfieldTriples = Object.entries(group || {})
        .filter(([, field]) => field && typeof field === "object" && field.predicate)
        .map(([fieldName, field]) => triplesFromFieldValue(groupSubject, field, groupData[fieldName]))
        .join("");
      if (!subfieldTriples || !group.predicate) return subfieldTriples;
      const groupTypeTriple = group.className ? rdfTypeTriple(groupSubject, group.className) : "";
      return triple(subject, group.predicate, groupSubject, { objectType: "uri" }) + groupTypeTriple + subfieldTriples;
    })
    .join("");
}

export function reportItemTriples(item) {
  const subject = entityUri("reportItem", item.entryNumber);
  let triples = ontologyTriples();
  triples += rdfTypeTriple(subject, RDF.classes.reportItem);
  triples += triplesFromFields(subject, RDF.reportItem.fields, item);

  Object.entries(RDF.reportItem.arrays).forEach(([fieldName, field]) => {
    (item[fieldName] || []).forEach(value => {
      triples += triple(subject, field.predicate, value, field);
    });
  });

  const location = item.exactLocation || {};
  triples += triplesFromNestedGroups(subject, RDF.reportItem.nested, { ...item, exactLocation: location });

  return triples;
}

export function reportTriples(report) {
  const subject = entityUri("report", report.id);
  let triples = ontologyTriples();
  triples += rdfTypeTriple(subject, RDF.classes.report);
  triples += triplesFromFields(subject, RDF.report.fields, report);
  triples += triplesFromNestedGroups(subject, RDF.report.nested, report);
  (report.selectedItemIds || []).forEach(id => {
    const field = RDF.report.selectedItems;
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
