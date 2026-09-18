function isGroupField(field) {
  // Backend field kinds collapse several nested/input concepts into the same
  // object-value shape in React state.
  return field.kind === 'group' || field.kind === 'location' || field.kind === 'importClass';
}

function isRepeatedField(field) {
  if (!field || typeof field !== 'object') return false;
  if (field.allowMultiple) return true;
  return false;
}

function isListField(field) {
  return field.allowMultiple || field.inputType === 'uri-list' || field.inputType === 'text-list';
}

function isUriField(field) {
  return field?.inputType === 'uri' || field?.inputType === 'uri-list';
}

function compactUriValue(value) {
  if (value === null || value === undefined || value === '') return value;
  if (Array.isArray(value)) return value.map(compactUriValue);
  if (typeof value !== 'string') return value;
  const text = value.trim().replace(/^<|>$/g, '');
  const iriMatch = text.match(/^(https?:\/\/.*[#/])([^#/]+)\/?$/i);
  if (iriMatch) return decodeURIComponent(iriMatch[2]).replace(/_/g, ' ');
  const prefixedMatch = text.match(/^([A-Za-z][\w-]*:)([^:/#]+)$/);
  return prefixedMatch ? prefixedMatch[2].replace(/_/g, ' ') : value;
}

function expandEditedUriValue(originalValue, editedValue) {
  if (editedValue === null || editedValue === undefined || editedValue === '') return editedValue;
  if (Array.isArray(editedValue)) {
    const originals = Array.isArray(originalValue) ? originalValue : [];
    return editedValue.map((value, index) => expandEditedUriValue(originals[index], value));
  }
  if (typeof editedValue !== 'string') return editedValue;
  const editedText = editedValue.trim();
  if (!editedText || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(editedText) || /^<https?:\/\//i.test(editedText)) {
    return editedValue;
  }

  const originalText = typeof originalValue === 'string' ? originalValue.trim().replace(/^<|>$/g, '') : '';
  const iriMatch = originalText.match(/^(https?:\/\/.*[#/])([^#/]+)(\/?)$/i);
  if (iriMatch) return `${iriMatch[1]}${encodeURIComponent(editedText.replace(/\s+/g, '_'))}${iriMatch[3]}`;
  const prefixedMatch = originalText.match(/^([A-Za-z][\w-]*:)([^:/#]+)$/);
  if (prefixedMatch) return `${prefixedMatch[1]}${editedText.replace(/\s+/g, '_')}`;
  return editedValue;
}

function parseStoredValue(field) {
  if (!field?.value) return null;
  try {
    return typeof field.value === 'string' ? JSON.parse(field.value) : field.value;
  } catch {
    return field.value;
  }
}

function emptyGroupValueFor(field) {
  // Build an editable object for every subfield so controlled inputs can render
  // before the user has entered any values.
  return Object.fromEntries((field.subfields || []).map(subfield => [
    subfield.name,
    isGroupField(subfield)
      ? (subfield.allowMultiple ? [emptyGroupValueFor(subfield)] : emptyGroupValueFor(subfield))
      : subfield.kind === 'conditional'
        ? { selectedOption: '', values: {} }
        : isListField(subfield) ? [''] : '',
  ]));
}

function isOptionalImportedClass(field) {
  return field?.inputType === 'import-class' && !field.required;
}

function valueHasContent(value) {
  if (Array.isArray(value)) return value.some(valueHasContent);
  if (value && typeof value === 'object') return Object.values(value).some(valueHasContent);
  return !!value;
}

function groupHasValue(groupValue) {
  return valueHasContent(groupValue);
}

function normalizeGroupValueForEdit(field, value) {
  const normalizeSingleGroupValue = (groupValue = {}) => {
    const normalizedValue = Object.fromEntries(Object.entries(groupValue).filter(([name]) => name !== 'id').map(([name, subfieldValue]) => {
      const subfield = (field.subfields || []).find(candidate => candidate.name === name);
      if (isGroupField(subfield || {})) return [name, normalizeGroupValueForEdit(subfield, subfieldValue)];
      if (subfield?.kind === 'conditional') return [name, normalizeConditionalValueForEdit(subfield, subfieldValue)];
      if (isUriField(subfield)) return [name, compactUriValue(subfieldValue)];
      if (isListField(subfield || {})) return [name, subfieldValue || ['']];
      return [name, subfieldValue];
    }));
    if (groupHasValue(normalizedValue) && groupValue.id !== undefined) {
      return { ...normalizedValue, id: groupValue.id };
    }
    return normalizedValue;
  };

  if (isRepeatedField(field)) {
    const normalizedValues = Array.isArray(value) && value.length
      ? value.map(normalizeSingleGroupValue).filter(groupHasValue)
      : [];
    return normalizedValues;
  }
  if (isOptionalImportedClass(field) && !value) return null;
  if (isOptionalImportedClass(field)) {
    const normalizedValue = normalizeSingleGroupValue(value || {});
    return groupHasValue(normalizedValue) ? normalizedValue : null;
  }
  return value ? normalizeSingleGroupValue(value) : emptyGroupValueFor(field);
}

function normalizeConditionalValueForEdit(field, value) {
  const conditionalValue = value || { selectedOption: '', values: {} };
  const selectedOption = (field.options || []).find(option => option.name === conditionalValue.selectedOption);
  const values = Object.fromEntries(
    Object.entries(conditionalValue.values || {}).map(([name, subfieldValue]) => {
      const subfield = (selectedOption?.subfields || []).find(candidate => candidate.name === name);
      if (isGroupField(subfield || {})) return [name, normalizeGroupValueForEdit(subfield, subfieldValue)];
      if (subfield?.kind === 'conditional') return [name, normalizeConditionalValueForEdit(subfield, subfieldValue)];
      if (isUriField(subfield)) return [name, compactUriValue(subfieldValue)];
      if (isListField(subfield || {})) return [name, subfieldValue || ['']];
      return [name, subfieldValue];
    })
  );
  return { ...conditionalValue, values };
}

function serializeGroupValue(field, value, originalValue = parseStoredValue(field)) {
  // Convert nested React state into compact payloads, dropping empty repeated
  // groups and empty list entries before sending them to GraphQL.
  const serializeSingleGroupValue = (groupValue = {}, originalGroupValue = {}) => Object.fromEntries(
    Object.entries(groupValue).map(([name, subfieldValue]) => {
      const subfield = (field.subfields || []).find(candidate => candidate.name === name);
      if (isGroupField(subfield || {})) return [name, serializeGroupValue(subfield, subfieldValue, originalGroupValue?.[name])];
      if (subfield?.kind === 'conditional') return [name, serializeConditionalValue(subfield, subfieldValue, originalGroupValue?.[name])];
      if (isUriField(subfield)) return [name, expandEditedUriValue(originalGroupValue?.[name], isListField(subfield) ? (subfieldValue || []).filter(Boolean) : subfieldValue)];
      if (isListField(subfield || {})) return [name, (subfieldValue || []).filter(Boolean)];
      return [name, subfieldValue];
    })
  );

  if (isRepeatedField(field)) {
    const originalGroups = Array.isArray(originalValue) ? originalValue : [];
    const values = (Array.isArray(value) ? value : [])
      .map((groupValue, index) => serializeSingleGroupValue(groupValue, originalGroups[index]))
      .filter(groupHasValue);
    return values.length ? values : null;
  }

  const values = serializeSingleGroupValue(value || {}, originalValue || {});
  return groupHasValue(values) ? values : null;
}

function serializeConditionalValue(field, value, originalValue = parseStoredValue(field)) {
  // Conditional fields save the selected option plus only the subfield values for
  // that option.
  const conditionalValue = value || {};
  const originalConditionalValue = originalValue || {};
  const selectedOption = (field.options || []).find(option => option.name === conditionalValue.selectedOption);
  const values = Object.fromEntries(
    Object.entries(conditionalValue.values || {}).map(([name, subfieldValue]) => {
      const subfield = (selectedOption?.subfields || []).find(candidate => candidate.name === name);
      if (isGroupField(subfield || {})) {
        return [name, serializeGroupValue(subfield, subfieldValue, originalConditionalValue.values?.[name])];
      }
      if (subfield?.kind === 'conditional') return [name, serializeConditionalValue(subfield, subfieldValue, originalConditionalValue.values?.[name])];
      if (isUriField(subfield)) return [name, expandEditedUriValue(originalConditionalValue.values?.[name], isListField(subfield) ? (subfieldValue || []).filter(Boolean) : subfieldValue)];
      if (isListField(subfield || {})) return [name, (subfieldValue || []).filter(Boolean)];
      return [name, subfieldValue];
    })
  );
  return conditionalValue.selectedOption ? { ...conditionalValue, values } : null;
}

export function emptyValueFor(field) {
  if (field.kind === 'array') return [''];
  if (isGroupField(field)) {
    if (isOptionalImportedClass(field)) return isRepeatedField(field) ? [] : null;
    return isRepeatedField(field) ? [emptyGroupValueFor(field)] : emptyGroupValueFor(field);
  }
  if (field.kind === 'conditional') return { selectedOption: '', values: {} };
  return '';
}

export function parseValueForEdit(field) {
  // The API stores complex field values as JSON strings; edit forms need them
  // parsed back into arrays/objects that match the dynamic form shape.
  if (!field.value) return emptyValueFor(field);
  if (field.kind === 'array' || field.kind === 'group' || field.kind === 'location' || field.kind === 'importClass' || field.kind === 'conditional') {
    try {
      const value = typeof field.value === 'string' ? JSON.parse(field.value) : field.value;
      if (field.kind === 'array') {
        const values = Array.isArray(value) && value.length ? value : [''];
        return isUriField(field) ? compactUriValue(values) : values;
      }
      if (isGroupField(field)) return normalizeGroupValueForEdit(field, value);
      if (field.kind === 'conditional') return normalizeConditionalValueForEdit(field, value);
      return value || emptyValueFor(field);
    } catch {
      return field.kind === 'array' ? [isUriField(field) ? compactUriValue(field.value) : field.value] : emptyValueFor(field);
    }
  }
  return isUriField(field) ? compactUriValue(field.value) : field.value;
}

export function serializeValue(field, value) {
  // GraphQL expects strings, so arrays/groups/conditionals are JSON-encoded and
  // empty scalar values become null.
  if (field.kind === 'array') {
    const values = (value || []).filter(Boolean);
    return JSON.stringify(isUriField(field) ? expandEditedUriValue(parseStoredValue(field), values) : values);
  }
  if (isGroupField(field)) {
    const values = serializeGroupValue(field, value);
    return values ? JSON.stringify(values) : null;
  }
  if (field.kind === 'conditional') {
    const values = serializeConditionalValue(field, value);
    return values ? JSON.stringify(values) : null;
  }
  const nextValue = isUriField(field) ? expandEditedUriValue(field.value, value) : value;
  return nextValue || null;
}

export function formValuesFromFields(fields) {
  return Object.fromEntries((fields || []).map(field => [field.name, parseValueForEdit(field)]));
}

export function fieldInputsPayload(fields, values) {
  return (fields || []).map(field => ({
    name: field.name,
    value: serializeValue(field, values[field.name]),
  }));
}

export function fieldValidationFromError(error) {
  // Backend field validation errors encode the field name so the form can attach
  // browser-native validity feedback to the right input.
  const message = error?.message || '';
  const match = message.match(/FIELD_VALIDATION:([^:]+):(.+)$/);
  if (!match) return null;
  return {
    fieldName: match[1],
    message: match[2],
  };
}
