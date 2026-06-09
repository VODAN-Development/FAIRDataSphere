export function notifyReportsUpdated() {
  window.dispatchEvent(new Event('reportsUpdated'));
  const currentValue = localStorage.getItem('reportsUpdated');
  localStorage.setItem('reportsUpdated', currentValue === '1' ? '0' : '1');
}

export function titleForEntity(entityType) {
  return String(entityType || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, char => char.toUpperCase());
}

function compactUri(value) {
  const text = String(value || '');
  const match = text.match(/^(https?:\/\/[^#]+[#/])([^#/]+)$/);
  return match ? decodeURIComponent(match[2]).replace(/_/g, ' ') : text;
}

export function displayValue(field) {
  if (!field.value) return '';
  if (field.kind === 'array') {
    try {
      const value = JSON.parse(field.value);
      return Array.isArray(value) ? value.map(compactUri).join(', ') : compactUri(value);
    } catch {
      return compactUri(field.value);
    }
  }
  if (field.kind === 'group' || field.kind === 'location' || field.kind === 'importClass') {
    let groupValue;
    try {
      groupValue = JSON.parse(field.value);
    } catch {
      return field.value;
    }
    const displayGroup = (valueGroup) => (field.subfields || [])
      .map(subfield => {
        const value = valueGroup?.[subfield.name];
        const display = Array.isArray(value) ? value.map(compactUri).join(', ') : compactUri(value);
        return display ? `${subfield.label || subfield.name}: ${display}` : null;
      })
      .filter(Boolean)
      .join(', ');
    return (Array.isArray(groupValue) ? groupValue : [groupValue])
      .map(displayGroup)
      .filter(Boolean)
      .join('; ');
  }
  if (field.kind === 'conditional') {
    let conditionalValue;
    try {
      conditionalValue = JSON.parse(field.value);
    } catch {
      return field.value;
    }
    const option = (field.options || []).find(candidate => candidate.name === conditionalValue?.selectedOption);
    const optionLabel = option?.label || conditionalValue?.selectedOption;
    const subfieldValues = (option?.subfields || [])
      .map(subfield => {
        const value = conditionalValue?.values?.[subfield.name];
        const display = Array.isArray(value) ? value.filter(Boolean).map(compactUri).join(', ') : compactUri(value);
        return display ? `${subfield.label || subfield.name}: ${display}` : null;
      })
      .filter(Boolean);
    return [optionLabel, ...subfieldValues].filter(Boolean).join(', ');
  }
  return compactUri(field.value);
}

export function itemTitle(item) {
  const primaryField = item.fieldValues.find(field => field.value && field.kind === 'scalar');
  const primaryValue = primaryField ? displayValue(primaryField) : '';
  return `Entry #${item.entryNumber}${primaryValue ? `: ${primaryValue}` : ''}`;
}

export function reportTitle(report) {
  const primaryField = report.fieldValues?.find(field => field.value && field.kind === 'scalar');
  return primaryField ? displayValue(primaryField) : `#${report.id}`;
}

export function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return `${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
}
