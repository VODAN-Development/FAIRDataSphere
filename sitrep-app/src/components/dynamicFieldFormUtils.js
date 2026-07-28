function isGroupField(field) {
  // Backend field kinds collapse several nested/input concepts into the same
  // object-value shape in React state.
  return field.kind === 'group' || field.kind === 'location' || field.kind === 'importClass';
}

function isListField(field) {
  return field.allowMultiple || field.inputType === 'uri-list' || field.inputType === 'text-list';
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

function valueHasContent(value) {
  if (Array.isArray(value)) return value.some(valueHasContent);
  if (value && typeof value === 'object') return Object.values(value).some(valueHasContent);
  return !!value;
}

function groupHasValue(groupValue) {
  return valueHasContent(groupValue);
}

function serializeGroupValue(field, value) {
  // Convert nested React state into compact payloads, dropping empty repeated
  // groups and empty list entries before sending them to GraphQL.
  const serializeSingleGroupValue = (groupValue = {}) => Object.fromEntries(
    Object.entries(groupValue).map(([name, subfieldValue]) => {
      const subfield = (field.subfields || []).find(candidate => candidate.name === name);
      if (isGroupField(subfield || {})) return [name, serializeGroupValue(subfield, subfieldValue)];
      if (subfield?.kind === 'conditional') return [name, serializeConditionalValue(subfield, subfieldValue)];
      if (isListField(subfield || {})) return [name, (subfieldValue || []).filter(Boolean)];
      return [name, subfieldValue];
    })
  );

  if (field.allowMultiple) {
    const values = (Array.isArray(value) ? value : []).map(serializeSingleGroupValue).filter(groupHasValue);
    return values.length ? values : null;
  }

  const values = serializeSingleGroupValue(value || {});
  return groupHasValue(values) ? values : null;
}

function serializeConditionalValue(field, value) {
  // Conditional fields save the selected option plus only the subfield values for
  // that option.
  const conditionalValue = value || {};
  const selectedOption = (field.options || []).find(option => option.name === conditionalValue.selectedOption);
  const values = Object.fromEntries(
    Object.entries(conditionalValue.values || {}).map(([name, subfieldValue]) => {
      const subfield = (selectedOption?.subfields || []).find(candidate => candidate.name === name);
      if (isGroupField(subfield || {})) {
        return [name, serializeGroupValue(subfield, subfieldValue)];
      }
      if (subfield?.kind === 'conditional') return [name, serializeConditionalValue(subfield, subfieldValue)];
      if (isListField(subfield || {})) {
        return [name, (subfieldValue || []).filter(Boolean)];
      }
      return [name, subfieldValue];
    })
  );
  return conditionalValue.selectedOption ? { ...conditionalValue, values } : null;
}

export function emptyValueFor(field) {
  if (field.kind === 'array') return [''];
  if (isGroupField(field)) {
    return field.allowMultiple ? [emptyGroupValueFor(field)] : emptyGroupValueFor(field);
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
      const value = JSON.parse(field.value);
      if (field.kind === 'array') return Array.isArray(value) && value.length ? value : [''];
      if (isGroupField(field) && field.allowMultiple) return Array.isArray(value) && value.length ? value : [emptyGroupValueFor(field)];
      return value || emptyValueFor(field);
    } catch {
      return field.kind === 'array' ? [field.value] : emptyValueFor(field);
    }
  }
  return field.value;
}

export function serializeValue(field, value) {
  // GraphQL expects strings, so arrays/groups/conditionals are JSON-encoded and
  // empty scalar values become null.
  if (field.kind === 'array') return JSON.stringify((value || []).filter(Boolean));
  if (isGroupField(field)) {
    const values = serializeGroupValue(field, value);
    return values ? JSON.stringify(values) : null;
  }
  if (field.kind === 'conditional') {
    const values = serializeConditionalValue(field, value);
    return values ? JSON.stringify(values) : null;
  }
  return value || null;
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
