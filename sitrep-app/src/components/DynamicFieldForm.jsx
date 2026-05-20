import { useEffect, useRef } from 'react';

export function DynamicFieldInputs({ fields, values, onChange, disabled = false, fieldErrors = {}, onFieldErrorClear }) {
  const inputRefs = useRef(new Map());

  useEffect(() => {
    inputRefs.current.forEach((input, name) => {
      input?.setCustomValidity(fieldErrors[name] || '');
    });
    const firstErrorName = Object.keys(fieldErrors)[0];
    if (firstErrorName) {
      inputRefs.current.get(firstErrorName)?.reportValidity();
    }
  }, [fieldErrors]);

  const registerInput = (name) => (input) => {
    if (input) {
      inputRefs.current.set(name, input);
      input.setCustomValidity(fieldErrors[name] || '');
    } else {
      inputRefs.current.delete(name);
    }
  };

  const clearFieldError = (name) => {
    if (fieldErrors[name]) {
      onFieldErrorClear?.(name);
    }
  };

  const updateValue = (name, value) => {
    clearFieldError(name);
    onChange({ ...values, [name]: value });
  };

  const inputTypeForField = (field) => {
    if (field.inputType === 'number' || field.datatype === 'xsd:integer' || field.datatype === 'xsd:decimal') return 'number';
    if (field.inputType === 'date' || field.datatype === 'xsd:date') return 'date';
    if (field.inputType === 'datetime' || field.datatype === 'xsd:dateTime') return 'datetime-local';
    return 'text';
  };

  const updateListValue = (name, index, value) => {
    const current = [...(values[name] || [''])];
    current[index] = value;
    updateValue(name, current);
  };

  const addListValue = (name) => {
    updateValue(name, [...(values[name] || []), '']);
  };

  const removeListValue = (name, index) => {
    updateValue(name, (values[name] || []).filter((_, i) => i !== index));
  };

  const updateConditionalOption = (field, selectedOption) => {
    updateValue(field.name, { selectedOption, values: {} });
  };

  const updateConditionalSubfield = (field, subfieldName, value) => {
    clearFieldError(subfieldName);
    const current = values[field.name] || { selectedOption: '', values: {} };
    updateValue(field.name, {
      ...current,
      values: {
        ...(current.values || {}),
        [subfieldName]: value,
      },
    });
  };

  const updateConditionalListSubfield = (field, subfieldName, index, value) => {
    const current = values[field.name] || { selectedOption: '', values: {} };
    const currentValues = [...(current.values?.[subfieldName] || [''])];
    currentValues[index] = value;
    updateConditionalSubfield(field, subfieldName, currentValues);
  };

  const addConditionalListSubfield = (field, subfieldName) => {
    const current = values[field.name] || { selectedOption: '', values: {} };
    updateConditionalSubfield(field, subfieldName, [...(current.values?.[subfieldName] || ['']), '']);
  };

  const removeConditionalListSubfield = (field, subfieldName, index) => {
    const current = values[field.name] || { selectedOption: '', values: {} };
    updateConditionalSubfield(
      field,
      subfieldName,
      (current.values?.[subfieldName] || []).filter((_, valueIndex) => valueIndex !== index)
    );
  };

  return (
    <>
      {(fields || []).map(field => (
        <div key={field.name} className="form-group">
          <label htmlFor={field.name}>{field.label || field.name}:</label>

          {field.kind === 'conditional' ? (
            <>
              <select
                id={field.name}
                value={values[field.name]?.selectedOption || ''}
                onChange={(e) => updateConditionalOption(field, e.target.value)}
                required={field.required}
                disabled={disabled}
              >
                <option value="">-- select --</option>
                {(field.options || []).map(option => (
                  <option key={option.name} value={option.name}>{option.label || option.name}</option>
                ))}
              </select>

              {(() => {
                const selectedOption = (field.options || []).find(option => option.name === values[field.name]?.selectedOption);
                if (!selectedOption) return null;
                return (
                  <div className="conditional-subfields">
                    {(selectedOption.subfields || []).map(subfield => (
                      <div key={subfield.name} className="form-group">
                        <label htmlFor={`${field.name}-${subfield.name}`}>{subfield.label || subfield.name}:</label>
                        {subfield.allowMultiple || subfield.inputType === 'uri-list' || subfield.inputType === 'text-list' ? (
                          <>
                            {(values[field.name]?.values?.[subfield.name] || ['']).map((value, index) => (
                              <div key={index} className="input-with-button">
                                <input
                                  ref={index === 0 ? registerInput(subfield.name) : undefined}
                                  id={`${field.name}-${subfield.name}-${index}`}
                                  type="text"
                                  value={value}
                                  onChange={(e) => updateConditionalListSubfield(field, subfield.name, index, e.target.value)}
                                  disabled={disabled}
                                />
                                {(values[field.name]?.values?.[subfield.name] || []).length > 1 && (
                                  <button type="button" onClick={() => removeConditionalListSubfield(field, subfield.name, index)} disabled={disabled}>x</button>
                                )}
                              </div>
                            ))}
                            <button type="button" onClick={() => addConditionalListSubfield(field, subfield.name)} className="secondary-btn" disabled={disabled}>
                              + Add {subfield.label || subfield.name}
                            </button>
                          </>
                        ) : subfield.inputType === 'textarea' ? (
                          <textarea
                            ref={registerInput(subfield.name)}
                            id={`${field.name}-${subfield.name}`}
                            value={values[field.name]?.values?.[subfield.name] || ''}
                            onChange={(e) => updateConditionalSubfield(field, subfield.name, e.target.value)}
                            rows="4"
                            disabled={disabled}
                          />
                        ) : (
                          <input
                            ref={registerInput(subfield.name)}
                            id={`${field.name}-${subfield.name}`}
                            type={subfield.inputType === 'date' ? 'date' : subfield.inputType === 'number' ? 'number' : 'text'}
                            value={values[field.name]?.values?.[subfield.name] || ''}
                            onChange={(e) => updateConditionalSubfield(field, subfield.name, e.target.value)}
                            disabled={disabled}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          ) : field.kind === 'array' ? (
            <>
              {(values[field.name] || ['']).map((value, index) => (
                <div key={index} className="input-with-button">
                  <input
                    ref={index === 0 ? registerInput(field.name) : undefined}
                    id={`${field.name}-${index}`}
                    type="text"
                    value={value}
                    onChange={(e) => updateListValue(field.name, index, e.target.value)}
                    required={field.required}
                    disabled={disabled}
                  />
                  {(values[field.name] || []).length > 1 && (
                    <button type="button" onClick={() => removeListValue(field.name, index)} disabled={disabled}>x</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => addListValue(field.name)} className="secondary-btn" disabled={disabled}>
                + Add {field.label || field.name}
              </button>
            </>
          ) : field.kind === 'group' || field.kind === 'location' ? (
            <div className="coordinates">
              {(field.subfields || []).map((subfield) => (
                <input
                  ref={registerInput(subfield.name)}
                  key={subfield.name}
                  type={inputTypeForField(subfield)}
                  step={inputTypeForField(subfield) === 'number' ? '0.0001' : undefined}
                  placeholder={subfield.label || subfield.name}
                  value={values[field.name]?.[subfield.name] || ''}
                  onChange={(e) => updateValue(field.name, { ...values[field.name], [subfield.name]: e.target.value })}
                  disabled={disabled}
                />
              ))}
            </div>
          ) : field.inputType === 'textarea' ? (
            <textarea
              ref={registerInput(field.name)}
              id={field.name}
              value={values[field.name] || ''}
              onChange={(e) => updateValue(field.name, e.target.value)}
              required={field.required}
              rows="4"
              disabled={disabled}
            />
          ) : (
            <input
              ref={registerInput(field.name)}
              id={field.name}
              type={field.inputType === 'date' ? 'date' : field.inputType === 'number' ? 'number' : 'text'}
              value={values[field.name] || ''}
              onChange={(e) => updateValue(field.name, e.target.value)}
              required={field.required}
              disabled={disabled}
            />
          )}
        </div>
      ))}
    </>
  );
}
