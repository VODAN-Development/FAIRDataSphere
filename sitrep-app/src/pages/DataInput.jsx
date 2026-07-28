import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, gql } from '@apollo/client';
import { DynamicFieldInputs } from '../components/DynamicFieldForm.jsx';
import { emptyValueFor, fieldInputsPayload, fieldValidationFromError } from '../components/dynamicFieldFormUtils.js';
import OrganisationGate from '../components/OrganisationGate.jsx';
import { useOrganisationContext } from '../auth/useOrganisationContext.js';
import { notifyReportsUpdated, titleForEntity } from '../utils/reportDisplay.js';

const GET_RDF_STRUCTURE = gql`
  fragment RdfStructureFieldLevel3 on RdfStructureField {
    name
    label
    inputType
    kind
    datatype
    allowMultiple
    encrypted
  }

  fragment RdfStructureFieldLevel2 on RdfStructureField {
    ...RdfStructureFieldLevel3
    subfields {
      ...RdfStructureFieldLevel3
    }
    options {
      name
      label
      subfields {
        ...RdfStructureFieldLevel3
      }
    }
  }

  fragment RdfStructureFieldLevel1 on RdfStructureField {
    ...RdfStructureFieldLevel3
    required
    subfields {
      ...RdfStructureFieldLevel2
    }
    options {
      name
      label
      subfields {
        ...RdfStructureFieldLevel2
      }
    }
  }

  query GetRdfStructure($organisationId: ID) {
    rdfStructure(organisationId: $organisationId) {
      json
      reportItemFields {
        ...RdfStructureFieldLevel1
      }
      reportFields {
        ...RdfStructureFieldLevel1
      }
    }
  }
`;

const CREATE_RDF_ENTITY = gql`
  mutation CreateRdfEntityFromFields($entityType: String!, $fieldValues: [RdfFieldValueInput!]!, $organisationId: ID) {
    createRdfEntityFromFields(entityType: $entityType, fieldValues: $fieldValues, organisationId: $organisationId) {
      entityType
      id
      uri
    }
  }
`;

const groupPropertyNames = new Set(['label', 'predicate', 'inputType', 'required', 'resourceMode', 'className', 'targetEntityType', 'targetClass', 'targetTemplate', 'targetLabelField']);

function groupSubfieldEntries(group = {}) {
  // Group metadata keys should not be treated as editable subfields.
  return Object.entries(group || {})
    .filter(([key, field]) => !groupPropertyNames.has(key) && field && typeof field === 'object' && field.predicate);
}

function isGroupField(field = {}) {
  return !field.options && groupSubfieldEntries(field).length > 0;
}

function fieldKind(field = {}) {
  if (field.inputType === 'import-class') return 'importClass';
  if (isGroupField(field)) return 'group';
  if (field.options) return 'conditional';
  if (field.allowMultiple || field.inputType === 'text-list' || field.inputType === 'uri-list') return 'array';
  return 'scalar';
}

function fieldPayloadFromStructure(name, field = {}) {
  // The backend structure is keyed by field name; DynamicFieldForm expects an
  // array of field payloads with kind/subfield metadata.
  const kind = fieldKind(field);
  return {
    name,
    kind,
    ...field,
    subfields: kind === 'group' || kind === 'importClass'
      ? groupSubfieldEntries(field).map(([subfieldName, subfield]) => fieldPayloadFromStructure(subfieldName, subfield))
      : undefined,
    options: field.options
      ? Object.entries(field.options).map(([optionName, option]) => ({
          name: optionName,
          label: option.label || optionName,
          value: option.value,
          subfields: Object.entries(option.fields || {})
            .map(([subfieldName, subfield]) => fieldPayloadFromStructure(subfieldName, subfield)),
        }))
      : undefined,
  };
}

function fieldsForEntity(structure, entityType) {
  const entity = structure?.[entityType] || {};
  const fields = {
    ...(entity.fields || {}),
    ...(entity.arrays || {}),
    ...(entity.nested || {}),
  };
  return Object.entries(fields)
    .filter(([, field]) => !field?.generated && !field?.metadataOnly)
    .map(([name, field]) => fieldPayloadFromStructure(name, field));
}

