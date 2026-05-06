import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, gql } from '@apollo/client';

const GET_RDF_STRUCTURE = gql`
  query GetRdfStructureEditor {
    rdfStructure {
      json
    }
  }
`;

const UPDATE_RDF_STRUCTURE = gql`
  mutation UpdateRdfStructure($json: String!) {
    updateRdfStructure(json: $json) {
      json
    }
  }
`;

const datatypeByInputType = {
  text: '',
  textarea: '',
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

const groupPropertyNames = new Set(['label', 'predicate', 'inputType', 'required', 'resourceMode', 'className', 'targetEntityType', 'targetField', 'previousPredicates']);

const columnHelp = {
  order: 'Drag this handle to change the order fields appear in forms and item displays.',
  name: 'Internal field key used by the app and RDF structure. New fields can be renamed until the RDF structure is saved.',
  label: 'Human-readable text shown in forms, item cards, and report displays.',
  valueMode: 'Controls whether the field stores one value, multiple values, a group of subfields, or option-specific subfields.',
  predicate: 'RDF predicate used when this value is written as a triple.',
  datatype: 'Optional RDF datatype for literal values, such as xsd:date or xsd:integer. You can choose a suggestion or type your own.',
  input: 'Form control type shown to users when entering this field.',
  required: 'Whether the field must be filled in before submitting.',
  actions: 'Row actions, such as removing this field.',
  subfieldName: 'Internal key for this subfield inside the grouped field.',
  optionName: 'Internal key for this selectable option.',
  optionValue: 'URI value written for this selected option in RDF.',
  linkedClass: 'Class that should be created or linked when this field is filled in.',
  linkedLabel: 'Field on the linked class that receives the entered label.',
  linkedDirection: 'Whether the triple points from this class to the linked class, or from the linked class back to this class.',
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
  return {
    ...row,
    inputType,
    ...(Object.hasOwn(datatypeByInputType, inputType) ? { datatype: datatypeByInputType[inputType] } : {}),
  };
}

function sortRowsByOrder(rows, fieldOrder = []) {
  if (!fieldOrder?.length) return rows;
  const orderIndex = new Map(fieldOrder.map((name, index) => [name, index]));
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aOrder = orderIndex.has(a.row.name) ? orderIndex.get(a.row.name) : Number.MAX_SAFE_INTEGER;
      const bOrder = orderIndex.has(b.row.name) ? orderIndex.get(b.row.name) : Number.MAX_SAFE_INTEGER;
      return aOrder === bOrder ? a.index - b.index : aOrder - bOrder;
    })
    .map(({ row }) => row);
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

function rowsFromFields(fields, editableFieldNames = [], fieldOrder = []) {
  const editableNames = new Set(editableFieldNames);
  return sortRowsByOrder(Object.entries(fields || {}).map(([name, field]) => ({
    name,
    kind: 'scalar',
    ...field,
    isNew: editableNames.has(name),
  })), fieldOrder);
}

