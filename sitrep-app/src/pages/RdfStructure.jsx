import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, gql } from '@apollo/client';
import OrganisationGate from '../components/OrganisationGate.jsx';
import { useOrganisationContext } from '../auth/useOrganisationContext.js';

const GET_RDF_STRUCTURE = gql`
  query GetRdfStructureEditor($organisationId: ID) {
    rdfStructure(organisationId: $organisationId) {
      json
    }
    rdfStructurePresets(organisationId: $organisationId) {
      id
      name
      json
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_RDF_STRUCTURE = gql`
  mutation UpdateRdfStructure($json: String!, $organisationId: ID) {
    updateRdfStructure(json: $json, organisationId: $organisationId) {
      json
    }
  }
`;

const SAVE_RDF_STRUCTURE_PRESET = gql`
  mutation SaveRdfStructurePreset($name: String!, $json: String!, $organisationId: ID) {
    saveRdfStructurePreset(name: $name, json: $json, organisationId: $organisationId) {
      id
      name
      json
      createdAt
      updatedAt
    }
  }
`;

const LOAD_RDF_STRUCTURE_PRESET = gql`
  mutation LoadRdfStructurePreset($id: ID!, $organisationId: ID) {
    loadRdfStructurePreset(id: $id, organisationId: $organisationId) {
      json
    }
  }
