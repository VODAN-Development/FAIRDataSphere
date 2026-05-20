export function emptyValueFor(field) {
  if (field.kind === 'array') return [''];
  if (field.kind === 'group' || field.kind === 'location') {
    return Object.fromEntries((field.subfields || []).map(subfield => [subfield.name, '']));
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
      return value || emptyValueFor(field);
    } catch {
      return field.kind === 'array' ? [field.value] : emptyValueFor(field);
    }
  }
  return field.value;
}

export function serializeValue(field, value) {
  if (field.kind === 'array') return JSON.stringify((value || []).filter(Boolean));
  if (field.kind === 'group' || field.kind === 'location') {
    const groupValue = value || {};
    return Object.values(groupValue).some(Boolean) ? JSON.stringify(groupValue) : null;
  }
  if (field.kind === 'conditional') {
    const conditionalValue = value || {};
    const selectedOption = (field.options || []).find(option => option.name === conditionalValue.selectedOption);
    const values = Object.fromEntries(
      Object.entries(conditionalValue.values || {}).map(([name, subfieldValue]) => {
        const subfield = (selectedOption?.subfields || []).find(candidate => candidate.name === name);
        if (subfield?.allowMultiple || subfield?.inputType === 'uri-list' || subfield?.inputType === 'text-list') {
          return [name, (subfieldValue || []).filter(Boolean)];
        }
        return [name, subfieldValue];
      })
    );
    return conditionalValue.selectedOption ? JSON.stringify({ ...conditionalValue, values }) : null;
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