function combinedRowsFromEntity(entity, editableFieldNames = []) {
  const editableNames = new Set(editableFieldNames);
  const scalarRows = Object.entries(entity?.fields || {})
    .filter(([, field]) => !field.generated && !field.metadataOnly)
    .map(([name, field]) => ({
      name,
      kind: field.options ? 'conditional' : field.createEntityFromInput || field.targetEntityType ? 'linked' : 'scalar',
      ...field,
      options: field.options
        ? Object.entries(field.options).map(([optionName, option]) => ({
            name: optionName,
            label: option.label || optionName,
            value: option.value || classForOption(optionName),
            subfields: Object.entries(option.fields || {})
              .map(([subfieldName, subfield]) => ({ name: subfieldName, kind: 'scalar', ...subfield })),
          }))
        : undefined,
      isNew: editableNames.has(name),
    }));
  const arrayRows = Object.entries(entity?.arrays || {})
    .map(([name, field]) => ({ name, kind: 'array', ...field, isNew: editableNames.has(name) }));
  const groupRows = Object.entries(entity?.nested || {})
    .map(([name, group]) => {
      const groupProps = Object.fromEntries(
        Object.entries(group || {}).filter(([key, value]) => groupPropertyNames.has(key) && value !== undefined)
      );
      return {
        name,
        kind: 'group',
        inputType: group?.inputType || 'location',
        predicate: group?.predicate || `sitrep:${name}`,
        resourceMode: group?.resourceMode || 'per-instance',
        ...groupProps,
        subfields: Object.entries(group || {})
          .filter(([, field]) => field && typeof field === 'object' && field.predicate)
          .map(([subfieldName, field]) => ({ name: subfieldName, kind: 'scalar', ...field })),
        isNew: editableNames.has(name),
      };
    });

  return sortRowsByOrder([...scalarRows, ...arrayRows, ...groupRows], entity?.fieldOrder);
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
      inputType: 'uri-list',
      createEntityFromInput: true,
      allowMultiple: true,
    };
  }

  return {
    objectType: 'uri',
    inputType: row.allowMultiple === false ? 'text' : 'uri-list',
    createEntityFromInput: true,
    allowMultiple: row.allowMultiple ?? true,
    targetEntityType,
    targetClass: structure?.classes?.[targetEntityType] || row.targetClass,
    targetTemplate: structure?.uriTemplates?.[targetEntityType] || row.targetTemplate,
    targetLabelField: row.targetLabelField || labelFieldForEntity(structure, targetEntityType),
  };
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
    datatype: '',
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
    datatype: '',
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

function omitKeys(value, keys) {
  const nextValue = { ...value };
  keys.forEach(key => {
    delete nextValue[key];
  });
  return nextValue;
}

function fieldsFromRows(rows) {
  return Object.fromEntries(
    rows
      .filter(row => (row.kind === 'scalar' || row.kind === 'linked' || row.kind === 'conditional') && row.name && row.predicate)
      .map((row) => {
        const field = omitKeys(row, ['name', 'kind', 'isNew', 'subfields', 'variable', 'options']);
        if (row.kind === 'linked') {
          field.objectType = 'uri';
          field.createEntityFromInput = true;
          field.allowMultiple = row.allowMultiple ?? true;
          field.inputType = field.allowMultiple ? 'uri-list' : 'text';
          field.targetLabelField = field.targetLabelField || 'name';
          if (!field.direction) delete field.direction;
          delete field.datatype;
        } else if (row.kind === 'conditional') {
          field.inputType = 'select';
          field.objectType = 'uri';
          field.options = Object.fromEntries(
            (row.options || [])
              .filter(option => option.name)
              .map(option => [
                option.name,
                {
                  label: option.label || option.name,
                  value: option.value || classForOption(option.name),
                  fields: Object.fromEntries(
                    (option.subfields || [])
                      .filter(subfield => subfield.name && subfield.predicate)
                      .map(subfield => [subfield.name, omitKeys(subfield, ['name', 'kind', 'isNew', 'variable'])])
                  ),
                },
              ])
          );
        }
        return [row.name, field];
      })
  );
}

function arraysFromRows(rows) {
  return Object.fromEntries(
    rows
      .filter(row => row.kind === 'array' && row.name && row.predicate)
      .map((row) => {
        const field = omitKeys(row, ['name', 'kind', 'isNew', 'subfields', 'datatype', 'variable']);
        return [row.name, { ...field, inputType: field.inputType || 'text-list' }];
      })
  );
}

function nestedFromRows(rows) {
  return Object.fromEntries(
    rows
      .filter(row => row.kind === 'group' && row.name)
      .map((row) => {
        const group = omitKeys(row, ['name', 'kind', 'isNew', 'subfields', 'datatype', 'variable']);
        return [
          row.name,
          {
            ...group,
            inputType: group.inputType || 'location',
            ...Object.fromEntries(
              (row.subfields || [])
                .filter(subfield => subfield.name && subfield.predicate)
                .map((subfield) => {
                  return [subfield.name, omitKeys(subfield, ['name', 'kind', 'isNew', 'variable'])];
                })
            ),
          },
        ];
      })
  );
}

