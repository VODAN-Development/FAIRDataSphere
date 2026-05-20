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

export function displayValue(field) {
  if (!field.value) return '';
  if (field.kind === 'array') {
    try {
      const value = JSON.parse(field.value);
      return Array.isArray(value) ? value.join(', ') : value;
    } catch {
      return field.value;
    }
  }
  if (field.kind === 'group' || field.kind === 'location') {
    let groupValue;
    try {
      groupValue = JSON.parse(field.value);
    } catch {
      return field.value;
    }
    return (field.subfields || [])
      .map(subfield => {
        const value = groupValue?.[subfield.name];
        return value ? `${subfield.label || subfield.name}: ${value}` : null;
      })
      .filter(Boolean)
      .join(', ');
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
        const display = Array.isArray(value) ? value.filter(Boolean).join(', ') : value;
        return display ? `${subfield.label || subfield.name}: ${display}` : null;
      })
      .filter(Boolean);
    return [optionLabel, ...subfieldValues].filter(Boolean).join(', ');
  }
  return field.value;
}

export function itemTitle(item) {
  const primaryValue = item.fieldValues.find(field => field.value && field.kind === 'scalar')?.value;
  return `Entry #${item.entryNumber}${primaryValue ? `: ${primaryValue}` : ''}`;
}

export function reportTitle(report) {
  return report.fieldValues?.find(field => field.value && field.kind === 'scalar')?.value || `#${report.id}`;
}

export function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return `${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
}
