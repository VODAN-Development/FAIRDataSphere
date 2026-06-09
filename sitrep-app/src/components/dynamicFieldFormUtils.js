function isGroupField(field) {
  return field.kind === 'group' || field.kind === 'location';
}

function isListField(field) {
  return field.allowMultiple || field.inputType === 'uri-list' || field.inputType === 'text-list';
}

function emptyGroupValueFor(field) {
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
  if (!field.value) return emptyValueFor(field);
  if (field.kind === 'array' || field.kind === 'group' || field.kind === 'location' || field.kind === 'conditional') {
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
  const message = error?.message || '';
  const match = message.match(/FIELD_VALIDATION:([^:]+):(.+)$/);
  if (!match) return null;
  return {
    fieldName: match[1],
    message: match[2],
  };
}