function safeFilename(value, fallback) {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadTextFile(filename, text, type) {
  downloadBlob(filename, new Blob([text], { type }));
}

function templateValueForField(field) {
  if (field.kind === 'array' || field.allowMultiple) return [];
  if (field.kind === 'group' || field.kind === 'importClass') {
    return Object.fromEntries((field.subfields || []).map(subfield => [subfield.name, templateValueForField(subfield)]));
  }
  if (field.kind === 'conditional') {
    const firstOption = field.options?.[0];
    return {
      selectedOption: firstOption?.name || '',
      ...(firstOption
        ? Object.fromEntries((firstOption.subfields || []).map(subfield => [subfield.name, templateValueForField(subfield)]))
        : {}),
    };
  }
  return '';
}

function flattenFieldColumns(field, prefix = '') {
  const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
  if (field.kind === 'group' || field.kind === 'importClass') {
    return (field.subfields || []).flatMap(subfield => flattenFieldColumns(subfield, fieldPath));
  }
  if (field.kind === 'conditional') {
    return [
      {
        path: `${fieldPath}.selectedOption`,
        label: `${field.label || field.name} option`,
      },
      ...(field.options || []).flatMap(option => (
        (option.subfields || []).flatMap(subfield => flattenFieldColumns(subfield, `${fieldPath}.${option.name}`))
      )),
    ];
  }
  return [{
    path: fieldPath,
    label: field.label || field.name,
  }];
}

function entityTemplateObject(fields) {
  return Object.fromEntries(fields.map(field => [field.name, templateValueForField(field)]));
}

function templateFieldsByEntity({ data, structure, entityTypes }) {
  return Object.fromEntries(entityTypes.map(entityType => [
    entityType,
    entityType === 'reportItem'
      ? data?.rdfStructure?.reportItemFields || []
      : fieldsForEntity(structure, entityType),
  ]));
}

function dataTemplateJson(templateFields) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(templateFields).map(([entityType, fields]) => [
      entityType,
      [entityTemplateObject(fields)],
    ])),
    null,
    2
  );
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function worksheetXml(rows) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
    }).join('')}</row>`).join('')}
  </sheetData>
</worksheet>`;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  bytes.forEach(byte => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function zipFiles(files) {
  const encoder = new TextEncoder();
  const output = [];
  const centralDirectory = [];
  let offset = 0;

  files.forEach(file => {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = encoder.encode(file.content);
    const checksum = crc32(contentBytes);
    const localHeaderOffset = offset;
    const localHeader = [];

    writeUint32(localHeader, 0x04034b50);
    writeUint16(localHeader, 20);
    writeUint16(localHeader, 0);
    writeUint16(localHeader, 0);
    writeUint16(localHeader, 0);
    writeUint16(localHeader, 0);
    writeUint32(localHeader, checksum);
    writeUint32(localHeader, contentBytes.length);
    writeUint32(localHeader, contentBytes.length);
    writeUint16(localHeader, nameBytes.length);
    writeUint16(localHeader, 0);
    output.push(...localHeader, ...nameBytes, ...contentBytes);
    offset += localHeader.length + nameBytes.length + contentBytes.length;

    const centralHeader = [];
    writeUint32(centralHeader, 0x02014b50);
    writeUint16(centralHeader, 20);
    writeUint16(centralHeader, 20);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint32(centralHeader, checksum);
    writeUint32(centralHeader, contentBytes.length);
    writeUint32(centralHeader, contentBytes.length);
    writeUint16(centralHeader, nameBytes.length);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint32(centralHeader, 0);
    writeUint32(centralHeader, localHeaderOffset);
    centralDirectory.push(...centralHeader, ...nameBytes);
  });

  const centralDirectoryOffset = offset;
  output.push(...centralDirectory);
  offset += centralDirectory.length;

  const endRecord = [];
  writeUint32(endRecord, 0x06054b50);
  writeUint16(endRecord, 0);
  writeUint16(endRecord, 0);
  writeUint16(endRecord, files.length);
  writeUint16(endRecord, files.length);
  writeUint32(endRecord, centralDirectory.length);
  writeUint32(endRecord, centralDirectoryOffset);
  writeUint16(endRecord, 0);
  output.push(...endRecord);

  return new Uint8Array(output);
}

function safeSheetName(value, usedNames) {
  const base = String(value || 'Data')
    .replace(/[\[\]*?/\\:]/g, ' ')
    .trim()
    .slice(0, 31) || 'Data';
  let name = base;
  let suffix = 2;
  while (usedNames.has(name)) {
    const marker = ` ${suffix}`;
    name = `${base.slice(0, 31 - marker.length)}${marker}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}

function workbookFiles(sheets) {
  return [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}
  </sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
</Relationships>`,
    },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheetXml(sheet.rows),
    })),
  ];
}