function DatatypeInput({ value, disabled, onChange, placeholder = 'xsd:date' }) {
  return (
    <input
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      list="rdf-datatype-options"
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
        <button type="button" onClick={onAdd} className="secondary-btn">+ Add Field</button>
      </div>
      <div className="rdf-field-grid">
        <HelpHeader help={columnHelp.order}>Order</HelpHeader>
        <HelpHeader help={columnHelp.name}>Name</HelpHeader>
        <HelpHeader help={columnHelp.label}>Label</HelpHeader>
        <HelpHeader help={columnHelp.predicate}>Predicate</HelpHeader>
        <HelpHeader help={columnHelp.datatype}>Datatype</HelpHeader>
        <HelpHeader help={columnHelp.input}>Input</HelpHeader>
        <HelpHeader help={columnHelp.required}>Required</HelpHeader>
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
              <option value="textarea">Textarea</option>
              <option value="date">Date</option>
              <option value="number">Number</option>
              <option value="datetime">Date/time</option>
            </select>
            <input type="checkbox" checked={!!row.required} onChange={(e) => updateRow(index, 'required', e.target.checked)} />
            <button type="button" className="delete-btn" onClick={() => onRemove(index)}>Remove</button>
          </div>
        ))}
      </div>
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
                <button
                  type="button"
                  className="delete-btn rdf-class-delete"
                  onClick={() => onDelete(name)}
                  title={`Delete ${name}`}
                >
                  Delete
                </button>
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
          nextRow.inputType = 'text-list';
          nextRow.predicate = nextRow.predicate || `sitrep:${nextRow.name}`;
          delete nextRow.subfields;
          delete nextRow.variable;
          delete nextRow.targetEntityType;
          delete nextRow.targetClass;
          delete nextRow.targetTemplate;
          delete nextRow.targetLabelField;
          delete nextRow.createEntityFromInput;
          delete nextRow.objectType;
          delete nextRow.direction;
          delete nextRow.allowMultiple;
        } else if (value === 'group') {
          nextRow.inputType = nextRow.inputType === 'text-list' || nextRow.inputType === 'location'
            ? 'text'
            : (nextRow.inputType || 'text');
          nextRow.predicate = nextRow.predicate || `sitrep:${nextRow.name}`;
          nextRow.resourceMode = nextRow.resourceMode || 'per-instance';
          nextRow.subfields = nextRow.subfields?.length ? nextRow.subfields : defaultSubfieldsFor(nextRow);
          delete nextRow.options;
          delete nextRow.targetEntityType;
          delete nextRow.targetClass;
          delete nextRow.targetTemplate;
          delete nextRow.targetLabelField;
          delete nextRow.createEntityFromInput;
          delete nextRow.objectType;
          delete nextRow.direction;
          delete nextRow.allowMultiple;
        } else if (value === 'conditional') {
          nextRow.inputType = 'select';
          nextRow.predicate = nextRow.predicate || `sitrep:${nextRow.name}`;
          nextRow.options = nextRow.options?.length ? nextRow.options : [newOptionFor(nextRow)];
          delete nextRow.subfields;
          delete nextRow.variable;
          delete nextRow.targetEntityType;
          delete nextRow.targetClass;
          delete nextRow.targetTemplate;
          delete nextRow.targetLabelField;
          delete nextRow.createEntityFromInput;
          delete nextRow.direction;
          delete nextRow.allowMultiple;
        } else if (value === 'linked') {
          const targetEntityType = nextRow.targetEntityType || linkableEntityTypes[0] || '';
          Object.assign(nextRow, linkedFieldDefaults(structure, nextRow, targetEntityType));
          nextRow.predicate = nextRow.predicate || `sitrep:${nextRow.name}`;
          delete nextRow.datatype;
          delete nextRow.subfields;
          delete nextRow.options;
          delete nextRow.variable;
        } else {
          nextRow.inputType = nextRow.inputType === 'text-list' || nextRow.inputType === 'location' ? 'text' : (nextRow.inputType || 'text');
          nextRow.predicate = nextRow.predicate || `sitrep:${nextRow.name}`;
          delete nextRow.variable;
          delete nextRow.subfields;
          delete nextRow.options;
          delete nextRow.targetEntityType;
          delete nextRow.targetClass;
          delete nextRow.targetTemplate;
          delete nextRow.targetLabelField;
          delete nextRow.createEntityFromInput;
          delete nextRow.objectType;
          delete nextRow.direction;
          delete nextRow.allowMultiple;
        }
      }
      if (key === 'targetEntityType') {
        return {
          ...nextRow,
          ...linkedFieldDefaults(structure, { ...nextRow, targetLabelField: '' }, value),
        };
      }
      if (key === 'allowMultiple') {
        return {
          ...nextRow,
          allowMultiple: value,
          inputType: value ? 'uri-list' : 'text',
        };
      }
      if (key === 'direction' && !value) {
        delete nextRow.direction;
      }
      if (key === 'inputType') {
        return applyInputTypeDefaults(nextRow, value);
      }
      return nextRow;
    }));
  };

  const updateSubfield = (rowIndex, subfieldIndex, key, value) => {
    onChange(rows.map((row, i) => {
      if (i !== rowIndex) return row;
      return {
        ...row,
        subfields: (row.subfields || []).map((subfield, j) => (
          j === subfieldIndex
            ? {
                ...subfield,
                [key]: value,
                ...(key === 'label' && (subfield.isNew || row.isNew)
                  ? (() => {
                      const nextName = uniqueName(
                        nameFromLabel(value, 'subfield'),
                        new Set((row.subfields || []).filter((_, candidateIndex) => candidateIndex !== subfieldIndex).map(candidate => candidate.name))
                      );
                      return {
                        name: nextName,
                        predicate: predicateForSubfield(row.name, nextName),
                      };
                    })()
                  : {}),
                ...(key === 'inputType' && Object.hasOwn(datatypeByInputType, value) ? { datatype: datatypeByInputType[value] } : {}),
              }
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
        options: (row.options || []).map((option, j) => (
          j === optionIndex
            ? {
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
              }
            : option
        )),
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
                ? {
                    ...subfield,
                    [key]: value,
                    ...(key === 'label' && (subfield.isNew || option.isNew || row.isNew)
                      ? (() => {
                          const nextName = uniqueName(
                            nameFromLabel(value, 'subfield'),
                            new Set((option.subfields || []).filter((_, candidateIndex) => candidateIndex !== subfieldIndex).map(candidate => candidate.name))
                          );
                          return {
                            name: nextName,
                            predicate: predicateForSubfield(option.name, nextName),
                          };
                        })()
                      : {}),
                    ...(key === 'inputType' && Object.hasOwn(datatypeByInputType, value) ? { datatype: datatypeByInputType[value] } : {}),
                  }
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

  return (
    <div className="rdf-editor-section">
      <div className="rdf-editor-heading">
        <h3>{title}</h3>
        <button type="button" onClick={onAdd} className="secondary-btn">+ Add Field</button>
      </div>
      <div className="rdf-combined-grid">
        <HelpHeader help={columnHelp.order}>Order</HelpHeader>
        <HelpHeader help={columnHelp.label}>Label</HelpHeader>
        <HelpHeader help={columnHelp.valueMode}>Value Mode</HelpHeader>
        <HelpHeader help={columnHelp.predicate}>Predicate</HelpHeader>
        <HelpHeader help={columnHelp.datatype}>Datatype</HelpHeader>
        <HelpHeader help={columnHelp.input}>Input</HelpHeader>
        <HelpHeader help={columnHelp.required}>Required</HelpHeader>
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
              <option value="linked">Linked class field</option>
              <option value="group">Subfields</option>
              <option value="conditional">Conditional subfields</option>
            </select>
            <input
              value={row.predicate || ''}
              onChange={(e) => updateRow(index, 'predicate', e.target.value)}
            />
            <DatatypeInput
              value={row.kind === 'group' || row.kind === 'array' || row.kind === 'conditional' || row.kind === 'linked' ? '' : (row.datatype || '')}
              onChange={(value) => updateRow(index, 'datatype', value)}
              disabled={row.kind === 'group' || row.kind === 'array' || row.kind === 'conditional' || row.kind === 'linked'}
            />
            <select
              value={row.inputType || (row.kind === 'array' ? 'text-list' : row.kind === 'linked' ? 'uri-list' : 'text')}
              onChange={(e) => updateRow(index, 'inputType', e.target.value)}
              disabled={row.kind === 'linked'}
            >
              {row.kind === 'array' ? (
                <>
                  <option value="text-list">Text list</option>
                  <option value="uri-list">URI list</option>
                </>
              ) : row.kind === 'linked' ? (
                <>
                  <option value="uri-list">URI list</option>
                  <option value="text">Text</option>
                </>
              ) : row.kind === 'conditional' ? (
                <option value="select">Select</option>
              ) : row.kind === 'group' ? (
                <>
                  <option value="location">Location</option>
                  <option value="text">Text</option>
                </>
              ) : (
                <>
                  <option value="text">Text</option>
                  <option value="textarea">Textarea</option>
                  <option value="date">Date</option>
                  <option value="number">Number</option>
                  <option value="datetime">Date/time</option>
                </>
              )}
            </select>
            <input type="checkbox" checked={!!row.required} onChange={(e) => updateRow(index, 'required', e.target.checked)} />
            <button type="button" className="delete-btn" onClick={() => onRemove(index)}>Remove</button>
            {row.kind === 'linked' && (
              <div className="rdf-subfields rdf-link-settings">
                <div className="rdf-subfields-title">
                  <span>Linked class for {row.label || row.name}</span>
                </div>
                <div className="rdf-link-grid">
                  <HelpHeader help={columnHelp.linkedClass}>Class</HelpHeader>
                  <HelpHeader help={columnHelp.linkedLabel}>Linked field</HelpHeader>
                  <HelpHeader help={columnHelp.linkedDirection}>Direction</HelpHeader>
                  <HelpHeader help={columnHelp.input}>Multiple</HelpHeader>
                  <select value={row.targetEntityType || ''} onChange={(e) => updateRow(index, 'targetEntityType', e.target.value)}>
                    <option value="">-- select --</option>
                    {linkableEntityTypes.map(entityType => (
                      <option key={entityType} value={entityType}>{entityType}</option>
                    ))}
                  </select>
                  <select value={row.targetLabelField || ''} onChange={(e) => updateRow(index, 'targetLabelField', e.target.value)}>
                    <option value="">-- select --</option>
                    {Object.entries(structure?.[row.targetEntityType]?.fields || {})
                      .filter(([, field]) => !field.generated && !field.metadataOnly)
                      .map(([fieldName, field]) => (
                        <option key={fieldName} value={fieldName}>{field.label || labelForFieldName(fieldName)}</option>
                      ))}
                  </select>
                  <select value={row.direction || ''} onChange={(e) => updateRow(index, 'direction', e.target.value)}>
                    <option value="">Forward</option>
                    <option value="reverse">Reverse</option>
                  </select>
                  <input type="checkbox" checked={row.allowMultiple !== false} onChange={(e) => updateRow(index, 'allowMultiple', e.target.checked)} />
                </div>
              </div>
            )}
            {row.kind === 'group' && (
              <div className="rdf-subfields">
                <div className="rdf-subfields-title">
                  <span>Subfields for {row.label || row.name}</span>
                  <select
                    value={row.resourceMode || 'per-instance'}
                    onChange={(e) => updateRow(index, 'resourceMode', e.target.value)}
                    aria-label={`${row.label || row.name} resource mode`}
                  >
                    <option value="per-instance">Per class-instance resource</option>
                    <option value="reusable">Reusable resource</option>
                  </select>
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
                      <HelpHeader help={columnHelp.predicate}>Predicate</HelpHeader>
                      <HelpHeader help={columnHelp.datatype}>Datatype</HelpHeader>
                      <HelpHeader help={columnHelp.input}>Input</HelpHeader>
                      <ActionHeaderSpacer />
                    </div>
                    {(row.subfields || []).map((subfield, subfieldIndex) => (
                      <div key={`${subfield.isNew || row.isNew ? 'new-subfield' : subfield.name}-${subfieldIndex}`} className="rdf-subfield-row">
                        <input value={subfield.label || ''} onChange={(e) => updateSubfield(index, subfieldIndex, 'label', e.target.value)} />
                        <input value={subfield.predicate || ''} onChange={(e) => updateSubfield(index, subfieldIndex, 'predicate', e.target.value)} />
                        <DatatypeInput value={subfield.datatype} onChange={(value) => updateSubfield(index, subfieldIndex, 'datatype', value)} placeholder="xsd:decimal" />
                        <select value={subfield.inputType || 'text'} onChange={(e) => updateSubfield(index, subfieldIndex, 'inputType', e.target.value)}>
                          <option value="text">Text</option>
                          <option value="textarea">Textarea</option>
                          <option value="text-list">Text list</option>
                          <option value="uri-list">URI list</option>
                          <option value="date">Date</option>
                          <option value="number">Number</option>
                          <option value="datetime">Date/time</option>
                        </select>
                        <button type="button" className="delete-btn" onClick={() => removeSubfield(index, subfieldIndex)}>Remove</button>
                      </div>
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

                        <div className="rdf-subfield-heading">
                          <HelpHeader help={columnHelp.label}>Label</HelpHeader>
                          <HelpHeader help={columnHelp.predicate}>Predicate</HelpHeader>
                          <HelpHeader help={columnHelp.datatype}>Datatype</HelpHeader>
                          <HelpHeader help={columnHelp.input}>Input</HelpHeader>
                          <ActionHeaderSpacer />
                        </div>
                        {(option.subfields || []).map((subfield, subfieldIndex) => (
                          <div key={`${subfield.isNew || option.isNew || row.isNew ? 'new-option-subfield' : subfield.name}-${subfieldIndex}`} className="rdf-subfield-row">
                            <input value={subfield.label || ''} onChange={(e) => updateOptionSubfield(index, optionIndex, subfieldIndex, 'label', e.target.value)} />
                            <input value={subfield.predicate || ''} onChange={(e) => updateOptionSubfield(index, optionIndex, subfieldIndex, 'predicate', e.target.value)} />
                            <DatatypeInput value={subfield.datatype} onChange={(value) => updateOptionSubfield(index, optionIndex, subfieldIndex, 'datatype', value)} placeholder="xsd:decimal" />
                            <select value={subfield.inputType || 'text'} onChange={(e) => updateOptionSubfield(index, optionIndex, subfieldIndex, 'inputType', e.target.value)}>
                              <option value="text">Text</option>
                              <option value="textarea">Textarea</option>
                              <option value="text-list">Text list</option>
                              <option value="uri-list">URI list</option>
                              <option value="date">Date</option>
                              <option value="number">Number</option>
                              <option value="datetime">Date/time</option>
                            </select>
                            <button type="button" className="delete-btn" onClick={() => removeOptionSubfield(index, optionIndex, subfieldIndex)}>Remove</button>
                          </div>
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
    </div>
  );
}

export default function RdfStructure() {
  const { data, loading, error } = useQuery(GET_RDF_STRUCTURE);
  const [updateStructure] = useMutation(UPDATE_RDF_STRUCTURE, {
    refetchQueries: [{ query: GET_RDF_STRUCTURE }],
  });
  const [rawJson, setRawJson] = useState('');
  const [message, setMessage] = useState('');
  const [editableFieldNames, setEditableFieldNames] = useState({});
  const [editableClassNames, setEditableClassNames] = useState([]);
  const [selectedEntityType, setSelectedEntityType] = useState('');

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
  const selectedRows = rowsByEntity[selectedEntityType] || [];

  useEffect(() => {
    if (!entityTypes.length) {
      setSelectedEntityType('');
      return;
    }
    if (!selectedEntityType || !entityTypes.includes(selectedEntityType)) {
      setSelectedEntityType(entityTypes[0]);
    }
  }, [entityTypes, selectedEntityType]);

  const setEntityRows = (entityType, rows) => {
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
        ...entity,
        fields: {
          ...generatedAndMetadata,
          ...fieldsFromRows(rows),
        },
        arrays: arraysFromRows(rows),
        nested: nestedFromRows(rows),
        fieldOrder: rows.filter(row => row.name).map(row => row.name),
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
      fieldOrder: (entity?.fieldOrder || []).filter(fieldName => fieldName !== idField),
    };
  };

  const setClasses = ({ classes, uriTemplates, renamedClass, templateChanged }) => {
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
        fieldOrder: [],
      },
    };
    setEditableClassNames(current => [...current, name]);
    setEditableFieldNames(current => ({ ...current, [name]: [] }));
    setSelectedEntityType(name);
    setRawJson(JSON.stringify(nextStructure, null, 2));
  };

  const deleteClass = (entityType) => {
    const nextClasses = omitKeys(structure.classes || {}, [entityType]);
    const nextUriTemplates = omitKeys(structure.uriTemplates || {}, [entityType]);
    const nextStructure = {
      ...omitKeys(structure, [entityType]),
      classes: nextClasses,
      uriTemplates: nextUriTemplates,
    };
    const nextEntityTypes = Object.keys({ ...nextClasses, ...nextUriTemplates });
    setSelectedEntityType(current => (
      current === entityType ? nextEntityTypes[0] || '' : current
    ));
    setEditableClassNames(current => current.filter(name => name !== entityType));
    setEditableFieldNames(current => omitKeys(current, [entityType]));
    setRawJson(JSON.stringify(nextStructure, null, 2));
  };

  const buildStructure = () => {
    return JSON.parse(sourceJson);
  };

  const handleSave = async () => {
    try {
      setMessage('');
      const nextStructure = buildStructure();
      await updateStructure({ variables: { json: JSON.stringify(nextStructure, null, 2) } });
      setEditableFieldNames({});
      setEditableClassNames([]);
      setMessage('RDF structure saved. Open pages will use the new structure after refetching; restart the backend if you need the named GraphQL schema fields regenerated.');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  if (loading) return <p>Loading RDF structure...</p>;
  if (error) return <div className="error-message">{error.message}</div>;

  return (
    <div className="settings-page">
      <div className="rdf-structure-window">
        <div className="rdf-window-header">
          <h2>RDF Structure</h2>
          <button type="button" onClick={handleSave} className="create-report-button">
            Save RDF Structure
          </button>
          {message && <div className={message.startsWith('Error') ? 'error-message' : 'success-message'}>{message}</div>}
          {parseError && <div className="error-message">JSON error: {parseError}</div>}
        </div>

        {structure ? (
          <>
          <datalist id="rdf-datatype-options">
            {datatypeOptions.map(datatype => (
              <option key={datatype} value={datatype} />
            ))}
          </datalist>

            <ClassSidebar
              classes={structure.classes}
              uriTemplates={structure.uriTemplates}
              editableClassNames={editableClassNames}
              selectedEntityType={selectedEntityType}
              onSelect={setSelectedEntityType}
              onChange={setClasses}
              onAdd={addClass}
              onDelete={deleteClass}
            />

            <main className="rdf-field-pane">
              {selectedEntityType ? (
              <CombinedFieldTable
                key={selectedEntityType}
                title={titleForEntity(selectedEntityType)}
                rows={selectedRows}
                structure={structure}
                selectedEntityType={selectedEntityType}
                onChange={(nextRows) => setEntityRows(selectedEntityType, nextRows)}
                onAdd={() => setEntityRows(selectedEntityType, [...selectedRows, newFieldFor(selectedRows)])}
                onRemove={(index) => setEntityRows(selectedEntityType, selectedRows.filter((_, i) => i !== index))}
              />
              ) : (
                <div className="rdf-empty-field-pane">
                  <h3>No class selected</h3>
                  <p>Add a class to start defining fields.</p>
                </div>
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
          onChange={(e) => setRawJson(e.target.value)}
          rows={16}
          spellCheck="false"
          className="rdf-json-editor"
        />
      </div>
    </div>
  );
}
