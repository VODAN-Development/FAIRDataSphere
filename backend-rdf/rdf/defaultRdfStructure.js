// Default RDF ontology and form structure used when no organisation-specific
// structure has been saved yet. The UI can edit most fields, but generated and
// metadata-only fields below preserve core report/report-item behavior.
const BASE_DEFAULT_RDF = {
  prefixes: {
    sitrep: "http://sitrep.example.org/ontology#",
    resource: "http://sitrep.example.org/resource/",
    id: "http://sitrep.example.org/id/",
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
  classProperties: [],
  uriTemplates: {
    report: "id:Report_{reportNumber}",
    reportItem: "id:ReportItem_{entryNumber}",
    location: "id:Location_{id}",
    organisation: "id:Organisation_{id}",
    perpetrator: "id:Perpetrator_{id}",
    person: "id:Person_{id}",
    place: "id:Place_{id}",
    victim: "id:Victim_{id}",
  },
  reportItem: {
    idField: "entryNumber",
    fields: {
      entryNumber: { predicate: "sitrep:entryNumber", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "Entry Number", inputType: "number" },
      title: { predicate: "sitrep:title", label: "Title", inputType: "text" },
      paragraph: { predicate: "sitrep:paragraph", label: "Paragraph", inputType: "textarea" },
      dateOfEvent: { predicate: "hds:date", datatype: "xsd:date", label: "Date of Event", inputType: "date" },
      location: {
        label: "Location",
        predicate: "sitrep:hasLocation",
        inputType: "import-class",
        resourceMode: "per-instance",
        className: "hds:Location",
        targetEntityType: "location",
        targetClass: "hds:Location",
        targetTemplate: "id:Location_{id}",
        importedFields: [
          "name",
          "country",
          "region",
          "settlement",
          "coordinates",
        ],
        name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
        country: { predicate: "sitrep:country", objectType: "uri", vocabulary: "geonames", label: "Country", inputType: "uri" },
        region: { predicate: "sitrep:region", objectType: "uri", vocabulary: "geonames", label: "Region", inputType: "uri" },
        settlement: { predicate: "sitrep:settlement", objectType: "uri", vocabulary: "geonames", label: "Settlement", inputType: "uri" },
        coordinates: {
          label: "Coordinates",
          predicate: "sitrep:coordinates",
          inputType: "location",
          lat: { predicate: "geo:lat", variable: "lat", datatype: "xsd:decimal", label: "Latitude" },
          lon: { predicate: "geo:long", variable: "lon", datatype: "xsd:decimal", label: "Longitude" },
        },
      },
      eventType: { predicate: "sitrep:eventType", label: "Event Type", inputType: "select",
        options: {
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
              label: "Alleged perpetrators",
              predicate: "hds:isPerpetratorOf",
              inputType: "import-class",
              resourceMode: "per-instance",
              className: "hds:Perpetrator",
              targetEntityType: "perpetrator",
              targetClass: "hds:Perpetrator",
              targetTemplate: "resource:Perpetrator_{id}",
              importedFields: ["name"],
              name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
            },
            hrvictimIdentity: {
              label: "Victim identity",
              predicate: "hds:isVictimOf",
              inputType: "import-class",
              resourceMode: "per-instance",
              className: "hds:Victim",
              targetEntityType: "victim",
              targetClass: "hds:Victim",
              targetTemplate: "id:Victim_{id}",
              importedFields: ["name"],
              name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
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
              label: "Affected individuals",
              predicate: "hds:affected",
              inputType: "import-class",
              resourceMode: "per-instance",
              className: "hds:Victim",
              targetEntityType: "victim",
              targetClass: "hds:Victim",
              targetTemplate: "resource:Victim_{id}",
              importedFields: ["name"],
              name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
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
            involvedGovernments: { predicate: "hds:involvedGov", variable: "involvedGovernments", label: "Involved governments", inputType: "text-list" },
            involvedOrganisations: {
              label: "Involved international organizations",
              predicate: "hds:involvedIntOrg",
              inputType: "import-class",
              resourceMode: "per-instance",
              className: "hds:Organisation",
              targetEntityType: "organisation",
              targetClass: "hds:Organisation",
              targetTemplate: "resource:Organisation_{id}",
              importedFields: ["name"],
              name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
            },
            irInvolvedParties: { predicate: "hds:involvedParties", variable: "irInvolvedParties", label: "Other involved parties", inputType: "text-list" },
            responseDescription: { predicate: "hds:description", variable: "responseDescription", label: "Description", inputType: "textarea" },
          },
          humanTrafficking: {
            label: "Human trafficking/smuggling/deportation",
            inputType: "text",
            traffickingType: { predicate: "sitrep:traffickingType", variable: "traffickingType", label: "Type of trafficking event", inputType: "text" },
            abusesMentioned: { predicate: "sitrep:abusesMentioned", variable: "abusesMentioned", label: "Human rights abuses mentioned", inputType: "textarea" },
            htvictimIdentity: {
              label: "Identity of victims",
              predicate: "hds:isVictimOf",
              inputType: "import-class",
              resourceMode: "per-instance",
              className: "hds:Victim",
              targetEntityType: "victim",
              targetClass: "hds:Victim",
              targetTemplate: "resource:Victim_{id}",
              importedFields: ["name"],
              name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
            },
            htnumberOfVictims: { predicate: "sitrep:numberOfVictims", variable: "traffickingNumVictims", datatype: "xsd:integer", label: "Number of victims", inputType: "number" },
            traffickingDescription: { predicate: "hds:description", variable: "traffickingDescription", label: "Description", inputType: "textarea" },
          },
          mediaTargeting: {
            label: "Targeting of media/propaganda",
            targetingType: { predicate: "sitrep:targetingType", variable: "targetingType", label: "Type of targeting event", inputType: "text" },
            tmallegedPerpetrators: {
              label: "Alleged perpetrators",
              predicate: "hds:isPerpetratorOf",
              inputType: "import-class",
              resourceMode: "per-instance",
              className: "hds:Perpetrator",
              targetEntityType: "perpetrator",
              targetClass: "hds:Perpetrator",
              targetTemplate: "id:Perpetrator_{id}",
              importedFields: ["name"],
              name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
            },
            targetedMedia: { predicate: "sitrep:targetedMedia", variable: "targetedMedia", label: "Targeted media", inputType: "text-list" },
            mediaTargetingDescription: { predicate: "hds:description", variable: "mediaTargetingDescription", label: "Description", inputType: "textarea" },
          },
        }
      },
      source: { predicate: "hds:source", label: "Source", inputType: "text", "encrypted": true },
      createdAt: { predicate: "sitrep:createdAt", datatype: "xsd:dateTime", required: true, generated: true, label: "Created At", inputType: "datetime" },
      updatedAt: { predicate: "hds:updatedAt", datatype: "xsd:dateTime", required: true, generated: true, label: "Updated At", inputType: "datetime" },
    },
  },
  report: {
    idField: "reportNumber",
    fields: {
      title: { predicate: "sitrep:title", required: true, label: "Report Title", inputType: "text" },
      reportNumber: { predicate: "hds:number", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "Report Number", inputType: "number" },
      reportDate: { predicate: "hds:date", datatype: "xsd:date", required: true, label: "Report Date", inputType: "date" },
      createdAt: { predicate: "sitrep:createdAt", datatype: "xsd:dateTime", required: true, generated: true, label: "Created At", inputType: "datetime" },
      updatedAt: { predicate: "hds:updatedAt", datatype: "xsd:dateTime", required: true, generated: true, label: "Updated At", inputType: "datetime" },
      selectedItems: { predicate: "sitrep:hasReportItem", objectType: "uri", targetTemplate: "resource:ReportItem_{entryNumber}", allowMultiple: true, inputType: "uri-list", label: "Selected Items", metadataOnly: true },
    },
  },
  location: {
    idField: "id",
    fields: {
      id: { predicate: "sitrep:locationId", datatype: "xsd:integer", required: true, parse: "int", generated: true, label: "ID", inputType: "number" },
      name: { predicate: "hds:name", required: true, datatype: "xsd:string", label: "Name", inputType: "text" },
      country: { predicate: "sitrep:country", objectType: "uri", vocabulary: "geonames", label: "Country", inputType: "uri" },
      region: { predicate: "sitrep:region", objectType: "uri", vocabulary: "geonames", label: "Region", inputType: "uri" },
      settlement: { predicate: "sitrep:settlement", objectType: "uri", vocabulary: "geonames", label: "Settlement", inputType: "uri" },
      coordinates: {
        label: "Coordinates",
        predicate: "sitrep:coordinates",
        inputType: "location",
        lat: { predicate: "geo:lat", variable: "lat", datatype: "xsd:decimal", label: "Latitude" },
        lon: { predicate: "geo:long", variable: "lon", datatype: "xsd:decimal", label: "Longitude" },
      },
    },
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

const DEFAULT_DATATYPE_BY_INPUT_TYPE = {
  text: "xsd:string",
  textarea: "xsd:string",
  "text-list": "xsd:string",
  date: "xsd:date",
  datetime: "xsd:dateTime",
  number: "xsd:integer",
};

const GROUP_INPUT_TYPES = new Set(["import-class", "location"]);

function normalizeDefaultNamespaces(structure) {
  const normalizeFields = fields => Object.fromEntries(
    Object.entries(fields || {}).map(([fieldName, field]) => {
      if (!field || typeof field !== "object") return [fieldName, field];
      const nestedFields = Object.fromEntries(
        Object.entries(field).filter(([, value]) => value && typeof value === "object" && value.predicate)
      );
      const inputType = field.inputType || "text";
      const shouldAddDatatype = !field.datatype
        && field.objectType !== "uri"
        && !field.options
        && !GROUP_INPUT_TYPES.has(inputType)
        && Object.keys(nestedFields).length === 0;
      const nextField = {
        ...field,
        ...(field.predicate?.startsWith("hds:")
          ? { predicate: field.predicate.replace(/^hds:/, "sitrep:") }
          : {}),
        ...(field.targetTemplate?.startsWith("resource:")
          ? { targetTemplate: field.targetTemplate.replace(/^resource:/, "id:") }
          : {}),
        ...(shouldAddDatatype
          ? { datatype: DEFAULT_DATATYPE_BY_INPUT_TYPE[inputType] || "xsd:string" }
          : {}),
      };
      Object.assign(nextField, normalizeFields(nestedFields));
      nextField.options = field.options
        ? Object.fromEntries(Object.entries(field.options).map(([optionName, option]) => [
            optionName,
            {
              ...option,
              ...(option.fields
                ? { fields: normalizeFields(option.fields) }
                : normalizeFields(Object.fromEntries(
                    Object.entries(option).filter(([, value]) => value && typeof value === "object" && value.predicate)
                  )))
            },
          ]))
        : field.options;
      return [fieldName, nextField];
    })
  );

  return {
    ...structure,
    ...(structure.reportItem ? { reportItem: { ...structure.reportItem, fields: normalizeFields(structure.reportItem.fields) } } : {}),
    ...(structure.report ? { report: { ...structure.report, fields: normalizeFields(structure.report.fields) } } : {}),
    ...Object.fromEntries(
      Object.keys(structure).filter(key => !["report", "reportItem", "prefixes", "classes", "equivalentClasses", "classProperties", "uriTemplates"].includes(key))
        .filter(key => structure[key]?.fields)
        .map(key => [key, { ...structure[key], fields: normalizeFields(structure[key].fields) }])
    ),
  };
}

export const DEFAULT_RDF = normalizeDefaultNamespaces(BASE_DEFAULT_RDF);

