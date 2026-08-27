import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, gql } from '@apollo/client';
import { DynamicFieldInputs } from '../components/DynamicFieldForm.jsx';
import { emptyValueFor, fieldInputsPayload, fieldValidationFromError } from '../components/dynamicFieldFormUtils.js';
import OrganisationGate from '../components/OrganisationGate.jsx';
import { useOrganisationContext } from '../auth/useOrganisationContext.js';
import { notifyReportsUpdated, titleForEntity } from '../utils/reportDisplay.js';
import FloatyConfirmation, { useFloatyConfirmation } from '../components/FloatyConfirmation.jsx';

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

const UPDATE_RDF_STRUCTURE = gql`
  mutation UpdateRdfStructureFromImport($json: String!, $organisationId: ID) {
    updateRdfStructure(json: $json, organisationId: $organisationId) {
      json
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

function nameFromLabel(label, fallback = 'field') {
  const words = String(label || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return fallback;
  const name = words
    .map((word, index) => {
      const normalized = word.charAt(0).toUpperCase() + word.slice(1);
      return index === 0 ? normalized.charAt(0).toLowerCase() + normalized.slice(1) : normalized;
    })
    .join('');
  return /^[A-Za-z_]/.test(name) ? name : `${fallback}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function capitalizeLocalName(name) {
  const value = String(name || '');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function uniqueName(baseName, usedNames, fallback = 'field') {
  const normalized = nameFromLabel(baseName, fallback);
  let candidate = normalized;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${normalized}${index}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
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

function isBlankImportValue(value) {
  if (Array.isArray(value)) return value.every(isBlankImportValue);
  if (value && typeof value === 'object') return Object.values(value).every(isBlankImportValue);
  return String(value ?? '').trim() === '';
}

function parseJsonLikeValue(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!['{', '['].includes(trimmed.charAt(0))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function importScalarValue(field, value) {
  if (isBlankImportValue(value)) return emptyValueFor(field);
  const parsed = parseJsonLikeValue(value);
  if (field.kind === 'array' || field.allowMultiple || field.inputType === 'text-list' || field.inputType === 'uri-list') {
    if (Array.isArray(parsed)) return parsed.map(item => String(item ?? '')).filter(Boolean);
    return String(parsed ?? '')
      .split(/\r?\n|;/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return parsed ?? '';
}

function importedJsonValueForField(field, value) {
  if (isBlankImportValue(value)) return emptyValueFor(field);
  const parsed = parseJsonLikeValue(value);

  if (field.kind === 'group' || field.kind === 'importClass') {
    if (field.allowMultiple && Array.isArray(parsed)) {
      return parsed.map(item => Object.fromEntries((field.subfields || []).map(subfield => [
        subfield.name,
        importedJsonValueForField(subfield, item?.[subfield.name]),
      ])));
    }
    const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    return Object.fromEntries((field.subfields || []).map(subfield => [
      subfield.name,
      importedJsonValueForField(subfield, source[subfield.name]),
    ]));
  }

  if (field.kind === 'conditional') {
    const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const selectedOption = source.selectedOption || '';
    const option = (field.options || []).find(candidate => candidate.name === selectedOption);
    return {
      selectedOption,
      values: Object.fromEntries((option?.subfields || []).map(subfield => [
        subfield.name,
        importedJsonValueForField(subfield, source[subfield.name] ?? source.values?.[subfield.name]),
      ])),
    };
  }

  return importScalarValue(field, parsed);
}

function importedValuesFromJsonRow(fields, row = {}) {
  return Object.fromEntries((fields || []).map(field => [
    field.name,
    importedJsonValueForField(field, row[field.name]),
  ]));
}

function setImportedPathValue(values, fields, path, value) {
  if (isBlankImportValue(value)) return;
  const [fieldName, ...rest] = String(path || '').split('.');
  const field = (fields || []).find(candidate => candidate.name === fieldName);
  if (!field) return;

  if (rest.length === 0) {
    values[field.name] = importScalarValue(field, value);
    return;
  }

  if (field.kind === 'group' || field.kind === 'importClass') {
    if (field.allowMultiple) {
      const currentValues = Array.isArray(values[field.name]) ? values[field.name] : [];
      const defaultValues = emptyValueFor(field);
      const target = currentValues[0] && typeof currentValues[0] === 'object'
        ? currentValues[0]
        : Array.isArray(defaultValues) ? defaultValues[0] : {};
      values[field.name] = [target];
      setImportedPathValue(target, field.subfields || [], rest.join('.'), value);
      return;
    }

    const target = values[field.name] && typeof values[field.name] === 'object' && !Array.isArray(values[field.name])
      ? values[field.name]
      : emptyValueFor(field);
    values[field.name] = target;
    setImportedPathValue(target, field.subfields || [], rest.join('.'), value);
    return;
  }

  if (field.kind !== 'conditional') return;
  const conditionalValue = values[field.name] && typeof values[field.name] === 'object'
    ? values[field.name]
    : emptyValueFor(field);
  values[field.name] = conditionalValue;

  if (rest[0] === 'selectedOption') {
    conditionalValue.selectedOption = String(value || '').trim();
    return;
  }

  const optionName = rest[0];
  const option = (field.options || []).find(candidate => candidate.name === optionName);
  if (!option) return;
  conditionalValue.selectedOption = conditionalValue.selectedOption || optionName;
  conditionalValue.values = conditionalValue.values || {};
  setImportedPathValue(conditionalValue.values, option.subfields || [], rest.slice(1).join('.'), value);
}

function importHeaderIndex(rows, fields) {
  const knownPaths = new Set((fields || []).flatMap(field => flattenFieldColumns(field).map(column => column.path)));
  const limit = Math.min(rows.length, 10);
  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < limit; index += 1) {
    const score = (rows[index] || []).filter(value => knownPaths.has(String(value || '').trim())).length;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestIndex : -1;
}

function isImportLabelRow(row, fields) {
  const labels = new Set((fields || []).flatMap(field => flattenFieldColumns(field).map(column => column.label)));
  const values = (row || []).map(value => String(value || '').trim()).filter(Boolean);
  return values.length > 0 && values.every(value => labels.has(value));
}

function importedValuesFromTableRow(fields, headers, row) {
  const values = Object.fromEntries((fields || []).map(field => [field.name, emptyValueFor(field)]));
  headers.forEach((header, columnIndex) => {
    const path = String(header || '').trim();
    if (path) setImportedPathValue(values, fields, path, row[columnIndex]);
  });
  return values;
}

function entityTypeForTable(table, templateFields, tableIndex, tableCount) {
  const entityTypes = Object.keys(templateFields || {});
  const normalizedTableName = String(table?.name || '').trim().toLowerCase();
  const exactMatch = entityTypes.find(entityType => entityType.toLowerCase() === normalizedTableName);
  if (exactMatch) return exactMatch;
  if (tableCount === 1 && entityTypes.length === 1) return entityTypes[0];
  if (tableIndex < entityTypes.length) return entityTypes[tableIndex];
  return '';
}

function importRecordsFromTables(tables, templateFields) {
  return (tables || []).flatMap((table, tableIndex) => {
    const entityType = entityTypeForTable(table, templateFields, tableIndex, tables.length);
    const fields = templateFields[entityType] || [];
    if (!entityType || fields.length === 0) return [];

    const headerIndex = importHeaderIndex(table.rows || [], fields);
    if (headerIndex < 0) return [];
    const headers = table.rows[headerIndex] || [];
    const dataRows = (table.rows || []).slice(headerIndex + 1)
      .filter(row => !isImportLabelRow(row, fields))
      .filter(row => row.some(value => String(value ?? '').trim()));

    return dataRows.map(row => ({
      entityType,
      fieldValues: fieldInputsPayload(fields, importedValuesFromTableRow(fields, headers, row)),
    }));
  });
}

function importRecordsFromJson(value, filename, templateFields) {
  const entityTypes = Object.keys(templateFields || {});
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const records = entityTypes.flatMap(entityType => {
      const sourceRows = Array.isArray(value[entityType])
        ? value[entityType]
        : value[entityType] && typeof value[entityType] === 'object' ? [value[entityType]] : [];
      return sourceRows
        .filter(row => row && typeof row === 'object' && !Array.isArray(row))
        .map(row => ({
          entityType,
          fieldValues: fieldInputsPayload(templateFields[entityType], importedValuesFromJsonRow(templateFields[entityType], row)),
        }));
    });
    if (records.length > 0) return records;
  }

  if (Array.isArray(value) && entityTypes.length === 1) {
    return value
      .filter(row => row && typeof row === 'object' && !Array.isArray(row))
      .map(row => ({
        entityType: entityTypes[0],
        fieldValues: fieldInputsPayload(templateFields[entityTypes[0]], importedValuesFromJsonRow(templateFields[entityTypes[0]], row)),
      }));
  }

  return importRecordsFromTables(tablesFromJson(value, filename), templateFields);
}

async function importRecordsFromFile(file, templateFields) {
  if (file.name.toLowerCase().endsWith('.json')) {
    return importRecordsFromJson(JSON.parse(await file.text()), file.name, templateFields);
  }
  return importRecordsFromTables(await tablesFromImportFile(file), templateFields);
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
    .replace(/[\\[\]*?/:]/g, ' ')
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

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

async function inflateZipEntry(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Compressed XLSX files are not supported in this browser.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsxFiles(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder();
  const files = new Map();
  let offset = 0;

  while (offset + 30 <= bytes.length && readUint32(bytes, offset) === 0x04034b50) {
    const compressionMethod = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const fileNameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength)).replace(/\\/g, '/');
    const compressedBytes = bytes.slice(dataStart, dataEnd);
    let fileBytes;

    if (compressionMethod === 0) {
      fileBytes = compressedBytes;
    } else if (compressionMethod === 8) {
      fileBytes = await inflateZipEntry(compressedBytes);
    } else {
      throw new Error(`Unsupported XLSX compression method: ${compressionMethod}.`);
    }

    files.set(name, decoder.decode(fileBytes));
    offset = dataEnd;
  }

  return files;
}

function workbookSheetMap(files) {
  const workbook = new DOMParser().parseFromString(files.get('xl/workbook.xml') || '', 'application/xml');
  const relationships = new DOMParser().parseFromString(files.get('xl/_rels/workbook.xml.rels') || '', 'application/xml');
  const targetsById = new Map(Array.from(relationships.getElementsByTagNameNS('*', 'Relationship')).map(relationship => [
    relationship.getAttribute('Id'),
    relationship.getAttribute('Target') || '',
  ]));

  return new Map(Array.from(workbook.getElementsByTagNameNS('*', 'sheet')).map(sheet => {
    const target = targetsById.get(sheet.getAttribute('r:id')) || '';
    const path = target.startsWith('xl/') ? target : `xl/${target.replace(/^\//, '')}`;
    return [sheet.getAttribute('name'), path];
  }));
}

function sharedStringsFromFiles(files) {
  const sharedStringsXml = files.get('xl/sharedStrings.xml');
  if (!sharedStringsXml) return [];
  const sharedStrings = new DOMParser().parseFromString(sharedStringsXml, 'application/xml');
  return Array.from(sharedStrings.getElementsByTagNameNS('*', 'si')).map(item => item.textContent || '');
}

function columnIndexFromReference(reference) {
  const letters = String(reference || '').match(/^[A-Z]+/i)?.[0] || '';
  return [...letters.toUpperCase()].reduce((index, letter) => (index * 26) + letter.charCodeAt(0) - 64, 0) - 1;
}

function rowsFromWorksheetXml(xml, sharedStrings = []) {
  const worksheet = new DOMParser().parseFromString(xml || '', 'application/xml');
  return Array.from(worksheet.getElementsByTagNameNS('*', 'row')).map(row => (
    Array.from(row.getElementsByTagNameNS('*', 'c')).reduce((cells, cell) => {
      const columnIndex = Math.max(0, columnIndexFromReference(cell.getAttribute('r')));
      const rawValue = cell.textContent || '';
      cells[columnIndex] = cell.getAttribute('t') === 's'
        ? sharedStrings[Number(rawValue)] || ''
        : rawValue;
      return cells;
    }, [])
  ).map(row => row.map(value => value ?? '')));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter(csvRow => csvRow.some(value => String(value || '').trim()));
}

function objectRowsFromJson(value) {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object' && !Array.isArray(item));
  if (value && typeof value === 'object') return [value];
  return [];
}

function tablesFromJson(value, filename) {
  if (Array.isArray(value)) return [{ name: safeFilename(filename.replace(/\.json$/i, ''), 'importedData'), rows: rowsFromObjects(objectRowsFromJson(value)) }];
  if (!value || typeof value !== 'object') return [];

  const arrayTables = Object.entries(value)
    .filter(([, tableValue]) => Array.isArray(tableValue))
    .map(([name, tableValue]) => ({ name, rows: rowsFromObjects(objectRowsFromJson(tableValue)) }))
    .filter(table => table.rows.length > 0);
  if (arrayTables.length > 0) return arrayTables;
  return [{ name: safeFilename(filename.replace(/\.json$/i, ''), 'importedData'), rows: rowsFromObjects(objectRowsFromJson(value)) }];
}

function rowsFromObjects(objects) {
  const keys = [];
  const keySet = new Set();
  objects.forEach(object => {
    Object.keys(object || {}).forEach(key => {
      if (!keySet.has(key)) {
        keySet.add(key);
        keys.push(key);
      }
    });
  });
  return [
    keys,
    ...objects.map(object => keys.map(key => {
      const value = object?.[key];
      return value && typeof value === 'object' ? JSON.stringify(value) : value ?? '';
    })),
  ];
}

async function tablesFromXlsx(file) {
  const files = await unzipXlsxFiles(await file.arrayBuffer());
  const sheets = workbookSheetMap(files);
  const sharedStrings = sharedStringsFromFiles(files);
  return Array.from(sheets.entries())
    .map(([name, path]) => ({ name, rows: rowsFromWorksheetXml(files.get(path), sharedStrings) }))
    .filter(table => table.rows.some(row => row.some(value => String(value || '').trim())));
}

async function tablesFromImportFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xlsx')) return tablesFromXlsx(file);
  if (lowerName.endsWith('.csv')) return [{ name: file.name.replace(/\.csv$/i, '') || 'Imported data', rows: parseCsvRows(await file.text()) }];
  if (lowerName.endsWith('.json')) return tablesFromJson(JSON.parse(await file.text()), file.name);
  throw new Error('Choose a .json, .csv, or .xlsx file.');
}

function inferHeaderIndex(rows) {
  const limit = Math.min(rows.length, 25);
  let bestIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < limit; index += 1) {
    const score = (rows[index] || []).filter(value => String(value || '').trim()).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestScore > 0 ? bestIndex : -1;
}

function inferFieldType(label, values) {
  const lowerLabel = String(label || '').toLowerCase();
  const samples = values.map(value => String(value ?? '').trim()).filter(Boolean).slice(0, 100);
  if (/\bdate\b|^date | date$|time/.test(lowerLabel)) return { inputType: 'date', datatype: 'xsd:date' };
  if (samples.length > 0 && samples.every(value => /^-?\d+$/.test(value))) {
    return { inputType: 'number', datatype: 'xsd:integer', parse: 'int' };
  }
  if (samples.length > 0 && samples.every(value => /^-?\d+([.,]\d+)?$/.test(value))) {
    return { inputType: 'number', datatype: 'xsd:decimal' };
  }
  if (samples.some(value => value.length > 140) || /paragraph|reported|description|context|comment|source/.test(lowerLabel)) {
    return { inputType: 'textarea', datatype: 'xsd:string' };
  }
  return { inputType: 'text', datatype: 'xsd:string' };
}

function classForEntity(entityType) {
  return `sitrep:${capitalizeLocalName(entityType)}`;
}

function uriTemplateForEntity(entityType) {
  return `resource:${capitalizeLocalName(entityType)}_{id}`;
}

function generatedIdField(entityType) {
  return {
    predicate: `sitrep:${entityType}Id`,
    datatype: 'xsd:integer',
    required: true,
    parse: 'int',
    generated: true,
    label: 'ID',
    inputType: 'number',
  };
}

function draftFromTables(tables, filename) {
  const entityNames = new Set();
  return {
    filename,
    tabs: tables.map((table, tableIndex) => {
      const headerIndex = inferHeaderIndex(table.rows);
      if (headerIndex < 0) return null;
      const header = table.rows[headerIndex] || [];
      const dataRows = table.rows.slice(headerIndex + 1);
      const entityType = uniqueName(table.name || `Imported data ${tableIndex + 1}`, entityNames, 'importedClass');
      const fieldNames = new Set(['id']);
      const fields = header.map((label, columnIndex) => {
        const cleanLabel = String(label || '').trim();
        if (!cleanLabel) return null;
        const fieldName = uniqueName(cleanLabel, fieldNames, 'field');
        const inferred = inferFieldType(cleanLabel, dataRows.map(row => row[columnIndex]));
        return {
          id: `${tableIndex}-${columnIndex}-${fieldName}`,
          sourceColumn: columnName(columnIndex),
          role: 'field',
          enabled: true,
          label: cleanLabel,
          name: fieldName,
          predicate: `sitrep:${fieldName}`,
          inputType: inferred.inputType || 'text',
          datatype: inferred.datatype || 'xsd:string',
          parse: inferred.parse || '',
          linkTargetEntityType: '',
          sampleValues: dataRows
            .map(row => String(row[columnIndex] ?? '').trim())
            .filter(Boolean)
            .slice(0, 3),
        };
      }).filter(Boolean);
      return {
        id: `${tableIndex}-${entityType}`,
        sourceName: table.name || `Sheet ${tableIndex + 1}`,
        headerRowNumber: headerIndex + 1,
        dataRowCount: dataRows.filter(row => row.some(value => String(value || '').trim())).length,
        enabled: fields.length > 0,
        rowRole: 'instances',
        entityType,
        classIri: classForEntity(entityType),
        uriTemplate: uriTemplateForEntity(entityType),
        fields,
      };
    }).filter(Boolean),
  };
}

function draftStats(draft) {
  const classCount = (draft?.tabs || []).filter(tab => tab.enabled).length;
  const fieldCount = (draft?.tabs || []).reduce((total, tab) => (
    total + (tab.enabled ? tab.fields.filter(field => field.enabled && field.role === 'field').length : 0)
  ), 0);
  return { classCount, fieldCount };
}

function structureFromDraft(draft, baseStructure = {}) {
  const classes = {};
  const uriTemplates = {};
  const classProperties = [];
  const nextStructure = {
    prefixes: {
      sitrep: 'http://sitrep.example.org/ontology#',
      resource: 'http://sitrep.example.org/resource/',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
      rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
      owl: 'http://www.w3.org/2002/07/owl#',
      hds: 'http://example.org/hds#',
      ...(baseStructure?.prefixes || {}),
    },
    classes,
    uriTemplates,
    equivalentClasses: {},
    classProperties,
  };

  (draft?.tabs || []).filter(tab => tab.enabled).forEach(tab => {
    classes[tab.entityType] = tab.classIri || classForEntity(tab.entityType);
    uriTemplates[tab.entityType] = tab.uriTemplate || uriTemplateForEntity(tab.entityType);
    const fields = { id: generatedIdField(tab.entityType) };

    tab.fields.filter(field => field.enabled && field.role === 'field' && field.name && field.predicate).forEach(field => {
      if (field.linkTargetEntityType) {
        fields[field.name] = {
          predicate: field.predicate,
          label: field.label || field.name,
          inputType: 'uri',
          objectType: 'uri',
          createEntityFromInput: true,
          targetEntityType: field.linkTargetEntityType,
          targetClass: classes[field.linkTargetEntityType] || classForEntity(field.linkTargetEntityType),
          targetTemplate: uriTemplates[field.linkTargetEntityType] || uriTemplateForEntity(field.linkTargetEntityType),
          targetLabelField: 'name',
        };
        classProperties.push({
          subject: tab.entityType,
          predicate: field.predicate,
          object: field.linkTargetEntityType,
        });
      } else {
        fields[field.name] = {
          predicate: field.predicate,
          label: field.label || field.name,
          inputType: field.inputType || 'text',
          datatype: field.datatype || 'xsd:string',
          required: false,
          ...(field.parse ? { parse: field.parse } : {}),
        };
      }
    });

    nextStructure[tab.entityType] = {
      idField: 'id',
      fields,
    };
  });

  return nextStructure;
}

export default function DataInput() {
  // Data input creates new report items or custom RDF entities using the same
  // dynamic field definitions that power editing elsewhere.
  const { activeOrganisationId, activeOrganisationIsUnscoped } = useOrganisationContext();
  const { data, loading: structureLoading, error: structureError, refetch: refetchRdfStructure } = useQuery(GET_RDF_STRUCTURE, {
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
  const [structureImportFile, setStructureImportFile] = useState(null);
  const [structureImportSummary, setStructureImportSummary] = useState(null);
  const [structureDraft, setStructureDraft] = useState(null);
  const [activeDraftTabId, setActiveDraftTabId] = useState('');
  const { notice, showNotice, clearNotice } = useFloatyConfirmation();

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
  const draftEntityTypes = useMemo(
    () => (structureDraft?.tabs || []).filter(tab => tab.enabled).map(tab => tab.entityType),
    [structureDraft]
  );
  const activeDraftTab = useMemo(
    () => (structureDraft?.tabs || []).find(tab => tab.id === activeDraftTabId) || structureDraft?.tabs?.[0] || null,
    [activeDraftTabId, structureDraft]
  );
  const draftStructure = useMemo(
    () => structureDraft ? structureFromDraft(structureDraft, structure) : null,
    [structure, structureDraft]
  );
  const draftStructureStats = useMemo(() => draftStats(structureDraft), [structureDraft]);
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
  const [updateRdfStructure] = useMutation(UPDATE_RDF_STRUCTURE);

  const chooseInputMode = (mode) => {
    setInputMode(mode);
    setError('');
    setMessage('');
  };

  const resetInputMode = () => {
    setInputMode('');
    setImportFile(null);
    setStructureImportFile(null);
    setStructureImportSummary(null);
    setStructureDraft(null);
    setActiveDraftTabId('');
    setError('');
    setMessage('');
  };

  const updateDraftTab = (tabId, patch) => {
    setStructureDraft(current => {
      if (!current) return current;
      return {
        ...current,
        tabs: current.tabs.map(tab => tab.id === tabId ? { ...tab, ...patch } : tab),
      };
    });
  };

  const updateDraftField = (tabId, fieldId, patch) => {
    setStructureDraft(current => {
      if (!current) return current;
      return {
        ...current,
        tabs: current.tabs.map(tab => tab.id === tabId
          ? {
              ...tab,
              fields: tab.fields.map(field => field.id === fieldId ? { ...field, ...patch } : field),
            }
          : tab),
      };
    });
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
      showNotice(`${titleForEntity(created.entityType)} created.`);
      setFormData({});
      notifyReportsUpdated();
    } catch (err) {
      const fieldValidation = fieldValidationFromError(err);
      if (fieldValidation) {
        setFieldErrors({ [fieldValidation.fieldName]: fieldValidation.message });
        return;
      }
      setError('Error: ' + err.message);
      showNotice(`Error creating ${titleForEntity(activeEntityType).toLowerCase()}: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleImportSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!importFile) {
      setError('Choose a file to import.');
      return;
    }

    setLoading(true);
    try {
      const records = await importRecordsFromFile(importFile, importTemplateFields);
      if (records.length === 0) {
        throw new Error('No importable records were found. Use the downloaded template so sheet names and column headers match the current RDF structure.');
      }

      for (const record of records) {
        await createRdfEntity({
          variables: {
            entityType: record.entityType,
            fieldValues: record.fieldValues,
            organisationId: activeOrganisationId,
          },
        });
      }

      const entityCounts = records.reduce((counts, record) => ({
        ...counts,
        [record.entityType]: (counts[record.entityType] || 0) + 1,
      }), {});
      const summary = Object.entries(entityCounts)
        .map(([entityType, count]) => `${count} ${titleForEntity(entityType).toLowerCase()}${count === 1 ? '' : 's'}`)
        .join(', ');
      setImportFile(null);
      setMessage(`Imported ${summary} from ${importFile.name}.`);
      notifyReportsUpdated();
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStructureImportSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setStructureImportSummary(null);

    if (!structureImportFile) {
      setError('Choose a .json, .csv, or .xlsx file to create an RDF structure.');
      return;
    }

    setLoading(true);
    try {
      const tables = await tablesFromImportFile(structureImportFile);
      const draft = draftFromTables(tables, structureImportFile.name);
      const { classCount, fieldCount } = draftStats(draft);

      if (classCount === 0 || fieldCount === 0) {
        throw new Error('No usable headers were found in the selected file.');
      }

      setStructureDraft(draft);
      setActiveDraftTabId(draft.tabs[0]?.id || '');
      setStructureImportSummary({ classCount, fieldCount });
      setMessage(`Review the inferred RDF structure from ${structureImportFile.name}.`);
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStructureDraft = async () => {
    setError('');
    setMessage('');
    if (!structureDraft || !draftStructure) {
      setError('Upload a file and review the inferred structure first.');
      return;
    }
    if (draftStructureStats.classCount === 0 || draftStructureStats.fieldCount === 0) {
      setError('Keep at least one class and one field before saving.');
      return;
    }

    setLoading(true);
    try {
      await updateRdfStructure({
        variables: {
          json: JSON.stringify(draftStructure, null, 2),
          organisationId: activeOrganisationId,
        },
      });
      await refetchRdfStructure?.();
      setStructureImportSummary(draftStructureStats);
      showNotice(`RDF structure saved from ${structureDraft.filename}.`);
      setStructureImportFile(null);
      setStructureDraft(null);
      setActiveDraftTabId('');
    } catch (err) {
      setError('Error: ' + err.message);
      showNotice(`Error saving RDF structure: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
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
                  <span>Create records one at a time with the current input form.</span>
                </button>
                <button type="button" className="data-input-mode-card" onClick={() => chooseInputMode('import')}>
                  <strong>Import data</strong>
                  <span>Bulk upload records from a file.</span>
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
                    <h4>Import using the current RDF structure</h4>
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

                    <button type="submit" disabled={!importFile || loading}>
                      {loading ? 'Importing...' : 'Upload file'}
                    </button>
                  </form>

                  <form className="data-import-form data-structure-import-form" onSubmit={handleStructureImportSubmit}>
                    <h4>Create an RDF structure from a file</h4>

                    <label className="data-import-dropzone">
                      <span>Upload unstructured file</span>
                      <input
                        type="file"
                        accept=".xlsx,.csv,.json,text/csv,application/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={(event) => {
                          setStructureImportFile(event.target.files?.[0] || null);
                          setStructureImportSummary(null);
                          setError('');
                          setMessage('');
                        }}
                      />
                    </label>

                    {structureImportFile && (
                      <div className="data-import-file">
                        <strong>{structureImportFile.name}</strong>
                        <span>{Math.max(1, Math.ceil(structureImportFile.size / 1024))} KB</span>
                      </div>
                    )}

                    {structureImportSummary && (
                      <div className="data-import-summary">
                        Created {structureImportSummary.classCount} classes and {structureImportSummary.fieldCount} fields.
                      </div>
                    )}

                    <button type="submit" disabled={!structureImportFile || loading}>
                      {loading ? 'Reading structure...' : 'Review inferred structure'}
                    </button>
                  </form>

                  {structureDraft && activeDraftTab && (
                    <section className="data-structure-review">
                      <div className="data-structure-review-header">
                        <div>
                          <h4>Review inferred structure</h4>
                          <p>{draftStructureStats.classCount} classes and {draftStructureStats.fieldCount} fields ready to save.</p>
                        </div>
                        <div className="data-import-template-actions">
                          <button type="button" onClick={() => setStructureDraft(null)} disabled={loading}>
                            Clear draft
                          </button>
                          <button type="button" onClick={handleSaveStructureDraft} disabled={loading}>
                            {loading ? 'Saving...' : 'Save RDF structure'}
                          </button>
                        </div>
                      </div>

                      <div className="data-structure-review-grid">
                        <aside className="data-structure-tabs" aria-label="Imported sheets">
                          {(structureDraft.tabs || []).map(tab => (
                            <button
                              key={tab.id}
                              type="button"
                              className={tab.id === activeDraftTab.id ? 'active' : ''}
                              onClick={() => setActiveDraftTabId(tab.id)}
                            >
                              <strong>{tab.sourceName}</strong>
                              <span>{tab.enabled ? tab.entityType : 'Ignored'}</span>
                            </button>
                          ))}
                        </aside>

                        <div className="data-structure-editor">
                          <div className="data-structure-class-editor">
                            <label>
                              Use tab
                              <select
                                value={activeDraftTab.enabled ? 'yes' : 'no'}
                                onChange={(event) => updateDraftTab(activeDraftTab.id, { enabled: event.target.value === 'yes' })}
                              >
                                <option value="yes">Class</option>
                                <option value="no">Ignore</option>
                              </select>
                            </label>
                            <label>
                              Rows are
                              <select
                                value={activeDraftTab.rowRole}
                                onChange={(event) => updateDraftTab(activeDraftTab.id, { rowRole: event.target.value })}
                              >
                                <option value="instances">Instances</option>
                                <option value="metadata">Metadata</option>
                              </select>
                            </label>
                            <label>
                              Class name
                              <input
                                value={activeDraftTab.entityType}
                                onChange={(event) => {
                                  const entityType = nameFromLabel(event.target.value, 'importedClass');
                                  updateDraftTab(activeDraftTab.id, {
                                    entityType,
                                    classIri: classForEntity(entityType),
                                    uriTemplate: uriTemplateForEntity(entityType),
                                  });
                                }}
                              />
                            </label>
                            <label>
                              Class IRI
                              <input
                                value={activeDraftTab.classIri}
                                onChange={(event) => updateDraftTab(activeDraftTab.id, { classIri: event.target.value })}
                              />
                            </label>
                            <label>
                              URI template
                              <input
                                value={activeDraftTab.uriTemplate}
                                onChange={(event) => updateDraftTab(activeDraftTab.id, { uriTemplate: event.target.value })}
                              />
                            </label>
                          </div>

                          <div className="data-structure-source-note">
                            Source tab: {activeDraftTab.sourceName}. Header row: {activeDraftTab.headerRowNumber}. Data rows: {activeDraftTab.dataRowCount}.
                          </div>

                          <div className="data-structure-field-table">
                            <div className="data-structure-field-row header">
                              <span>Column</span>
                              <span>Role</span>
                              <span>Field</span>
                              <span>Predicate</span>
                              <span>Type</span>
                              <span>Links to</span>
                            </div>
                            {activeDraftTab.fields.map(field => (
                              <div key={field.id} className={`data-structure-field-row${field.enabled ? '' : ' disabled'}`}>
                                <span>{field.sourceColumn}</span>
                                <label>
                                  <select
                                    value={field.enabled ? field.role : 'ignore'}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      updateDraftField(activeDraftTab.id, field.id, {
                                        enabled: value !== 'ignore',
                                        role: value === 'ignore' ? field.role : value,
                                      });
                                    }}
                                  >
                                    <option value="field">Field</option>
                                    <option value="ignore">Ignore</option>
                                  </select>
                                </label>
                                <label>
                                  <input
                                    value={field.label}
                                    onChange={(event) => {
                                      const label = event.target.value;
                                      updateDraftField(activeDraftTab.id, field.id, {
                                        label,
                                        name: nameFromLabel(label, 'field'),
                                      });
                                    }}
                                  />
                                  <small>{field.name}</small>
                                </label>
                                <label>
                                  <input
                                    value={field.predicate}
                                    onChange={(event) => updateDraftField(activeDraftTab.id, field.id, { predicate: event.target.value })}
                                  />
                                </label>
                                <label>
                                  <select
                                    value={field.inputType}
                                    onChange={(event) => {
                                      const inputType = event.target.value;
                                      const datatype = inputType === 'number'
                                        ? 'xsd:integer'
                                        : inputType === 'date'
                                          ? 'xsd:date'
                                          : 'xsd:string';
                                      updateDraftField(activeDraftTab.id, field.id, {
                                        inputType,
                                        datatype,
                                        parse: inputType === 'number' ? 'int' : '',
                                      });
                                    }}
                                    disabled={!!field.linkTargetEntityType}
                                  >
                                    <option value="text">Text</option>
                                    <option value="textarea">Textarea</option>
                                    <option value="number">Number</option>
                                    <option value="date">Date</option>
                                  </select>
                                  {field.sampleValues.length > 0 && <small>{field.sampleValues.join(' | ')}</small>}
                                </label>
                                <label>
                                  <select
                                    value={field.linkTargetEntityType}
                                    onChange={(event) => updateDraftField(activeDraftTab.id, field.id, { linkTargetEntityType: event.target.value })}
                                  >
                                    <option value="">Literal value</option>
                                    {draftEntityTypes
                                      .filter(entityType => entityType !== activeDraftTab.entityType)
                                      .map(entityType => <option key={entityType} value={entityType}>{entityType}</option>)}
                                  </select>
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>

                        <aside className="data-structure-visual" aria-label="RDF structure visual">
                          {(structureDraft.tabs || []).filter(tab => tab.enabled).map(tab => (
                            <div key={tab.id} className={tab.id === activeDraftTab.id ? 'active' : ''}>
                              <strong>{tab.entityType}</strong>
                              <span>{tab.classIri}</span>
                              <ul>
                                {tab.fields.filter(field => field.enabled && field.role === 'field').slice(0, 8).map(field => (
                                  <li key={field.id}>
                                    {field.label}
                                    {field.linkTargetEntityType && <em>{' -> '}{field.linkTargetEntityType}</em>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </aside>
                      </div>
                    </section>
                  )}
                </section>
              </main>
            </>
          )}
        </div>
        <FloatyConfirmation notice={notice} onClose={clearNotice} />
      </main>
    </OrganisationGate>
  );
}