`;

const datatypeByInputType = {
  text: 'xsd:string',
  textarea: 'xsd:string',
  'text-list': 'xsd:string',
  uri: 'uri',
  'uri-list': 'uri',
  date: 'xsd:date',
  datetime: 'xsd:dateTime',
  number: 'xsd:integer',
};

const datatypeOptions = [
  'xsd:string',
  'xsd:integer',
  'xsd:decimal',
  'xsd:boolean',
  'xsd:date',
  'xsd:dateTime',
  'xsd:time',
  'xsd:anyURI',
];

const classPropertyOptions = [
  'owl:equivalentClass',
  'rdfs:subClassOf',
  'owl:disjointWith',
  'owl:complementOf',
  'owl:sameAs',
  'rdfs:seeAlso',
  'rdfs:isDefinedBy',
  'skos:exactMatch',
  'skos:closeMatch',
  'skos:broadMatch',
  'skos:narrowMatch',
  'skos:relatedMatch',
  'dcterms:relation',
  'schema:sameAs',
  'schema:about',
];

const groupPropertyNames = new Set(['label', 'predicate', 'inputType', 'required', 'resourceMode', 'className', 'targetEntityType', 'targetClass', 'targetTemplate', 'targetLabelField']);
const protectedEntityTypes = new Set(['report', 'reportItem']);

function downloadJsonFile(filename, json) {
  const blob = new Blob([json.endsWith('\n') ? json : `${json}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(value, fallback) {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

const columnHelp = {
  order: 'Drag this handle to change the order fields appear in forms and item displays.',
  label: 'Display name of field for users.',
  valueMode: 'Choose whether the field stores one value, multiple values, a group of subfields, or option-specific subfields.',
  predicate: 'RDF predicate used when this value is written as a triple.',
  datatype: 'RDF datatype for literal values. You can choose a suggestion or type your own.',
  input: 'Form control type shown to users when entering this field value.',
  required: 'Whether the field must be filled in before submitting.',
  encrypted: 'Encrypts this field before it is stored. Authorized users see the decrypted value.',
  optionValue: 'URI value written for this selected option in RDF.',
  linkedClass: 'Class that should be created or linked when this field is filled in.',
  linkedLabel: 'Field on the linked class that receives the entered label.',
  linkedEnabled: 'Whether this value creates or links to an instance of another RDF class.',
};

function ActionHeaderSpacer() {
  return <span className="rdf-action-header-spacer" aria-hidden="true" />;
}

function HelpHeader({ children, help }) {
  return (
    <strong className="rdf-help-header">
      <span>{children}</span>
      <button type="button" className="rdf-help-button" aria-label={`${children} help`}>
        ?
        <span className="rdf-help-tooltip" role="tooltip">{help}</span>
      </button>
    </strong>
  );
}

function applyInputTypeDefaults(row, inputType) {
  const nextRow = {
    ...row,
    inputType,
    ...(Object.hasOwn(datatypeByInputType, inputType) ? { datatype: datatypeByInputType[inputType] } : {}),
  };
  if (inputType === 'uri' || inputType === 'uri-list') {
    nextRow.objectType = 'uri';
  } else if (!isLinkedField(nextRow) && !nextRow.options) {
    delete nextRow.objectType;
  }
  return nextRow;
}

function withDefaultDatatype(field) {
  if (!field || isLinkedField(field)) return field;
  if (field.kind === 'group' || field.kind === 'conditional') return field;
  const inputType = field.inputType || (field.kind === 'array' ? 'text-list' : 'text');
  if (!Object.hasOwn(datatypeByInputType, inputType)) return field;
  return {
    ...field,
    ...(inputType === 'uri' || inputType === 'uri-list' ? { objectType: 'uri' } : {}),
    datatype: field.datatype || datatypeByInputType[inputType],
  };
}

function datatypeDisplayValue(field) {
  if (isLinkedField(field) || field.inputType === 'uri' || field.inputType === 'uri-list' || field.objectType === 'uri') {
    return 'uri';
  }
  if (field.kind === 'group' || field.kind === 'conditional') return '';
  return field.datatype || '';
}

function datatypeIsLocked(field) {
  return field.kind === 'group'
    || field.kind === 'array'
    || field.kind === 'conditional'
    || isLinkedField(field)
    || field.inputType === 'uri'
    || field.inputType === 'uri-list'
    || field.objectType === 'uri';
}

function moveRow(rows, fromIndex, toIndex) {
  if (fromIndex === toIndex) return rows;
  const nextRows = [...rows];
  const [movedRow] = nextRows.splice(fromIndex, 1);
  nextRows.splice(toIndex, 0, movedRow);
  return nextRows;
}

function uniqueName(baseName, existingNames) {
  const fallback = baseName || 'newField';
  let candidate = fallback;
  let index = 2;
  while (existingNames.has(candidate)) {
    candidate = `${fallback}${index}`;
    index += 1;
  }
  return candidate;
}

function rowsFromFields(fields, editableFieldNames = []) {
  const editableNames = new Set(editableFieldNames);
  return Object.entries(fields || {}).map(([name, field]) => ({
    name,
    kind: fieldKind(field),
    ...field,
    isNew: editableNames.has(name),
  }));
}

function fieldKind(field = {}) {
  if (isGroupField(field)) return 'group';
  if (field.options) return 'conditional';
  if (field.allowMultiple || field.inputType === 'text-list' || field.inputType === 'uri-list') return 'array';
  return 'scalar';
}

function groupSubfieldEntries(group = {}) {
  return Object.entries(group || {})
    .filter(([key, field]) => !groupPropertyNames.has(key) && field && typeof field === 'object' && field.predicate);
}

function isGroupField(field = {}) {
  return !field.options && groupSubfieldEntries(field).length > 0;
}

function isLinkedField(field = {}) {
  return !!(field.createEntityFromInput || field.targetClass || field.targetTemplate || field.targetLabelField);
}

function isLinkedGroup(group = {}) {
  return !!(group.targetEntityType || group.targetLabelField || group.className);
}

function combinedRowsFromEntity(entity, editableFieldNames = []) {
  const editableNames = new Set(editableFieldNames);
  const fields = {
    ...(entity?.fields || {}),
    ...(entity?.arrays || {}),
    ...(entity?.nested || {}),
  };
  const rows = Object.entries(fields)
    .filter(([, field]) => !field.generated && !field.metadataOnly)
    .map(([name, field]) => {
      const kind = fieldKind(field);
      if (kind === 'group') {
        const group = field;
        const groupProps = Object.fromEntries(
          Object.entries(group || {}).filter(([key, value]) => groupPropertyNames.has(key) && value !== undefined)
        );
        return {
          name,
          kind,
          inputType: group?.inputType || 'location',
          predicate: group?.predicate || `sitrep:${name}`,
          ...groupProps,
          targetLabelField: group?.targetLabelField || groupProps.targetLabelField,
          resourceMode: 'per-instance',
          subfields: groupSubfieldEntries(group)
            .map(([subfieldName, subfield]) => withDefaultDatatype({ name: subfieldName, kind: fieldKind(subfield), ...subfield })),
          isNew: editableNames.has(name),
        };
      }
      return withDefaultDatatype({
        name,
        kind,
        ...field,
        options: field.options
          ? Object.entries(field.options).map(([optionName, option]) => ({
              ...option,
              name: optionName,
              label: option.label || optionName,
              value: option.value || classForOption(optionName),
              subfields: Object.entries(option.fields || {})
                .map(([subfieldName, subfield]) => withDefaultDatatype({ name: subfieldName, kind: fieldKind(subfield), ...subfield })),
            }))
          : undefined,
        isNew: editableNames.has(name),
      });
    });

  return rows;
}

function nextFieldName(rows) {
  let index = rows.length + 1;
  while (rows.some(row => row.name === `newField${index}`)) {
    index += 1;
  }
  return `newField${index}`;
}

function nextClassName(structure) {
  const classes = structure?.classes || {};
  let index = Object.keys(classes).length + 1;
  while (classes[`newClass${index}`]) {
    index += 1;
  }
  return `newClass${index}`;
}

function titleForEntity(entityType) {
  return `${entityType.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase())} Fields`;
}

function nameFromLabel(label, fallback = 'newField') {
  const words = String(label || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return fallback;
  return words
    .map((word, index) => {
      const normalized = word.charAt(0).toUpperCase() + word.slice(1);
      return index === 0 ? normalized.charAt(0).toLowerCase() + normalized.slice(1) : normalized;
    })
    .join('');
}

function capitalizeLocalName(name) {
  const value = String(name || '');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function predicateForSubfield(parentName, subfieldName) {
  return `sitrep:${parentName || 'field'}${capitalizeLocalName(subfieldName)}`;
}

function uriTemplateForEntity(entityType) {
  return `resource:${entityType.charAt(0).toUpperCase()}${entityType.slice(1)}_{id}`;
}

function classForEntity(entityType) {
  return `sitrep:${entityType.charAt(0).toUpperCase()}${entityType.slice(1)}`;
}

function classForOption(optionName) {
  const localName = String(optionName || 'option')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return `sitrep:${localName || 'Option'}`;
}

function labelForFieldName(fieldName) {
  return String(fieldName || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, char => char.toUpperCase());
}

function equivalentClassValues(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function equivalentClassMatchesEntity(structure, value, entityType) {
  return value === entityType || value === structure?.classes?.[entityType];
}

function equivalentClassPropertyValue(structure, entityType) {
  return structure?.classes?.[entityType] || entityType;
}

function classPropertySubjectMatches(structure, propertySubject, entityType) {
  return equivalentClassMatchesEntity(structure, propertySubject, entityType);
}

function classPropertyObjectMatches(structure, propertyObject, entityType) {
  return equivalentClassMatchesEntity(structure, propertyObject, entityType);
}

function removeEquivalentClassReferences(structure, equivalentClasses = {}, entityType) {
  return Object.fromEntries(
    Object.entries(equivalentClasses)
      .filter(([source]) => source !== entityType)
      .map(([source, value]) => {
        const nextValues = equivalentClassValues(value).filter(target => !equivalentClassMatchesEntity(structure, target, entityType));
        return [source, nextValues];
      })
      .filter(([, values]) => values.length > 0)
  );
}

function removeClassPropertyReferences(structure, classProperties = [], entityType) {
  return (classProperties || []).filter(property => (
    !classPropertySubjectMatches(structure, property.subject, entityType)
    && !classPropertyObjectMatches(structure, property.object, entityType)
  ));
}

function hasEquivalentClassPair(structure, sourceEntityType, targetEntityType) {
  return equivalentClassValues(structure?.equivalentClasses?.[sourceEntityType])
    .some(value => equivalentClassMatchesEntity(structure, value, targetEntityType));
}

function equivalentClassDirectionFor(structure, selectedEntityType, targetEntityType) {
  return classPropertyForPair(structure, selectedEntityType, targetEntityType)?.direction || "subject";
}

function classPropertyForPair(structure, selectedEntityType, targetEntityType) {
  const explicitProperty = (structure?.classProperties || []).find(property => (
    classPropertySubjectMatches(structure, property.subject, selectedEntityType)
    && classPropertyObjectMatches(structure, property.object, targetEntityType)
  ));
  if (explicitProperty) return { checked: true, direction: "subject", predicate: explicitProperty.predicate ?? "owl:equivalentClass" };

  const reverseExplicitProperty = (structure?.classProperties || []).find(property => (
    classPropertySubjectMatches(structure, property.subject, targetEntityType)
    && classPropertyObjectMatches(structure, property.object, selectedEntityType)
  ));
  if (reverseExplicitProperty) return { checked: true, direction: "object", predicate: reverseExplicitProperty.predicate ?? "owl:equivalentClass" };

  if (hasEquivalentClassPair(structure, selectedEntityType, targetEntityType)) {
    return { checked: true, direction: "subject", predicate: "owl:equivalentClass" };
  }
  if (hasEquivalentClassPair(structure, targetEntityType, selectedEntityType)) {
    return { checked: true, direction: "object", predicate: "owl:equivalentClass" };
  }
  return { checked: false, direction: "subject", predicate: "owl:equivalentClass" };
}

function withoutClassPropertyPair(structure, classProperties = [], leftEntityType, rightEntityType) {
  return (classProperties || []).filter(property => {
    const forward = classPropertySubjectMatches(structure, property.subject, leftEntityType)
      && classPropertyObjectMatches(structure, property.object, rightEntityType);
    const reverse = classPropertySubjectMatches(structure, property.subject, rightEntityType)
      && classPropertyObjectMatches(structure, property.object, leftEntityType);
    return !forward && !reverse;
  });
}

function withoutEquivalentClassPair(structure, equivalentClasses = {}, leftEntityType, rightEntityType) {
  return Object.fromEntries(
    Object.entries(equivalentClasses)
      .map(([sourceEntityType, value]) => {
        const nextValues = equivalentClassValues(value).filter(targetEntityType => {
          return !(
            sourceEntityType === leftEntityType && equivalentClassMatchesEntity(structure, targetEntityType, rightEntityType)
          ) && !(
            sourceEntityType === rightEntityType && equivalentClassMatchesEntity(structure, targetEntityType, leftEntityType)
          );
        });
        return [sourceEntityType, nextValues];
      })
      .filter(([, values]) => values.length > 0)
  );
}

function labelFieldForEntity(structure, entityType) {
  const fields = structure?.[entityType]?.fields || {};
  if (fields.name) return 'name';
  return Object.entries(fields).find(([, field]) => !field.generated && !field.metadataOnly)?.[0]
    || structure?.[entityType]?.idField
    || 'name';
}

function linkedFieldDefaults(structure, row, targetEntityType = row.targetEntityType) {
  if (!targetEntityType) {
      return {
        objectType: 'uri',
        inputType: row.kind === 'array' ? 'uri-list' : 'uri',
        createEntityFromInput: true,
        allowMultiple: row.kind === 'array',
    };
  }

  return {
    objectType: 'uri',
    inputType: row.kind === 'array' ? 'uri-list' : 'uri',
    createEntityFromInput: true,
    allowMultiple: row.kind === 'array',
    targetEntityType,
    targetClass: structure?.classes?.[targetEntityType] || row.targetClass,
    targetTemplate: structure?.uriTemplates?.[targetEntityType] || row.targetTemplate,
    targetLabelField: row.targetLabelField || labelFieldForEntity(structure, targetEntityType),
  };
}

function linkedGroupDefaults(structure, row, targetEntityType = row.targetEntityType) {
  if (!targetEntityType) return {};
  return {
    targetEntityType,
    className: structure?.classes?.[targetEntityType] || row.className,
    targetLabelField: row.targetLabelField || labelFieldForEntity(structure, targetEntityType),
  };
}

function clearLinkedFieldSettings(field) {
  const nextField = { ...field };
  delete nextField.targetEntityType;
  delete nextField.targetClass;
  delete nextField.targetTemplate;
  delete nextField.targetLabelField;
  delete nextField.createEntityFromInput;
  delete nextField.objectType;
  delete nextField.allowMultiple;
  return nextField;
}

function clearLinkedGroupSettings(group) {
  const nextGroup = { ...group };
  delete nextGroup.targetEntityType;
  delete nextGroup.targetLabelField;
  delete nextGroup.className;
  return nextGroup;
}

function linkTargetEntriesForEntity(structure, entityType) {
  const entity = structure?.[entityType] || {};
  const fields = {
    ...(entity.fields || {}),
    ...(entity.arrays || {}),
    ...(entity.nested || {}),
  };
  return [
    ...Object.entries(fields),
  ]
    .filter(([, field]) => !field?.generated && !field?.metadataOnly)
    .map(([fieldName, field]) => ({
      name: fieldName,
      label: field?.label || labelForFieldName(fieldName),
    }));
}

function uriTemplateToken(template) {
  return String(template || '').match(/\{([^}]+)\}/)?.[1];
}

function generatedIdFieldFor(entityType, fieldName) {
  return {
    predicate: `sitrep:${fieldName === 'id' ? `${entityType}Id` : fieldName}`,
    datatype: 'xsd:integer',
    required: true,
    parse: 'int',
    generated: true,
    label: 'ID',
    inputType: 'number',
    ...(fieldName === 'entryNumber' ? { label: 'Entry Number' } : {}),
    ...(fieldName === 'reportNumber' ? { predicate: 'hds:number', label: 'Report Number' } : {}),
  };
}

function newFieldFor(rows) {
  const name = nextFieldName(rows);
  return {
    isNew: true,
    kind: 'scalar',
    name,
    label: 'New Field',
    predicate: `sitrep:${name}`,
    datatype: 'xsd:string',
    required: false,
    inputType: 'text',
  };
}

function newSubfieldFor(row) {
  const subfields = row.subfields || [];
  let index = subfields.length + 1;
  while (subfields.some(subfield => subfield.name === `subfield${index}`)) {
    index += 1;
  }
  const name = `subfield${index}`;
  const label = `Subfield ${index}`;
  return {
    isNew: true,
    name,
    label,
    predicate: predicateForSubfield(row.name, name),
    datatype: 'xsd:string',
    inputType: 'text',
  };
}

function defaultSubfieldsFor(row) {
  const firstSubfield = newSubfieldFor({ ...row, subfields: [] });
  const secondSubfield = newSubfieldFor({ ...row, subfields: [firstSubfield] });
  return [firstSubfield, secondSubfield];
}

function newOptionFor(row) {
  const options = row.options || [];
  let index = options.length + 1;
  while (options.some(option => option.name === `option${index}`)) {
    index += 1;
  }
  const name = `option${index}`;
  return {
    isNew: true,
    name,
    label: `Option ${index}`,
    value: classForOption(name),
    subfields: defaultSubfieldsFor({ ...row, name, subfields: [] }),
  };
}

function persistOptionFromRow(option) {
  const persisted = omitKeys(option, ['name', 'isNew', 'subfields', 'direction']);
  if (isLinkedField(option)) {
    persisted.objectType = 'uri';
    persisted.createEntityFromInput = true;
    persisted.allowMultiple = false;
    persisted.inputType = 'uri';
    persisted.targetLabelField = persisted.targetLabelField || 'name';
    delete persisted.datatype;
  } else if (persisted.inputType === 'uri') {
    persisted.objectType = 'uri';
    delete persisted.datatype;
  } else {
    delete persisted.targetEntityType;
    delete persisted.targetClass;
    delete persisted.targetTemplate;
    delete persisted.targetLabelField;
    delete persisted.createEntityFromInput;
    delete persisted.objectType;
    delete persisted.allowMultiple;
  }
  return persisted;
}

function omitKeys(value, keys) {
  const nextValue = { ...value };
  keys.forEach(key => {
    delete nextValue[key];
  });
  return nextValue;
}

function persistFieldFromRow(row) {
  const field = omitKeys(row, ['name', 'kind', 'isNew', 'subfields', 'variable', 'options', 'previousPredicates', 'direction']);
  if (isLinkedField(row)) {
    field.objectType = 'uri';
    field.createEntityFromInput = true;
    field.allowMultiple = row.kind === 'array' ? true : (row.allowMultiple ?? false);
    field.inputType = field.allowMultiple ? 'uri-list' : 'uri';
    field.targetLabelField = field.targetLabelField || 'name';
    delete field.datatype;
  } else if (row.inputType === 'uri' || row.inputType === 'uri-list') {
    field.objectType = 'uri';
    delete field.datatype;
    if (row.kind === 'array') {
      field.allowMultiple = true;
      field.inputType = 'uri-list';
    }
  } else {
    delete field.targetClass;
    delete field.targetTemplate;
    delete field.targetLabelField;
    delete field.createEntityFromInput;
    if (row.kind === 'array') {
      field.allowMultiple = true;
      field.inputType = field.inputType || 'text-list';
      field.datatype = field.datatype || datatypeByInputType[field.inputType] || 'xsd:string';
    } else {
      delete field.allowMultiple;
    }
    delete field.objectType;
  }
  return field;
}

function fieldsFromRows(rows) {
  return Object.fromEntries(
    rows
      .filter(row => ['scalar', 'conditional', 'array', 'group'].includes(row.kind) && row.name && row.predicate)
      .map((row) => {
        const field = persistFieldFromRow(row);
        if (row.kind === 'conditional') {
          field.inputType = 'select';
          field.objectType = 'uri';
          field.options = Object.fromEntries(
            (row.options || [])
              .filter(option => option.name)
              .map(option => [
                option.name,
                {
                  ...persistOptionFromRow(option),
                  label: option.label || option.name,
                  value: option.value || classForOption(option.name),
                  fields: Object.fromEntries(
                    (option.subfields || [])
                      .filter(subfield => subfield.name && subfield.predicate)
                      .map(subfield => [subfield.name, persistFieldFromRow(subfield)])
                  ),
                },
              ])
          );
        } else if (row.kind === 'group') {
          const group = omitKeys(row, ['name', 'kind', 'isNew', 'subfields', 'datatype', 'variable', 'options', 'previousPredicates', 'direction']);
          return [
            row.name,
            {
              ...group,
              inputType: group.inputType || 'location',
              resourceMode: 'per-instance',
              ...Object.fromEntries(
                (row.subfields || [])
                  .filter(subfield => subfield.name && subfield.predicate)
                  .map(subfield => [subfield.name, persistFieldFromRow(subfield)])
              ),
            },
          ];
        }
        return [row.name, field];
      })
  );
}

function applyDefaultDatatypesToFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([fieldName, field]) => {
      if (!field || typeof field !== 'object') return [fieldName, field];
      const nextField = { ...field };
      if (nextField.inputType === 'uri' || nextField.inputType === 'uri-list') {
        nextField.objectType = 'uri';
        delete nextField.datatype;
      }
      if (!isLinkedField(nextField) && !nextField.options && !isGroupField(nextField)) {
        const inputType = nextField.inputType || 'text';
        if (!nextField.objectType && !nextField.datatype && Object.hasOwn(datatypeByInputType, inputType)) {
          nextField.datatype = datatypeByInputType[inputType];
        }
      }
      if (nextField.options) {
        nextField.options = Object.fromEntries(
          Object.entries(nextField.options).map(([optionName, option]) => [
            optionName,
            {
              ...option,
              fields: applyDefaultDatatypesToFields(option.fields || {}),
            },
          ])
        );
      }
      if (isGroupField(nextField)) {
        groupSubfieldEntries(nextField).forEach(([subfieldName, subfield]) => {
          nextField[subfieldName] = applyDefaultDatatypesToFields({ [subfieldName]: subfield })[subfieldName];
        });
      }
      return [fieldName, nextField];
    })
  );
}