function dataTemplateXlsxBlob(templateFields) {
  const usedNames = new Set();
  const sheets = Object.entries(templateFields).map(([entityType, fields]) => {
    const columns = fields.flatMap(field => flattenFieldColumns(field));
    return {
      name: safeSheetName(entityType, usedNames),
      rows: [
        columns.map(column => column.path),
        columns.map(column => column.label),
        columns.map(() => ''),
      ],
    };
  });
  return new Blob([zipFiles(workbookFiles(sheets))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export default function DataInput() {
  // Data input creates new report items or custom RDF entities using the same
  // dynamic field definitions that power editing elsewhere.
  const { activeOrganisationId, activeOrganisationIsUnscoped } = useOrganisationContext();
  const { data, loading: structureLoading, error: structureError } = useQuery(GET_RDF_STRUCTURE, {
    variables: { organisationId: activeOrganisationId },
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const [formData, setFormData] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedEntityType, setSelectedEntityType] = useState('');
  const [inputMode, setInputMode] = useState('');
  const [importFile, setImportFile] = useState(null);

  const structure = useMemo(() => {
    if (!data?.rdfStructure?.json) return null;
    try {
      return JSON.parse(data.rdfStructure.json);
    } catch {
      return null;
    }
  }, [data]);
  const entityTypes = useMemo(
    () => Object.keys({ ...(structure?.classes || {}), ...(structure?.uriTemplates || {}) })
      .filter(entityType => entityType !== 'report'),
    [structure]
  );
  const activeEntityType = entityTypes.includes(selectedEntityType)
    ? selectedEntityType
    : entityTypes.includes('reportItem')
      ? 'reportItem'
      : entityTypes[0] || '';
  const fields = useMemo(() => {
    if (activeEntityType === 'reportItem') return data?.rdfStructure?.reportItemFields || [];
    return fieldsForEntity(structure, activeEntityType);
  }, [activeEntityType, data, structure]);
  const importTemplateFields = useMemo(() => (
    templateFieldsByEntity({ data, structure, entityTypes })
  ), [data, entityTypes, structure]);
  const canDownloadTemplate = !structureLoading && !structureError && entityTypes.length > 0;
  const initializedForm = useMemo(() => {
    return Object.fromEntries(fields.map(field => [field.name, formData[field.name] ?? emptyValueFor(field)]));
  }, [fields, formData]);

  useEffect(() => {
    setFormData({});
    setFieldErrors({});
    setError('');
    setMessage('');
  }, [activeEntityType]);

  const [createRdfEntity] = useMutation(CREATE_RDF_ENTITY);

  const chooseInputMode = (mode) => {
    setInputMode(mode);
    setError('');
    setMessage('');
  };

  const resetInputMode = () => {
    setInputMode('');
    setImportFile(null);
    setError('');
    setMessage('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setFieldErrors({});
    setLoading(true);

    try {
      const fieldValues = fieldInputsPayload(fields, initializedForm);
      const result = await createRdfEntity({
        variables: { entityType: activeEntityType, fieldValues, organisationId: activeOrganisationId },
      });
      const created = result.data.createRdfEntityFromFields;
      setMessage(`${titleForEntity(created.entityType)} created.`);
      setFormData({});
      notifyReportsUpdated();
    } catch (err) {
      const fieldValidation = fieldValidationFromError(err);
      if (fieldValidation) {
        setFieldErrors({ [fieldValidation.fieldName]: fieldValidation.message });
        return;
      }
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImportSubmit = (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!importFile) {
      setError('Choose a file to import.');
      return;
    }

    setMessage(`${importFile.name} is ready to import.`);
  };

  const handleDownloadJsonTemplate = () => {
    if (!canDownloadTemplate) return;
    downloadTextFile('data-import-template.json', `${dataTemplateJson(importTemplateFields)}\n`, 'application/json');
  };

  const handleDownloadXlsxTemplate = () => {
    if (!canDownloadTemplate) return;
    downloadBlob('data-import-template.xlsx', dataTemplateXlsxBlob(importTemplateFields));
  };

  if (inputMode === 'manual') {
    if (structureLoading) return <p>Loading RDF structure...</p>;
    if (structureError) return <div className="error-message">{structureError.message}</div>;
    if (!activeEntityType) return <div className="error-message">No RDF classes are available for data input.</div>;
  }

  return (
    <OrganisationGate requireWrite>
      <main className="settings-page">
        <div className={`rdf-structure-window app-browser-window data-input-browser-window${inputMode ? '' : ' data-input-mode-browser-window'}`}>
          <div className="rdf-window-header">
            <h2>Data Input</h2>
            {error && <div className="error-message">{error}</div>}
            {message && <div className="success-message">{message}</div>}
          </div>

          {!inputMode ? (
            <main className="rdf-field-pane data-input-detail-pane data-input-mode-pane">
              <section className="data-input-mode-choice">
                <button type="button" className="data-input-mode-card" onClick={() => chooseInputMode('manual')}>
                  <strong>Manual data input</strong>
                  <span>Create records with the current input form.</span>
                </button>
                <button type="button" className="data-input-mode-card" onClick={() => chooseInputMode('import')}>
                  <strong>Import data</strong>
                  <span>Upload a file for import.</span>
                </button>
              </section>
            </main>
          ) : inputMode === 'manual' ? (
            <>
              <aside className="rdf-class-sidebar data-input-sidebar">
                <div className="rdf-class-sidebar-heading">
                  <h3>Input</h3>
                </div>

                <button type="button" className="data-input-back-button" onClick={resetInputMode}>
                  Back
                </button>

                <div className="data-input-option-list" role="tablist" aria-label="Data input classes">
                  {entityTypes.map(entityType => (
                    <button
                      key={entityType}
                      type="button"
                      className={`data-input-option-button${entityType === activeEntityType ? ' active' : ''}`}
                      onClick={() => setSelectedEntityType(entityType)}
                      role="tab"
                      aria-selected={entityType === activeEntityType}
                    >
                      Create new {titleForEntity(entityType).toLowerCase()}
                    </button>
                  ))}
                </div>
              </aside>

              <main className="rdf-field-pane data-input-detail-pane">
                <section className="data-input-detail-section">
                  <div className="rdf-editor-heading">
                    <h3>Create new {titleForEntity(activeEntityType).toLowerCase()}</h3>
                  </div>

                  <form onSubmit={handleSubmit} className="report-item-form data-input-form">
                    <DynamicFieldInputs
                      fields={fields}
                      values={initializedForm}
                      onChange={setFormData}
                      disabled={loading}
                      fieldErrors={fieldErrors}
                      onFieldErrorClear={(name) => setFieldErrors(current => {
                        const next = { ...current };
                        delete next[name];
                        return next;
                      })}
                    />

                    <button type="submit" disabled={loading}>
                      {loading ? 'Submitting...' : 'Create Item'}
                    </button>
                  </form>
                </section>
              </main>
            </>
          ) : (
            <>
              <aside className="rdf-class-sidebar data-input-sidebar">
                <div className="rdf-class-sidebar-heading">
                  <h3>Import</h3>
                </div>

                <button type="button" className="data-input-back-button" onClick={resetInputMode}>
                  Back
                </button>
              </aside>

              <main className="rdf-field-pane data-input-detail-pane">
                <section className="data-input-detail-section">
                  <div className="rdf-editor-heading">
                    <h3>Import data</h3>
                  </div>

                  <form className="data-import-form" onSubmit={handleImportSubmit}>
                    <div className="data-import-template-actions">
                      <button type="button" onClick={handleDownloadXlsxTemplate} disabled={!canDownloadTemplate}>
                        Download XLSX template
                      </button>
                      <button type="button" onClick={handleDownloadJsonTemplate} disabled={!canDownloadTemplate}>
                        Download JSON template
                      </button>
                    </div>

                    <label className="data-import-dropzone">
                      <span>Upload file</span>
                      <input
                        type="file"
                        accept=".xlsx,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={(event) => {
                          setImportFile(event.target.files?.[0] || null);
                          setError('');
                          setMessage('');
                        }}
                      />
                    </label>

                    {importFile && (
                      <div className="data-import-file">
                        <strong>{importFile.name}</strong>
                        <span>{Math.max(1, Math.ceil(importFile.size / 1024))} KB</span>
                      </div>
                    )}

                    <button type="submit" disabled={!importFile}>
                      Upload file
                    </button>
                  </form>
                </section>
              </main>
            </>
          )}
        </div>
      </main>
    </OrganisationGate>
  );
}