function applyDefaultDatatypesToStructure(structure) {
  const nextStructure = { ...structure };
  Object.keys({ ...(nextStructure.classes || {}), ...(nextStructure.uriTemplates || {}) }).forEach(entityType => {
    if (nextStructure[entityType]?.fields) {
      nextStructure[entityType] = {
        ...nextStructure[entityType],
        fields: applyDefaultDatatypesToFields(nextStructure[entityType].fields),
      };
    }
  });
  return nextStructure;
}

function SuggestionInput({ value, disabled, onChange, placeholder, listId, options = [], ariaLabel }) {
  const inputRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const hasOptions = options.length > 0;

  const openSuggestions = () => {
    if (disabled) return;
    inputRef.current?.focus();
    if (hasOptions) {
      setIsOpen(open => !open);
    } else {
      inputRef.current?.showPicker?.();
    }
  };

  const chooseSuggestion = (option) => {
    onChange(option);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="rdf-suggestion-input">
      <input
        ref={inputRef}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsOpen(false)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        disabled={disabled}
        placeholder={placeholder}
        list={hasOptions ? undefined : listId}
        aria-label={ariaLabel}
        aria-expanded={hasOptions ? isOpen : undefined}
      />
      <button
        type="button"
        className="rdf-suggestion-picker"
        onClick={openSuggestions}
        disabled={disabled}
        aria-label="Show suggestions"
        title="Show suggestions"
      />
      {hasOptions && isOpen && (
        <div className="rdf-suggestion-menu" role="listbox">
          {options.map(option => (
            <button
              key={option}
              type="button"
              className={option === value ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                chooseSuggestion(option);
              }}
              role="option"
              aria-selected={option === value}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DatatypeInput({ value, disabled, onChange, placeholder = 'xsd:date' }) {
  return (
    <SuggestionInput
      value={value}
      disabled={disabled}
      onChange={onChange}
      placeholder={placeholder}
      listId="rdf-datatype-options"
      options={datatypeOptions}
    />
  );
}

function FieldTable({ title, rows, onChange, onAdd, onRemove }) {
  const [dragIndex, setDragIndex] = useState(null);

  const updateRow = (index, key, value) => {
    onChange(rows.map((row, i) => {
      if (i !== index) return row;

      if (key === 'inputType') return applyInputTypeDefaults(row, value);
      return { ...row, [key]: value };
    }));
  };

  const dropRow = (index) => {
    if (dragIndex === null) return;
    onChange(moveRow(rows, dragIndex, index));
    setDragIndex(null);
  };

  return (
    <div className="rdf-editor-section">
      <div className="rdf-editor-heading">
        <h3>{title}</h3>
      </div>
      <div className="rdf-field-grid">
        <HelpHeader help={columnHelp.order}>Order</HelpHeader>
        <HelpHeader help={columnHelp.name}>Name</HelpHeader>
        <HelpHeader help={columnHelp.label}>Label</HelpHeader>
        <HelpHeader help={columnHelp.predicate}>Predicate</HelpHeader>
        <HelpHeader help={columnHelp.datatype}>Datatype</HelpHeader>
        <HelpHeader help={columnHelp.input}>Input</HelpHeader>
        <HelpHeader help={columnHelp.required}>Required</HelpHeader>
        <HelpHeader help={columnHelp.encrypted}>Encrypt</HelpHeader>
        <ActionHeaderSpacer />
        {rows.map((row, index) => (
          <div
            key={`${row.isNew ? 'new-field' : row.name}-${index}`}
            className="rdf-field-row"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dropRow(index)}
          >
            <button
              type="button"
              className="drag-handle"
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
              aria-label="Drag to reorder"
              title="Drag to reorder"
            >
              <span className="drag-icon" aria-hidden="true">⋮⋮</span>
            </button>
            <input
              value={row.name || ''}
              onChange={(e) => updateRow(index, 'name', e.target.value)}
              disabled={!row.isNew}
              title={row.isNew ? 'Internal key for this new field' : 'Internal key. Existing field names are locked so migrations stay reliable.'}
            />
            <input value={row.label || ''} onChange={(e) => updateRow(index, 'label', e.target.value)} />
            <input value={row.predicate || ''} onChange={(e) => updateRow(index, 'predicate', e.target.value)} />
            <DatatypeInput value={row.datatype} onChange={(value) => updateRow(index, 'datatype', value)} />
            <select value={row.inputType || 'text'} onChange={(e) => updateRow(index, 'inputType', e.target.value)}>
              <option value="text">Text</option>
              <option value="uri">URI</option>
              <option value="textarea">Textarea</option>
              <option value="date">Date</option>
              <option value="number">Number</option>
              <option value="datetime">Date/time</option>
            </select>
            <input type="checkbox" checked={!!row.required} onChange={(e) => updateRow(index, 'required', e.target.checked)} />
            <input type="checkbox" checked={!!row.encrypted} onChange={(e) => updateRow(index, 'encrypted', e.target.checked)} />
            <button type="button" className="delete-btn" onClick={() => onRemove(index)}>Remove</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={onAdd} className="secondary-btn rdf-add-field-button">+ Add Field</button>
    </div>
  );
}

function ClassSidebar({
  classes = {},
  uriTemplates = {},
  editableClassNames = [],
  selectedEntityType,
  onSelect,
  onChange,
  onAdd,
  onDelete,
}) {
  const [draftNames, setDraftNames] = useState({});
  const editableNames = new Set(editableClassNames);
  const rows = Object.keys({ ...classes, ...uriTemplates });
  const updateClassNameDraft = (name, nextName) => {
    if (!editableNames.has(name)) return;
    const nextEntityName = nextName || name;
    setDraftNames(current => ({ ...current, [name]: nextName }));
    onChange({
      classes: { ...classes, [name]: classForEntity(nextEntityName) },
      uriTemplates: { ...uriTemplates, [name]: uriTemplateForEntity(nextEntityName) },
      templateChanged: { entityType: name, template: uriTemplateForEntity(nextEntityName), entityName: nextEntityName },
    });
  };
  const commitClassName = (name) => {
    const nextName = (draftNames[name] || name).trim();
    if (!editableNames.has(name) || !nextName || nextName === name || rows.includes(nextName)) return;
    setDraftNames(current => {
      const next = { ...current };
      delete next[name];
      return next;
    });
    onChange({
      classes: Object.fromEntries(Object.entries(classes).map(([key, value]) => [key === name ? nextName : key, value])),
      uriTemplates: {
        ...Object.fromEntries(Object.entries(uriTemplates).filter(([key]) => key !== name)),
        [nextName]: uriTemplateForEntity(nextName),
      },
      renamedClass: { from: name, to: nextName },
    });
  };
  const updateClass = (name, value) => {
    onChange({ classes: { ...classes, [name]: value }, uriTemplates });
  };
  const updateTemplate = (name, value) => {
    if (!editableNames.has(name)) return;
    onChange({
      classes,
      uriTemplates: { ...uriTemplates, [name]: value },
      templateChanged: { entityType: name, template: value },
    });
  };

  return (
    <aside className="rdf-class-sidebar">
      <div className="rdf-class-sidebar-heading">
        <h3>Classes</h3>
      </div>
      <div className="rdf-class-list">
        {rows.map(name => {
          const editable = editableNames.has(name);
          const isProtected = protectedEntityTypes.has(name);
          const displayName = editable ? draftNames[name] ?? name : name;
          return (
            <div
              key={name}
              className={`rdf-class-card${name === selectedEntityType ? ' selected' : ''}`}
            >
              <div className="rdf-class-card-top">
                <button
                  type="button"
                  className="rdf-class-nav-button"
                  onClick={() => onSelect(name)}
                  aria-current={name === selectedEntityType ? 'page' : undefined}
                >
                  {displayName}
                </button>
                {!isProtected && (
                  <button
                    type="button"
                    className="delete-btn rdf-class-delete"
                    onClick={() => onDelete(name)}
                    title={`Delete ${name}`}
                  >
                    Delete
                  </button>
                )}
              </div>
              {name === selectedEntityType && (
                <div className="rdf-class-details">
                  <label>
                    <span>Entity</span>
                    <input
                      value={displayName}
                      disabled={!editable}
                      onChange={(e) => updateClassNameDraft(name, e.target.value)}
                      onBlur={() => commitClassName(name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                      }}
                      title={editable ? 'Internal key for this new class' : 'Internal key. Existing class keys are locked so migrations stay reliable.'}
                    />
                  </label>
                  <label>
                    <span>Class</span>
                    <input value={classes[name] || ''} onChange={(e) => updateClass(name, e.target.value)} />
                  </label>
                  <label>
                    <span>URI Template</span>
                    <input
                      value={uriTemplates[name] || uriTemplateForEntity(name)}
                      disabled={!editable}
                      onChange={(e) => updateTemplate(name, e.target.value)}
                      title={editable ? 'URI template for this new class. It locks after saving.' : 'URI templates are locked after saving.'}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={onAdd} className="secondary-btn rdf-add-class-button">+ Add Class</button>
    </aside>
  );
}

function CombinedFieldTable({ title, rows, structure, selectedEntityType, onChange, onAdd, onRemove }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState({});
  const linkableEntityTypes = Object.keys(structure?.classes || {}).filter(entityType => entityType !== selectedEntityType);

  const sectionKey = (row, index, suffix) => `${row.name || `field-${index}`}-${suffix}`;
  const toggleSection = (key) => {
    setCollapsedSections((current) => ({ ...current, [key]: !current[key] }));
  };

  const updateRow = (index, key, value) => {
    onChange(rows.map((row, i) => {
      if (i !== index) return row;

      const nextRow = { ...row, [key]: value };
      if (key === 'label' && row.isNew) {
        nextRow.name = uniqueName(nameFromLabel(value), new Set(rows.filter((_, rowIndex) => rowIndex !== index).map(candidate => candidate.name)));
        nextRow.predicate = `sitrep:${nextRow.name}`;
      }
      if (key === 'kind') {
        if (value === 'array') {
          const nextInputType = isLinkedField(nextRow) ? 'uri-list' : 'text-list';
          nextRow.inputType = nextInputType;
          nextRow.datatype = datatypeByInputType[nextInputType];
          if (nextInputType === 'uri-list') nextRow.objectType = 'uri';
          nextRow.predicate = nextRow.predicate || `sitrep:${nextRow.name}`;
          nextRow.allowMultiple = isLinkedField(nextRow) ? true : nextRow.allowMultiple;
          delete nextRow.subfields;
          delete nextRow.variable;
        } else if (value === 'group') {
          delete nextRow.inputType;
          delete nextRow.datatype;
          delete nextRow.objectType;
          nextRow.predicate = nextRow.predicate || `sitrep:${nextRow.name}`;
          nextRow.resourceMode = 'per-instance';
          nextRow.subfields = nextRow.subfields?.length ? nextRow.subfields : defaultSubfieldsFor(nextRow);
          Object.assign(nextRow, clearLinkedFieldSettings(nextRow));
          delete nextRow.options;
        } else if (value === 'conditional') {
          nextRow.inputType = 'select';
          delete nextRow.datatype;
          nextRow.predicate = nextRow.predicate || `sitrep:${nextRow.name}`;
          nextRow.options = nextRow.options?.length ? nextRow.options : [newOptionFor(nextRow)];
          Object.assign(nextRow, clearLinkedFieldSettings(nextRow));
          delete nextRow.subfields;
          delete nextRow.variable;
        } else {
          nextRow.inputType = nextRow.inputType === 'text-list' || nextRow.inputType === 'uri-list' || nextRow.inputType === 'location' ? 'text' : (nextRow.inputType || 'text');
          if (isLinkedField(nextRow)) {
            nextRow.inputType = 'uri';
            nextRow.allowMultiple = false;
            nextRow.datatype = 'uri';
            nextRow.objectType = 'uri';
          } else {
            nextRow.datatype = nextRow.datatype || datatypeByInputType[nextRow.inputType] || '';
          }
          nextRow.predicate = nextRow.predicate || `sitrep:${nextRow.name}`;
          delete nextRow.variable;
          delete nextRow.subfields;
          delete nextRow.options;
        }
      }
      if (key === 'linkedEnabled') {
        if (nextRow.kind === 'group') {
          if (!value) return clearLinkedGroupSettings(nextRow);
          const targetEntityType = nextRow.targetEntityType || linkableEntityTypes[0] || '';
          return {
            ...nextRow,
            ...linkedGroupDefaults(structure, nextRow, targetEntityType),
          };
        }
        if (!value) return clearLinkedFieldSettings(nextRow);
        const targetEntityType = nextRow.targetEntityType || linkableEntityTypes[0] || '';
        return {
          ...nextRow,
          ...linkedFieldDefaults(structure, nextRow, targetEntityType),
          inputType: nextRow.kind === 'array' ? 'uri-list' : 'uri',
          datatype: 'uri',
          objectType: 'uri',
        };
      }
      if (key === 'targetEntityType') {
        if (nextRow.kind === 'group') {
          return {
            ...nextRow,
            ...linkedGroupDefaults(structure, { ...nextRow, targetLabelField: '' }, value),
          };
        }
        return {
          ...nextRow,
          ...linkedFieldDefaults(structure, { ...nextRow, targetLabelField: '' }, value),
        };
      }
      if (key === 'inputType') {
        return applyInputTypeDefaults(nextRow, value);
      }
      return nextRow;
    }));
  };

  const updateNestedFieldForKind = (field, key, value, siblingFields = [], parentName = '') => {
    const nextField = { ...field, [key]: value };
    if (key === 'label' && field.isNew) {
      const nextName = uniqueName(
        nameFromLabel(value, 'subfield'),
        new Set(siblingFields.filter(candidate => candidate !== field).map(candidate => candidate.name))
      );
      nextField.name = nextName;
      nextField.predicate = predicateForSubfield(parentName, nextName);
    }
    if (key === 'kind') {
      if (value === 'array') {
        const nextInputType = isLinkedField(nextField) ? 'uri-list' : 'text-list';
        nextField.inputType = nextInputType;
        nextField.datatype = datatypeByInputType[nextInputType];
        if (nextInputType === 'uri-list') nextField.objectType = 'uri';
        nextField.allowMultiple = isLinkedField(nextField) ? true : nextField.allowMultiple;
      } else {
        nextField.inputType = nextField.inputType === 'uri-list' || nextField.inputType === 'text-list' ? 'text' : (nextField.inputType || 'text');
        if (isLinkedField(nextField)) {
          nextField.inputType = 'uri';
          nextField.allowMultiple = false;
          nextField.datatype = 'uri';
          nextField.objectType = 'uri';
        } else {
          nextField.datatype = nextField.datatype || datatypeByInputType[nextField.inputType] || '';
        }
      }
    }
    if (key === 'linkedEnabled') {
      if (!value) return clearLinkedFieldSettings(nextField);
      const targetEntityType = nextField.targetEntityType || linkableEntityTypes[0] || '';
      return {
        ...nextField,
        ...linkedFieldDefaults(structure, nextField, targetEntityType),
        inputType: nextField.kind === 'array' ? 'uri-list' : 'uri',
        datatype: 'uri',
        objectType: 'uri',
      };
    }
    if (key === 'targetEntityType') {
      return {
        ...nextField,
        ...linkedFieldDefaults(structure, { ...nextField, targetLabelField: '' }, value),
      };
    }
    if (key === 'inputType' && Object.hasOwn(datatypeByInputType, value)) {
      nextField.datatype = datatypeByInputType[value];
      if (value === 'uri' || value === 'uri-list') {
        nextField.objectType = 'uri';
      } else if (!isLinkedField(nextField)) {
        delete nextField.objectType;
      }
    }
    return nextField;
  };

  const updateSubfield = (rowIndex, subfieldIndex, key, value) => {
    onChange(rows.map((row, i) => {
      if (i !== rowIndex) return row;
      return {
        ...row,
        subfields: (row.subfields || []).map((subfield, j) => (
          j === subfieldIndex
            ? updateNestedFieldForKind(subfield, key, value, (row.subfields || []).filter((_, candidateIndex) => candidateIndex !== subfieldIndex), row.name)
            : subfield
        )),
      };
    }));
  };

  const addSubfield = (rowIndex) => {
    onChange(rows.map((row, i) => (
      i === rowIndex ? { ...row, subfields: [...(row.subfields || []), newSubfieldFor(row)] } : row
    )));
  };

  const updateOption = (rowIndex, optionIndex, key, value) => {
    onChange(rows.map((row, i) => {
      if (i !== rowIndex) return row;
      return {
        ...row,
        options: (row.options || []).map((option, j) => {
          if (j !== optionIndex) return option;
          const nextOption = {
            ...option,
            [key]: value,
            ...(key === 'label' && (option.isNew || row.isNew)
              ? (() => {
                  const nextName = uniqueName(
                    nameFromLabel(value, 'option'),
                    new Set((row.options || []).filter((_, candidateIndex) => candidateIndex !== optionIndex).map(candidate => candidate.name))
                  );
                  return {
                    name: nextName,
                    value: classForOption(nextName),
                  };
                })()
              : {}),
          };
          if (key === 'linkedEnabled') {
            if (!value) return clearLinkedFieldSettings(nextOption);
            const targetEntityType = nextOption.targetEntityType || linkableEntityTypes[0] || '';
            return {
              ...nextOption,
              ...linkedFieldDefaults(structure, { ...nextOption, kind: 'scalar' }, targetEntityType),
            };
          }
          if (key === 'targetEntityType') {
            return {
              ...nextOption,
              ...linkedFieldDefaults(structure, { ...nextOption, kind: 'scalar', targetLabelField: '' }, value),
            };
          }
          return nextOption;
        }),
      };
    }));
  };

  const updateOptionSubfield = (rowIndex, optionIndex, subfieldIndex, key, value) => {
    onChange(rows.map((row, i) => {
      if (i !== rowIndex) return row;
      return {
        ...row,
        options: (row.options || []).map((option, j) => {
          if (j !== optionIndex) return option;
          return {
            ...option,
            subfields: (option.subfields || []).map((subfield, k) => (
              k === subfieldIndex
                ? updateNestedFieldForKind(subfield, key, value, (option.subfields || []).filter((_, candidateIndex) => candidateIndex !== subfieldIndex), option.name)
                : subfield
            )),
          };
        }),
      };
    }));
  };

  const addOption = (rowIndex) => {
    onChange(rows.map((row, i) => (
      i === rowIndex ? { ...row, options: [...(row.options || []), newOptionFor(row)] } : row
    )));
  };

  const removeOption = (rowIndex, optionIndex) => {
    onChange(rows.map((row, i) => (
      i === rowIndex ? { ...row, options: (row.options || []).filter((_, j) => j !== optionIndex) } : row
    )));
  };

  const addOptionSubfield = (rowIndex, optionIndex) => {
    onChange(rows.map((row, i) => {
      if (i !== rowIndex) return row;
      return {
        ...row,
        options: (row.options || []).map((option, j) => (
          j === optionIndex ? { ...option, subfields: [...(option.subfields || []), newSubfieldFor(option)] } : option
        )),
      };
    }));
  };

  const removeOptionSubfield = (rowIndex, optionIndex, subfieldIndex) => {
    onChange(rows.map((row, i) => {
      if (i !== rowIndex) return row;
      return {
        ...row,
        options: (row.options || []).map((option, j) => (
          j === optionIndex ? { ...option, subfields: (option.subfields || []).filter((_, k) => k !== subfieldIndex) } : option
        )),
      };
    }));
  };

  const removeSubfield = (rowIndex, subfieldIndex) => {
    onChange(rows.map((row, i) => (
      i === rowIndex ? { ...row, subfields: (row.subfields || []).filter((_, j) => j !== subfieldIndex) } : row
    )));
  };

  const dropRow = (index) => {
    if (dragIndex === null) return;
    onChange(moveRow(rows, dragIndex, index));
    setDragIndex(null);
  };

  const linkedSettingsFor = (field, onFieldChange, title) => (
    <div className="rdf-nested-link-settings">
      <div className="rdf-subfields-title">
        <label className="rdf-link-toggle">
          <input
            type="checkbox"
            checked={isLinkedField(field)}
            onChange={(e) => onFieldChange('linkedEnabled', e.target.checked)}
          />
          <span>{title}</span>
        </label>
      </div>
      {isLinkedField(field) && <div className="rdf-link-grid">
        <div className="rdf-link-control">
          <HelpHeader help={columnHelp.linkedClass}>Class</HelpHeader>
          <select value={field.targetEntityType || ''} onChange={(e) => onFieldChange('targetEntityType', e.target.value)}>
            <option value="">-- select --</option>
            {linkableEntityTypes.map(entityType => (
              <option key={entityType} value={entityType}>{entityType}</option>
            ))}
          </select>
        </div>
        <div className="rdf-link-control">
          <HelpHeader help={columnHelp.linkedLabel}>Linked field</HelpHeader>
          <select value={field.targetLabelField || ''} onChange={(e) => onFieldChange('targetLabelField', e.target.value)}>
            <option value="">-- select --</option>
            {Object.entries(structure?.[field.targetEntityType]?.fields || {})
              .filter(([, field]) => !field.generated && !field.metadataOnly)
              .map(([fieldName, field]) => (
                <option key={fieldName} value={fieldName}>{field.label || labelForFieldName(fieldName)}</option>
              ))}
          </select>
        </div>
      </div>}
    </div>
  );

  const renderSubfieldEditor = (subfield, subfieldIndex, onFieldChange, onRemove, keyPrefix) => (
    <div key={`${keyPrefix}-${subfield.isNew ? 'new-subfield' : subfield.name}-${subfieldIndex}`} className="rdf-subfield-item">
      <div className="rdf-subfield-row">
        <input value={subfield.label || ''} onChange={(e) => onFieldChange('label', e.target.value)} />
        <select value={subfield.kind || 'scalar'} onChange={(e) => onFieldChange('kind', e.target.value)}>
          <option value="scalar">Single value</option>
          <option value="array">Multiple values</option>
        </select>
        <input value={subfield.predicate || ''} onChange={(e) => onFieldChange('predicate', e.target.value)} />
        <DatatypeInput
          value={datatypeDisplayValue(subfield)}
          onChange={(value) => onFieldChange('datatype', value)}
          disabled={datatypeIsLocked(subfield)}
          placeholder="xsd:decimal"
        />
        <select
          value={subfield.inputType || (subfield.kind === 'array' ? 'text-list' : 'text')}
          onChange={(e) => onFieldChange('inputType', e.target.value)}
          disabled={isLinkedField(subfield)}
        >
          {subfield.kind === 'array' ? (
            <>
              <option value="text-list">Text list</option>
              <option value="uri-list">URI list</option>
            </>
          ) : (
            <>
              <option value="text">Text</option>
              <option value="uri">URI</option>
              <option value="textarea">Textarea</option>
              <option value="text-list">Text list</option>
              <option value="uri-list">URI list</option>
              <option value="date">Date</option>
              <option value="number">Number</option>
              <option value="datetime">Date/time</option>
            </>
          )}
        </select>
        <input type="checkbox" checked={!!subfield.encrypted} onChange={(e) => onFieldChange('encrypted', e.target.checked)} />
        <button type="button" className="delete-btn" onClick={onRemove}>Remove</button>
      </div>
      {(subfield.kind === 'scalar' || subfield.kind === 'array') && linkedSettingsFor(
        subfield,
        onFieldChange,
        `Link ${subfield.label || subfield.name} to a class`
      )}
    </div>
  );

  return (
    <div className="rdf-editor-section">
      <div className="rdf-editor-heading">
        <h3>{title}</h3>
      </div>
      <div className="rdf-combined-grid">
        <HelpHeader help={columnHelp.order}>Order</HelpHeader>
        <HelpHeader help={columnHelp.label}>Label</HelpHeader>
        <HelpHeader help={columnHelp.valueMode}>Value Mode</HelpHeader>
        <HelpHeader help={columnHelp.predicate}>Predicate</HelpHeader>
        <HelpHeader help={columnHelp.datatype}>Datatype</HelpHeader>
        <HelpHeader help={columnHelp.input}>Input</HelpHeader>
        <HelpHeader help={columnHelp.required}>Required</HelpHeader>
        <HelpHeader help={columnHelp.encrypted}>Encrypt</HelpHeader>
        <ActionHeaderSpacer />
        {rows.map((row, index) => {
          const groupSectionKey = sectionKey(row, index, 'group');
          const conditionalSectionKey = sectionKey(row, index, 'conditional');
          const isGroupCollapsed = !!collapsedSections[groupSectionKey];
          const isConditionalCollapsed = !!collapsedSections[conditionalSectionKey];

          return (
            <div
              key={`${row.isNew ? 'new-field' : row.name}-${index}`}
              className="rdf-combined-row"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropRow(index)}
            >
            <button
              type="button"
              className="drag-handle"
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
              aria-label="Drag to reorder"
              title="Drag to reorder"
            >
              <span className="drag-icon" aria-hidden="true">⋮⋮</span>
            </button>
            <input value={row.label || ''} onChange={(e) => updateRow(index, 'label', e.target.value)} />
            <select value={row.kind || 'scalar'} onChange={(e) => updateRow(index, 'kind', e.target.value)}>
              <option value="scalar">Single value</option>
              <option value="array">Multiple values</option>
              <option value="group">Subfields</option>
              <option value="conditional">Conditional subfields</option>
            </select>
            <input
              value={row.predicate || ''}
              onChange={(e) => updateRow(index, 'predicate', e.target.value)}
            />
            <DatatypeInput
              value={datatypeDisplayValue(row)}
              onChange={(value) => updateRow(index, 'datatype', value)}
              disabled={datatypeIsLocked(row)}
            />
            <select
              value={row.inputType || (row.kind === 'array' ? 'text-list' : 'text')}
              onChange={(e) => updateRow(index, 'inputType', e.target.value)}
              disabled={isLinkedField(row) || row.kind === 'group' || row.kind === 'conditional'}
            >
              {row.kind === 'array' ? (
                <>
                  <option value="text-list">Text list</option>
                  <option value="uri-list">URI list</option>
                </>
              ) : row.kind === 'conditional' ? (
                <option value="select">Subfields</option>
              ) : row.kind === 'group' ? (
                <option value="text">Subfields</option>
              ) : (
                <>
                  <option value="text">Text</option>
                  <option value="uri">URI</option>
                  <option value="textarea">Textarea</option>
                  <option value="date">Date</option>
                  <option value="number">Number</option>
                  <option value="datetime">Date/time</option>
                </>
              )}
            </select>
            <input type="checkbox" checked={!!row.required} onChange={(e) => updateRow(index, 'required', e.target.checked)} />
            <input type="checkbox" checked={!!row.encrypted} onChange={(e) => updateRow(index, 'encrypted', e.target.checked)} />
            <button type="button" className="delete-btn" onClick={() => onRemove(index)}>Remove</button>
            {(row.kind === 'scalar' || row.kind === 'array') && (
              <div className="rdf-subfields rdf-link-settings">
                <div className="rdf-subfields-title">
                  <label className="rdf-link-toggle">
                    <input
                      type="checkbox"
                      checked={isLinkedField(row)}
                      onChange={(e) => updateRow(index, 'linkedEnabled', e.target.checked)}
                    />
                    <span>Link {row.label || row.name} to a class</span>
                  </label>
                </div>
                {isLinkedField(row) && <div className="rdf-link-grid">
                  <div className="rdf-link-control">
                    <HelpHeader help={columnHelp.linkedClass}>Class</HelpHeader>
                    <select value={row.targetEntityType || ''} onChange={(e) => updateRow(index, 'targetEntityType', e.target.value)}>
                      <option value="">-- select --</option>
                      {linkableEntityTypes.map(entityType => (
                        <option key={entityType} value={entityType}>{entityType}</option>
                      ))}
                    </select>
                  </div>
                  <div className="rdf-link-control">
                    <HelpHeader help={columnHelp.linkedLabel}>Linked field</HelpHeader>
                    <select value={row.targetLabelField || ''} onChange={(e) => updateRow(index, 'targetLabelField', e.target.value)}>
                      <option value="">-- select --</option>
                      {Object.entries(structure?.[row.targetEntityType]?.fields || {})
                        .filter(([, field]) => !field.generated && !field.metadataOnly)
                        .map(([fieldName, field]) => (
                          <option key={fieldName} value={fieldName}>{field.label || labelForFieldName(fieldName)}</option>
                        ))}
                    </select>
                  </div>
                </div>}
              </div>
            )}
            {row.kind === 'group' && (
              <div className="rdf-subfields">
                <div className="rdf-nested-link-settings">
                  <div className="rdf-subfields-title">
                    <label className="rdf-link-toggle">
                      <input
                        type="checkbox"
                        checked={isLinkedGroup(row)}
                        onChange={(e) => updateRow(index, 'linkedEnabled', e.target.checked)}
                      />
                      <span>Link {row.label || row.name} to a class</span>
                    </label>
                  </div>
                  {isLinkedGroup(row) && (
                    <div className="rdf-link-grid">
                      <div className="rdf-link-control">
                        <HelpHeader help={columnHelp.linkedClass}>Class</HelpHeader>
                        <select value={row.targetEntityType || ''} onChange={(e) => updateRow(index, 'targetEntityType', e.target.value)}>
                          <option value="">-- select --</option>
                          {linkableEntityTypes.map(entityType => (
                            <option key={entityType} value={entityType}>{entityType}</option>
                          ))}
                        </select>
                      </div>
                      <div className="rdf-link-control">
                        <HelpHeader help={columnHelp.linkedLabel}>Linked field</HelpHeader>
                        <select value={row.targetLabelField || ''} onChange={(e) => updateRow(index, 'targetLabelField', e.target.value)}>
                          <option value="">-- select --</option>
                          {linkTargetEntriesForEntity(structure, row.targetEntityType).map(target => (
                            <option key={target.name} value={target.name}>{target.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
                <div className="rdf-subfields-title">
                  <span>Subfields for {row.label || row.name}</span>
                  <button
                    type="button"
                    className="collapse-btn"
                    onClick={() => toggleSection(groupSectionKey)}
                    aria-expanded={!isGroupCollapsed}
                  >
                    {isGroupCollapsed ? 'Show' : 'Hide'}
                  </button>
                </div>
                {!isGroupCollapsed && (
                  <>
                    <div className="rdf-subfield-heading">
                      <HelpHeader help={columnHelp.label}>Label</HelpHeader>
                      <HelpHeader help={columnHelp.valueMode}>Value Mode</HelpHeader>
                      <HelpHeader help={columnHelp.predicate}>Predicate</HelpHeader>
                      <HelpHeader help={columnHelp.datatype}>Datatype</HelpHeader>
                      <HelpHeader help={columnHelp.input}>Input</HelpHeader>
                      <HelpHeader help={columnHelp.encrypted}>Encrypt</HelpHeader>
                      <ActionHeaderSpacer />
                    </div>
                    {(row.subfields || []).map((subfield, subfieldIndex) => renderSubfieldEditor(
                      subfield,
                      subfieldIndex,
                      (key, value) => updateSubfield(index, subfieldIndex, key, value),
                      () => removeSubfield(index, subfieldIndex),
                      'group-subfield'
                    ))}
                    <button type="button" className="secondary-btn" onClick={() => addSubfield(index)}>+ Add Subfield</button>
                  </>
                )}
              </div>
            )}
            {row.kind === 'conditional' && (
              <div className="rdf-subfields rdf-conditional-options">
                <div className="rdf-subfields-title">
                  <span>Options for {row.label || row.name}</span>
                  <button
                    type="button"
                    className="collapse-btn"
                    onClick={() => toggleSection(conditionalSectionKey)}
                    aria-expanded={!isConditionalCollapsed}
                  >
                    {isConditionalCollapsed ? 'Show' : 'Hide'}
                  </button>
                </div>
                {!isConditionalCollapsed && (
                  <>
                    {(row.options || []).map((option, optionIndex) => (
                      <div key={`${option.isNew || row.isNew ? 'new-option' : option.name}-${optionIndex}`} className="rdf-option-block">
                        <div className="rdf-option-heading">
                          <HelpHeader help={columnHelp.label}>Label</HelpHeader>
                          <HelpHeader help={columnHelp.optionValue}>URI Value</HelpHeader>
                          <ActionHeaderSpacer />
                        </div>
                        <div className="rdf-option-row">
                          <input value={option.label || ''} onChange={(e) => updateOption(index, optionIndex, 'label', e.target.value)} />
                          <input value={option.value || ''} onChange={(e) => updateOption(index, optionIndex, 'value', e.target.value)} />
                          <button type="button" className="delete-btn" onClick={() => removeOption(index, optionIndex)}>Remove</button>
                        </div>
                        {linkedSettingsFor(
                          option,
                          (key, value) => updateOption(index, optionIndex, key, value),
                          `Link ${option.label || option.name} option to a class`
                        )}

                        <div className="rdf-subfield-heading">
                          <HelpHeader help={columnHelp.label}>Label</HelpHeader>
                          <HelpHeader help={columnHelp.valueMode}>Value Mode</HelpHeader>
                          <HelpHeader help={columnHelp.predicate}>Predicate</HelpHeader>
                          <HelpHeader help={columnHelp.datatype}>Datatype</HelpHeader>
                          <HelpHeader help={columnHelp.input}>Input</HelpHeader>
                          <HelpHeader help={columnHelp.encrypted}>Encrypt</HelpHeader>
                          <ActionHeaderSpacer />
                        </div>
                        {(option.subfields || []).map((subfield, subfieldIndex) => renderSubfieldEditor(
                          subfield,
                          subfieldIndex,
                          (key, value) => updateOptionSubfield(index, optionIndex, subfieldIndex, key, value),
                          () => removeOptionSubfield(index, optionIndex, subfieldIndex),
                          'option-subfield'
                        ))}
                        <button type="button" className="secondary-btn" onClick={() => addOptionSubfield(index, optionIndex)}>+ Add Subfield</button>
                      </div>
                    ))}
                    <button type="button" className="secondary-btn" onClick={() => addOption(index)}>+ Add Option</button>
                  </>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
      <button type="button" onClick={onAdd} className="secondary-btn rdf-add-field-button">+ Add Field</button>
    </div>
  );
}

function ClassPropertiesPane({ structure, selectedEntityType, entityTypes, onChange }) {
  if (!selectedEntityType) {
    return (
      <div className="rdf-empty-field-pane">
        <h3>No class selected</h3>
        <p>Select or add a class to configure its properties.</p>
      </div>
    );
  }

  const otherEntityTypes = entityTypes.filter(entityType => entityType !== selectedEntityType);

  const updateClassProperty = (
    targetEntityType,
    checked,
    direction = equivalentClassDirectionFor(structure, selectedEntityType, targetEntityType),
    predicate = classPropertyForPair(structure, selectedEntityType, targetEntityType).predicate
  ) => {
    const nextEquivalentClasses = withoutEquivalentClassPair(
      structure,
      structure.equivalentClasses || {},
      selectedEntityType,
      targetEntityType
    );
    const nextClassProperties = withoutClassPropertyPair(
      structure,
      structure.classProperties || [],
      selectedEntityType,
      targetEntityType
    );
    if (checked) {
      const sourceEntityType = direction === "object" ? targetEntityType : selectedEntityType;
      const objectEntityType = direction === "object" ? selectedEntityType : targetEntityType;
      nextClassProperties.push({
        subject: sourceEntityType,
        predicate: predicate ?? "owl:equivalentClass",
        object: equivalentClassPropertyValue(structure, objectEntityType),
      });
    }
    onChange({
      ...structure,
      equivalentClasses: nextEquivalentClasses,
      classProperties: nextClassProperties,
    });
  };

  return (
    <section className="rdf-properties-pane" role="tabpanel" aria-label="Properties">
      <div className="rdf-editor-heading">
        <h3>{titleForEntity(selectedEntityType)} Properties</h3>
      </div>
      <div className="rdf-class-property-list">
        {otherEntityTypes.map(entityType => {
          const property = classPropertyForPair(structure, selectedEntityType, entityType);
          const checked = property.checked;
          const direction = property.direction;
          return (
            <div key={entityType} className="rdf-class-property-row">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => updateClassProperty(entityType, e.target.checked, direction, property.predicate)}
                aria-label={`Toggle class property between ${selectedEntityType} and ${entityType}`}
              />
              <span className="rdf-class-property-main">
                <strong>{entityType}</strong>
                <span>{structure.classes?.[entityType]}</span>
              </span>
              <div className="rdf-class-property-predicate">
                <SuggestionInput
                  value={property.predicate}
                  onChange={(value) => updateClassProperty(entityType, checked, direction, value)}
                  disabled={!checked}
                  listId="rdf-class-property-options"
                  options={classPropertyOptions}
                  aria-label={`Property between ${selectedEntityType} and ${entityType}`}
                />
              </div>
              <div className={`rdf-property-direction-switch${!checked ? ' disabled' : ''}`} role="group" aria-label={`Direction for ${selectedEntityType} and ${entityType}`}>
                <button
                  type="button"
                  className={direction === 'subject' ? 'active' : ''}
                  onClick={() => updateClassProperty(entityType, checked, 'subject', property.predicate)}
                  disabled={!checked}
                >
                  Subject
                </button>
                <button
                  type="button"
                  className={direction === 'object' ? 'active' : ''}
                  onClick={() => updateClassProperty(entityType, checked, 'object', property.predicate)}
                  disabled={!checked}
                >
                  Object
                </button>
              </div>
            </div>
          );
        })}
        {otherEntityTypes.length === 0 && (
          <div className="rdf-empty-field-pane">
            <h3>No other classes</h3>
            <p>Add another class before creating class properties.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function RdfStructureEditor({ activeOrganisationCanWrite, activeOrganisationId, activeOrganisationIsUnscoped }) {
  const { data, loading, error, refetch } = useQuery(GET_RDF_STRUCTURE, {
    variables: { organisationId: activeOrganisationId },
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const [updateStructure] = useMutation(UPDATE_RDF_STRUCTURE, {
    refetchQueries: [{ query: GET_RDF_STRUCTURE, variables: { organisationId: activeOrganisationId } }],
  });
  const [savePreset, { loading: savingPreset }] = useMutation(SAVE_RDF_STRUCTURE_PRESET, {
    refetchQueries: [{ query: GET_RDF_STRUCTURE, variables: { organisationId: activeOrganisationId } }],
  });
  const [loadPreset, { loading: loadingPreset }] = useMutation(LOAD_RDF_STRUCTURE_PRESET, {
    refetchQueries: [{ query: GET_RDF_STRUCTURE, variables: { organisationId: activeOrganisationId } }],
  });
  const fileInputRef = useRef(null);
  const [rawJson, setRawJson] = useState('');
  const [message, setMessage] = useState('');
  const [editableFieldNames, setEditableFieldNames] = useState({});
  const [editableClassNames, setEditableClassNames] = useState([]);
  const [selectedEntityType, setSelectedEntityType] = useState('');
  const [activeRightPane, setActiveRightPane] = useState('fields');

  const sourceJson = rawJson || data?.rdfStructure?.json || '';
  const { structure, parseError } = useMemo(() => {
    if (!sourceJson) return { structure: null, parseError: null };
    try {
      return { structure: JSON.parse(sourceJson), parseError: null };
    } catch (err) {
      return { structure: null, parseError: err.message };
    }
  }, [sourceJson]);
  const entityTypes = useMemo(
    () => Object.keys({ ...(structure?.classes || {}), ...(structure?.uriTemplates || {}) }),
    [structure]
  );
  const rowsByEntity = useMemo(
    () => Object.fromEntries(entityTypes.map(entityType => [
      entityType,
      combinedRowsFromEntity(structure?.[entityType], editableFieldNames[entityType] || []),
    ])),
    [entityTypes, structure, editableFieldNames]
  );
  const activeEntityType = entityTypes.includes(selectedEntityType)
    ? selectedEntityType
    : entityTypes[0] || '';
  const selectedRows = rowsByEntity[activeEntityType] || [];
  const presets = data?.rdfStructurePresets || [];
  const canWriteStructure = !!activeOrganisationCanWrite;

  const setEntityRows = (entityType, rows) => {
    if (!canWriteStructure) return;
    const entity = structure[entityType] || {};
    setEditableFieldNames((current) => ({
      ...current,
      [entityType]: rows.filter(row => row.isNew && row.name).map(row => row.name),
    }));
    const generatedAndMetadata = Object.fromEntries(
      rowsFromFields(entity.fields)
        .filter(row => row.generated || row.metadataOnly)
        .map((row) => {
          return [row.name, omitKeys(row, ['name', 'kind', 'isNew'])];
        })
    );
    const nextStructure = {
      ...structure,
      [entityType]: {
        ...omitKeys(entity, ['arrays', 'nested', 'fieldOrder', 'selectedItems']),
        fields: {
          ...generatedAndMetadata,
          ...fieldsFromRows(rows),
        },
      },
    };
    setRawJson(JSON.stringify(nextStructure, null, 2));
  };

  const entityWithTemplateId = (entityType, entity, template, idPredicateEntityType = entityType) => {
    const idField = uriTemplateToken(template);
    if (!idField) return entity;
    const previousIdField = entity?.idField;
    const fields = { ...(entity?.fields || {}) };
    if (previousIdField && previousIdField !== idField && fields[previousIdField]?.generated) {
      delete fields[previousIdField];
    }
    const existingIdField = fields[idField] || {};
    const generatedIdField = generatedIdFieldFor(idPredicateEntityType, idField);
    const shouldRefreshGeneratedPredicate = !existingIdField.predicate || existingIdField.generated;
    return {
      ...(entity || {}),
      idField,
      fields: {
        ...fields,
        [idField]: {
          ...generatedIdField,
          ...existingIdField,
          ...(shouldRefreshGeneratedPredicate ? { predicate: generatedIdField.predicate } : {}),
          generated: true,
        },
      },
    };
  };

  const setClasses = ({ classes, uriTemplates, renamedClass, templateChanged }) => {
    if (!canWriteStructure) return;
    const renamedEntity = renamedClass && structure[renamedClass.from]
      ? {
          [renamedClass.to]: entityWithTemplateId(renamedClass.to, structure[renamedClass.from], uriTemplates[renamedClass.to]),
        }
      : {};
    const withoutRenamedEntity = renamedClass
      ? omitKeys(structure, [renamedClass.from])
      : structure;
    const nextStructure = {
      ...withoutRenamedEntity,
      ...renamedEntity,
      classes,
      uriTemplates,
    };
    if (templateChanged && !renamedClass) {
      nextStructure[templateChanged.entityType] = entityWithTemplateId(
        templateChanged.entityType,
        structure[templateChanged.entityType],
        templateChanged.template,
        templateChanged.entityName || templateChanged.entityType
      );
    }
    if (renamedClass) {
      setSelectedEntityType(current => (current === renamedClass.from ? renamedClass.to : current));
      setEditableClassNames(current => current.map(name => (name === renamedClass.from ? renamedClass.to : name)));
      setEditableFieldNames(current => {
        const next = { ...current, [renamedClass.to]: current[renamedClass.from] || [] };
        delete next[renamedClass.from];
        return next;
      });
    }
    setRawJson(JSON.stringify(nextStructure, null, 2));
  };

  const addClass = () => {
    if (!canWriteStructure) return;
    const name = nextClassName(structure);
    const nextStructure = {
      ...structure,
      classes: {
        ...(structure.classes || {}),
        [name]: classForEntity(name),
      },
      uriTemplates: {
        ...(structure.uriTemplates || {}),
        [name]: uriTemplateForEntity(name),
      },
      [name]: {
        idField: 'id',
        fields: {
          id: generatedIdFieldFor(name, 'id'),
        },
      },
    };
    setEditableClassNames(current => [...current, name]);
    setEditableFieldNames(current => ({ ...current, [name]: [] }));
    setSelectedEntityType(name);
    setRawJson(JSON.stringify(nextStructure, null, 2));
  };

  const deleteClass = (entityType) => {
    if (!canWriteStructure) return;
    if (protectedEntityTypes.has(entityType)) return;
    const nextClasses = omitKeys(structure.classes || {}, [entityType]);
    const nextUriTemplates = omitKeys(structure.uriTemplates || {}, [entityType]);
    const nextEquivalentClasses = removeEquivalentClassReferences(structure, structure.equivalentClasses || {}, entityType);
    const nextClassProperties = removeClassPropertyReferences(structure, structure.classProperties || [], entityType);
    const nextStructure = {
      ...omitKeys(structure, [entityType]),
      classes: nextClasses,
      uriTemplates: nextUriTemplates,
      equivalentClasses: nextEquivalentClasses,
      classProperties: nextClassProperties,
    };
    const nextEntityTypes = Object.keys({ ...nextClasses, ...nextUriTemplates });
    setSelectedEntityType(current => (
      current === entityType ? nextEntityTypes[0] || '' : current
    ));
    setEditableClassNames(current => current.filter(name => name !== entityType));
    setEditableFieldNames(current => omitKeys(current, [entityType]));
    setRawJson(JSON.stringify(nextStructure, null, 2));
  };

  const setClassProperties = (nextStructure) => {
    if (!canWriteStructure) return;
    setRawJson(JSON.stringify(nextStructure, null, 2));
  };

  const buildStructure = () => {
    return applyDefaultDatatypesToStructure(JSON.parse(sourceJson));
  };

  const handleSave = async () => {
    try {
      if (!canWriteStructure) return;
      setMessage('');
      const nextStructure = buildStructure();
      await updateStructure({ variables: { json: JSON.stringify(nextStructure, null, 2), organisationId: activeOrganisationId } });
      await refetch({ organisationId: activeOrganisationId });
      setRawJson('');
      setEditableFieldNames({});
      setEditableClassNames([]);
      setMessage('RDF structure saved. Open pages will use the new structure after refetching.');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleSavePreset = async () => {
    if (!canWriteStructure) return;
    const name = window.prompt('Preset name');
    if (!name) return;
    try {
      setMessage('');
      const nextStructure = buildStructure();
      await savePreset({
        variables: {
          name,
          json: JSON.stringify(nextStructure, null, 2),
          organisationId: activeOrganisationId,
        },
      });
      setMessage('RDF preset saved.');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleLoadPreset = async (preset) => {
    if (!canWriteStructure) return;
    const confirmed = window.confirm(`Load "${preset.name}"?\n\nThis replaces the current RDF structure.`);
    if (!confirmed) return;
    try {
      setMessage('');
      await loadPreset({ variables: { id: preset.id, organisationId: activeOrganisationId } });
      await refetch({ organisationId: activeOrganisationId });
      setRawJson('');
      setEditableFieldNames({});
      setEditableClassNames([]);
      setMessage('RDF preset loaded.');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleDownloadCurrent = () => {
    if (!sourceJson) return;
    const formattedJson = JSON.stringify(JSON.parse(sourceJson), null, 2);
    downloadJsonFile('rdf-structure.json', formattedJson);
  };

  const handleDownloadPreset = (preset) => {
    downloadJsonFile(`${safeFilename(preset.name, 'rdf-preset')}.json`, preset.json);
  };

  const importStructureJson = async (json) => {
    const formattedJson = JSON.stringify(JSON.parse(json), null, 2);
    const importMode = window.confirm('Import this file as a preset?\n\nChoose Cancel to replace the current RDF structure instead.')
      ? 'preset'
      : 'current';
    if (importMode === 'preset') {
      const name = window.prompt('Preset name');
      if (!name) return;
      await savePreset({ variables: { name, json: formattedJson, organisationId: activeOrganisationId } });
      setMessage('RDF preset imported.');
      return;
    }
    const confirmed = window.confirm('Replace the current RDF structure with this file?');
    if (!confirmed) return;
    await updateStructure({ variables: { json: formattedJson, organisationId: activeOrganisationId } });
    await refetch({ organisationId: activeOrganisationId });
    setRawJson('');
    setEditableFieldNames({});
    setEditableClassNames([]);
    setMessage('RDF structure imported.');
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canWriteStructure) return;
    try {
      setMessage('');
      await importStructureJson(await file.text());
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) return <p>Loading RDF structure...</p>;
  if (error) return <div className="error-message">{error.message}</div>;

  return (
    <OrganisationGate>
    <div className="settings-page">
      <div className="rdf-structure-window">
        <div className="rdf-window-header">
          <h2>RDF Structure</h2>
          <div className="rdf-window-actions">
            {canWriteStructure && (
              <button type="button" onClick={handleSave} className="create-report-button" disabled={!!parseError}>
                Save RDF Structure
              </button>
            )}
            <button type="button" onClick={handleDownloadCurrent} className="create-report-button" disabled={!sourceJson || !!parseError}>
              Download Current Structure
            </button>
          </div>
          {message && <div className={message.startsWith('Error') ? 'error-message' : 'success-message'}>{message}</div>}
          {parseError && <div className="error-message">JSON error: {parseError}</div>}
          {!canWriteStructure && (
            <div className="success-message">Guests can view and download RDF structures and presets.</div>
          )}
        </div>

        <section className="rdf-preset-panel" aria-label="RDF structure presets">
          <div className="rdf-preset-heading">
            <h3>Presets</h3>
            {canWriteStructure && (
              <div className="rdf-preset-heading-actions">
                <button type="button" onClick={handleSavePreset} className="create-report-button" disabled={!!parseError || savingPreset}>
                  {savingPreset ? 'Saving Preset...' : 'Save as Preset'}
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="create-report-button">
                  Import File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="rdf-hidden-file-input"
                  onChange={handleImportFile}
                />
              </div>
            )}
          </div>
          {presets.length === 0 ? (
            <p>No presets saved yet.</p>
          ) : (
            <div className="rdf-preset-list">
              {presets.map(preset => (
                <div className="rdf-preset-row" key={preset.id}>
                  <div>
                    <strong>{preset.name}</strong>
                    <span>Updated {new Date(preset.updatedAt).toLocaleString()}</span>
                  </div>
                  <div className="rdf-preset-actions">
                    <button type="button" onClick={() => handleDownloadPreset(preset)}>
                      Download
                    </button>
                    {canWriteStructure && (
                      <button type="button" onClick={() => handleLoadPreset(preset)} disabled={loadingPreset}>
                        Load
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {structure ? (
          <>
          <datalist id="rdf-datatype-options">
            {datatypeOptions.map(datatype => (
              <option key={datatype} value={datatype} />
            ))}
          </datalist>
          <datalist id="rdf-class-property-options">
            {classPropertyOptions.map(property => (
              <option key={property} value={property} />
            ))}
          </datalist>

            <ClassSidebar
              classes={structure.classes}
              uriTemplates={structure.uriTemplates}
              editableClassNames={editableClassNames}
              selectedEntityType={activeEntityType}
              onSelect={setSelectedEntityType}
              onChange={setClasses}
              onAdd={addClass}
              onDelete={deleteClass}
            />

            <main className="rdf-field-pane">
              <div className="rdf-pane-switcher" role="tablist" aria-label="RDF structure section">
                <button
                  type="button"
                  className={activeRightPane === 'fields' ? 'active' : ''}
                  onClick={() => setActiveRightPane('fields')}
                  role="tab"
                  aria-selected={activeRightPane === 'fields'}
                >
                  Fields
                </button>
                <button
                  type="button"
                  className={activeRightPane === 'properties' ? 'active' : ''}
                  onClick={() => setActiveRightPane('properties')}
                  role="tab"
                  aria-selected={activeRightPane === 'properties'}
                >
                  Properties
                </button>
              </div>
              {activeRightPane === 'fields' ? (
                activeEntityType ? (
                <CombinedFieldTable
                  key={activeEntityType}
                  title={titleForEntity(activeEntityType)}
                  rows={selectedRows}
                  structure={structure}
                  selectedEntityType={activeEntityType}
                  onChange={(nextRows) => setEntityRows(activeEntityType, nextRows)}
                  onAdd={() => setEntityRows(activeEntityType, [...selectedRows, newFieldFor(selectedRows)])}
                  onRemove={(index) => setEntityRows(activeEntityType, selectedRows.filter((_, i) => i !== index))}
                />
                ) : (
                  <div className="rdf-empty-field-pane">
                    <h3>No class selected</h3>
                    <p>Add a class to start defining fields.</p>
                  </div>
                )
              ) : (
                <ClassPropertiesPane
                  structure={structure}
                  selectedEntityType={activeEntityType}
                  entityTypes={entityTypes}
                  onChange={setClassProperties}
                />
              )}
            </main>
          </>
        ) : (
          <div className="rdf-empty-field-pane">
            <h3>No structure loaded</h3>
            <p>Fix the JSON below to restore the visual editor.</p>
          </div>
        )}
      </div>

      <div className="rdf-editor-section">
        <h3>Advanced JSON</h3>
        <textarea
          value={sourceJson}
          onChange={(e) => {
            if (canWriteStructure) setRawJson(e.target.value);
          }}
          readOnly={!canWriteStructure}
          rows={16}
          spellCheck="false"
          className="rdf-json-editor"
        />
      </div>
      <button
        type="button"
        className="rdf-back-to-top-button"
        onClick={scrollToTop}
        aria-label="Back to top"
      >
        Top
      </button>
    </div>
    </OrganisationGate>
  );
}

export default function RdfStructure() {
  const { activeOrganisationCanWrite, activeOrganisationId, activeOrganisationIsUnscoped } = useOrganisationContext();
  const editorKey = activeOrganisationIsUnscoped ? 'unscoped' : activeOrganisationId || 'no-organisation';

  return (
    <RdfStructureEditor
      key={editorKey}
      activeOrganisationCanWrite={activeOrganisationCanWrite}
      activeOrganisationId={activeOrganisationId}
      activeOrganisationIsUnscoped={activeOrganisationIsUnscoped}
    />
  );
}
