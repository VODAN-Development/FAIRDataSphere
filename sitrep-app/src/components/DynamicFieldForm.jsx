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

  const isListField = (field) => (
    field.allowMultiple || field.inputType === 'uri-list' || field.inputType === 'text-list'
  );

  const isGroupField = (field) => field.kind === 'group' || field.kind === 'location';

  const emptyGroupValue = (field) => Object.fromEntries((field.subfields || []).map(subfield => [
    subfield.name,
    isListField(subfield) ? [''] : '',
  ]));

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

  const updateGroupSubfield = (field, subfieldName, value) => {
    clearFieldError(subfieldName);
    updateValue(field.name, {
      ...(values[field.name] || {}),
      [subfieldName]: value,
    });
  };

  const updateGroupListSubfield = (field, subfieldName, index, value) => {
    const currentValues = [...(values[field.name]?.[subfieldName] || [''])];
    currentValues[index] = value;
    updateGroupSubfield(field, subfieldName, currentValues);
  };

  const addGroupListSubfield = (field, subfieldName) => {
    updateGroupSubfield(field, subfieldName, [...(values[field.name]?.[subfieldName] || ['']), '']);
  };

  const removeGroupListSubfield = (field, subfieldName, index) => {
    updateGroupSubfield(
      field,
      subfieldName,
      (values[field.name]?.[subfieldName] || []).filter((_, valueIndex) => valueIndex !== index)
    );
  };

  const updateRepeatedGroupSubfield = (field, groupIndex, subfieldName, value) => {
    const currentGroups = [...(values[field.name] || [emptyGroupValue(field)])];
    currentGroups[groupIndex] = {
      ...(currentGroups[groupIndex] || {}),
      [subfieldName]: value,
    };
    updateValue(field.name, currentGroups);
  };

  const updateRepeatedGroupListSubfield = (field, groupIndex, subfieldName, valueIndex, value) => {
    const currentGroups = [...(values[field.name] || [emptyGroupValue(field)])];
    const currentGroup = { ...(currentGroups[groupIndex] || {}) };
    const currentValues = [...(currentGroup[subfieldName] || [''])];
    currentValues[valueIndex] = value;
    currentGroups[groupIndex] = { ...currentGroup, [subfieldName]: currentValues };
    updateValue(field.name, currentGroups);
  };

  const addRepeatedGroupListSubfield = (field, groupIndex, subfieldName) => {
    const currentGroups = [...(values[field.name] || [emptyGroupValue(field)])];
    const currentGroup = { ...(currentGroups[groupIndex] || {}) };
    currentGroups[groupIndex] = { ...currentGroup, [subfieldName]: [...(currentGroup[subfieldName] || ['']), ''] };
    updateValue(field.name, currentGroups);
  };

  const removeRepeatedGroupListSubfield = (field, groupIndex, subfieldName, valueIndex) => {
    const currentGroups = [...(values[field.name] || [emptyGroupValue(field)])];
    const currentGroup = { ...(currentGroups[groupIndex] || {}) };
    currentGroups[groupIndex] = {
      ...currentGroup,
      [subfieldName]: (currentGroup[subfieldName] || []).filter((_, index) => index !== valueIndex),
    };
    updateValue(field.name, currentGroups);
  };

  const addRepeatedGroupValue = (field) => {
    updateValue(field.name, [...(values[field.name] || []), emptyGroupValue(field)]);
  };

  const removeRepeatedGroupValue = (field, groupIndex) => {
    updateValue(field.name, (values[field.name] || []).filter((_, index) => index !== groupIndex));
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

  const updateConditionalGroupSubfield = (field, groupField, groupIndex, subfieldName, value) => {
    const current = values[field.name] || { selectedOption: '', values: {} };
    if (groupField.allowMultiple) {
      const currentGroups = [...(current.values?.[groupField.name] || [emptyGroupValue(groupField)])];
      currentGroups[groupIndex] = {
        ...(currentGroups[groupIndex] || {}),
        [subfieldName]: value,
      };
      updateConditionalSubfield(field, groupField.name, currentGroups);
      return;
    }
    updateConditionalSubfield(field, groupField.name, {
      ...(current.values?.[groupField.name] || {}),
      [subfieldName]: value,
    });
  };

  const updateConditionalGroupListSubfield = (field, groupField, groupIndex, subfieldName, valueIndex, value) => {
    const current = values[field.name] || { selectedOption: '', values: {} };
    const currentGroupValue = groupField.allowMultiple
      ? [...(current.values?.[groupField.name] || [emptyGroupValue(groupField)])]
      : [{ ...(current.values?.[groupField.name] || {}) }];
    const currentGroup = { ...(currentGroupValue[groupIndex] || {}) };
    const currentValues = [...(currentGroup[subfieldName] || [''])];
    currentValues[valueIndex] = value;
    currentGroupValue[groupIndex] = { ...currentGroup, [subfieldName]: currentValues };
    updateConditionalSubfield(field, groupField.name, groupField.allowMultiple ? currentGroupValue : currentGroupValue[0]);
  };

  const addConditionalGroupListSubfield = (field, groupField, groupIndex, subfieldName) => {
    const current = values[field.name] || { selectedOption: '', values: {} };
    const currentGroupValue = groupField.allowMultiple
      ? [...(current.values?.[groupField.name] || [emptyGroupValue(groupField)])]
      : [{ ...(current.values?.[groupField.name] || {}) }];
    const currentGroup = { ...(currentGroupValue[groupIndex] || {}) };
    currentGroupValue[groupIndex] = { ...currentGroup, [subfieldName]: [...(currentGroup[subfieldName] || ['']), ''] };
    updateConditionalSubfield(field, groupField.name, groupField.allowMultiple ? currentGroupValue : currentGroupValue[0]);
  };

  const removeConditionalGroupListSubfield = (field, groupField, groupIndex, subfieldName, valueIndex) => {
    const current = values[field.name] || { selectedOption: '', values: {} };
    const currentGroupValue = groupField.allowMultiple
      ? [...(current.values?.[groupField.name] || [emptyGroupValue(groupField)])]
      : [{ ...(current.values?.[groupField.name] || {}) }];
    const currentGroup = { ...(currentGroupValue[groupIndex] || {}) };
    currentGroupValue[groupIndex] = {
      ...currentGroup,
      [subfieldName]: (currentGroup[subfieldName] || []).filter((_, index) => index !== valueIndex),
    };
    updateConditionalSubfield(field, groupField.name, groupField.allowMultiple ? currentGroupValue : currentGroupValue[0]);
  };

  const addConditionalGroupValue = (field, groupField) => {
    const current = values[field.name] || { selectedOption: '', values: {} };
    updateConditionalSubfield(field, groupField.name, [...(current.values?.[groupField.name] || []), emptyGroupValue(groupField)]);
  };

  const removeConditionalGroupValue = (field, groupField, groupIndex) => {
    const current = values[field.name] || { selectedOption: '', values: {} };
    updateConditionalSubfield(
      field,
      groupField.name,
      (current.values?.[groupField.name] || []).filter((_, index) => index !== groupIndex)
    );
  };

  const renderGroupSubfields = ({
    field,
    groupValue,
    idPrefix,
    onSubfieldChange,
    onListSubfieldChange,
    onAddListSubfield,
    onRemoveListSubfield,
  }) => (
    (field.subfields || []).map((subfield) => (
      isGroupField(subfield) ? (
        <div key={subfield.name} className={subfield.inputType === 'import-class' ? 'imported-class-input' : 'coordinates'}>
          <div className="imported-class-heading">
            <span>{subfield.label || subfield.name}</span>
            {subfield.targetEntityType && <small>{subfield.targetEntityType}</small>}
          </div>
          {(subfield.allowMultiple
            ? (Array.isArray(groupValue?.[subfield.name]) ? groupValue[subfield.name] : [emptyGroupValue(subfield)])
            : [groupValue?.[subfield.name] || emptyGroupValue(subfield)]
          ).map((nestedGroupValue, nestedGroupIndex) => {
            const setNestedGroupValue = (nextNestedGroupValue) => {
              if (subfield.allowMultiple) {
                const currentValues = Array.isArray(groupValue?.[subfield.name])
                  ? [...groupValue[subfield.name]]
                  : [emptyGroupValue(subfield)];
                currentValues[nestedGroupIndex] = nextNestedGroupValue;
                onSubfieldChange(subfield.name, currentValues);
                return;
              }
              onSubfieldChange(subfield.name, nextNestedGroupValue);
            };
            return (
              <div key={nestedGroupIndex} className="imported-class-instance">
                {subfield.allowMultiple && (groupValue?.[subfield.name] || []).length > 1 && (
                  <button
                    type="button"
                    className="delete-btn"
                    onClick={() => {
                      const currentValues = Array.isArray(groupValue?.[subfield.name]) ? groupValue[subfield.name] : [];
                      onSubfieldChange(subfield.name, currentValues.filter((_, index) => index !== nestedGroupIndex));
                    }}
                    disabled={disabled}
                  >
                    Remove
                  </button>
                )}
                {renderGroupSubfields({
                  field: subfield,
                  groupValue: nestedGroupValue,
                  idPrefix: `${idPrefix}-${subfield.name}-${nestedGroupIndex}`,
                  onSubfieldChange: (nestedName, value) => setNestedGroupValue({
                    ...(nestedGroupValue || {}),
                    [nestedName]: value,
                  }),
                  onListSubfieldChange: (nestedName, valueIndex, value) => {
                    const currentValues = [...(nestedGroupValue?.[nestedName] || [''])];
                    currentValues[valueIndex] = value;
                    setNestedGroupValue({ ...(nestedGroupValue || {}), [nestedName]: currentValues });
                  },
                  onAddListSubfield: (nestedName) => {
                    setNestedGroupValue({
                      ...(nestedGroupValue || {}),
                      [nestedName]: [...(nestedGroupValue?.[nestedName] || ['']), ''],
                    });
                  },
                  onRemoveListSubfield: (nestedName, valueIndex) => {
                    setNestedGroupValue({
                      ...(nestedGroupValue || {}),
                      [nestedName]: (nestedGroupValue?.[nestedName] || []).filter((_, index) => index !== valueIndex),
                    });
                  },
                })}
              </div>
            );
          })}
          {subfield.allowMultiple && (
            <button
              type="button"
              onClick={() => {
                const currentValues = Array.isArray(groupValue?.[subfield.name]) ? groupValue[subfield.name] : [];
                onSubfieldChange(subfield.name, [...currentValues, emptyGroupValue(subfield)]);
              }}
              className="secondary-btn"
              disabled={disabled}
            >
              + Add {subfield.label || subfield.name}
            </button>
          )}
        </div>
      ) : subfield.kind === 'conditional' ? (
        <div key={subfield.name} className="form-group">
          <label htmlFor={`${idPrefix}-${subfield.name}`}>{subfield.label || subfield.name}:</label>
          <select
            id={`${idPrefix}-${subfield.name}`}
            value={groupValue?.[subfield.name]?.selectedOption || ''}
            onChange={(e) => onSubfieldChange(subfield.name, { selectedOption: e.target.value, values: {} })}
            disabled={disabled}
          >
            <option value="">-- select --</option>
            {(subfield.options || []).map(option => (
              <option key={option.name} value={option.name}>{option.label || option.name}</option>
            ))}
          </select>
          {(() => {
            const selectedOption = (subfield.options || []).find(option => option.name === groupValue?.[subfield.name]?.selectedOption);
            if (!selectedOption) return null;
            const conditionalValue = groupValue?.[subfield.name] || { selectedOption: '', values: {} };
            const setConditionalValues = (nextValues) => {
              onSubfieldChange(subfield.name, {
                ...conditionalValue,
                values: nextValues,
              });
            };
            return (
              <div className="conditional-subfields">
                {renderGroupSubfields({
                  field: { ...selectedOption, subfields: selectedOption.subfields || [] },
                  groupValue: conditionalValue.values || {},
                  idPrefix: `${idPrefix}-${subfield.name}-${selectedOption.name}`,
                  onSubfieldChange: (conditionalName, value) => setConditionalValues({
                    ...(conditionalValue.values || {}),
                    [conditionalName]: value,
                  }),
                  onListSubfieldChange: (conditionalName, valueIndex, value) => {
                    const currentValues = [...(conditionalValue.values?.[conditionalName] || [''])];
                    currentValues[valueIndex] = value;
                    setConditionalValues({ ...(conditionalValue.values || {}), [conditionalName]: currentValues });
                  },
                  onAddListSubfield: (conditionalName) => {
                    setConditionalValues({
                      ...(conditionalValue.values || {}),
                      [conditionalName]: [...(conditionalValue.values?.[conditionalName] || ['']), ''],
                    });
                  },
                  onRemoveListSubfield: (conditionalName, valueIndex) => {
                    setConditionalValues({
                      ...(conditionalValue.values || {}),
                      [conditionalName]: (conditionalValue.values?.[conditionalName] || []).filter((_, index) => index !== valueIndex),
                    });
                  },
                })}
              </div>
            );
          })()}
        </div>
      ) : isListField(subfield) ? (
        <div key={subfield.name} className="form-group">
          <label htmlFor={`${idPrefix}-${subfield.name}-0`}>{subfield.label || subfield.name}:</label>
          {(groupValue?.[subfield.name] || ['']).map((value, index) => (
            <div key={index} className="input-with-button">
              <input
                ref={index === 0 ? registerInput(subfield.name) : undefined}
                id={`${idPrefix}-${subfield.name}-${index}`}
                type="text"
                value={value}
                onChange={(e) => onListSubfieldChange(subfield.name, index, e.target.value)}
                disabled={disabled}
              />
              {(groupValue?.[subfield.name] || []).length > 1 && (
                <button type="button" onClick={() => onRemoveListSubfield(subfield.name, index)} disabled={disabled}>x</button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => onAddListSubfield(subfield.name)} className="secondary-btn" disabled={disabled}>
            + Add {subfield.label || subfield.name}
          </button>
        </div>
      ) : (
        <div key={subfield.name} className="form-group">
          <label htmlFor={`${idPrefix}-${subfield.name}`}>{subfield.label || subfield.name}:</label>
          <input
            ref={registerInput(subfield.name)}
            id={`${idPrefix}-${subfield.name}`}
            type={inputTypeForField(subfield)}
            step={inputTypeForField(subfield) === 'number' ? '0.0001' : undefined}
            value={groupValue?.[subfield.name] || ''}
            onChange={(e) => onSubfieldChange(subfield.name, e.target.value)}
            disabled={disabled}
          />
        </div>
      )
    ))
  );

  return (
    <>
      {(fields || []).map(field => (
        <div key={field.name} className="form-group">
          {field.inputType !== 'import-class' && (
            <label htmlFor={field.name}>{field.label || field.name}:</label>
          )}

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
                        {isGroupField(subfield) ? (
                          <div className={subfield.inputType === 'import-class' ? 'imported-class-input' : 'coordinates'}>
                            <div className="imported-class-heading">
                              <span>{subfield.label || subfield.name}</span>
                              {subfield.targetEntityType && <small>{subfield.targetEntityType}</small>}
                            </div>
                            {(subfield.allowMultiple
                              ? (values[field.name]?.values?.[subfield.name] || [emptyGroupValue(subfield)])
                              : [values[field.name]?.values?.[subfield.name] || emptyGroupValue(subfield)]
                            ).map((groupValue, groupIndex) => (
                              <div key={groupIndex} className="imported-class-instance">
                                {subfield.allowMultiple && (values[field.name]?.values?.[subfield.name] || []).length > 1 && (
                                  <button
                                    type="button"
                                    className="delete-btn"
                                    onClick={() => removeConditionalGroupValue(field, subfield, groupIndex)}
                                    disabled={disabled}
                                  >
                                    Remove
                                  </button>
                                )}
                                {renderGroupSubfields({
                                  field: subfield,
                                  groupValue,
                                  idPrefix: `${field.name}-${subfield.name}-${groupIndex}`,
                                  onSubfieldChange: (subfieldName, value) => updateConditionalGroupSubfield(field, subfield, groupIndex, subfieldName, value),
                                  onListSubfieldChange: (subfieldName, valueIndex, value) => updateConditionalGroupListSubfield(field, subfield, groupIndex, subfieldName, valueIndex, value),
                                  onAddListSubfield: (subfieldName) => addConditionalGroupListSubfield(field, subfield, groupIndex, subfieldName),
                                  onRemoveListSubfield: (subfieldName, valueIndex) => removeConditionalGroupListSubfield(field, subfield, groupIndex, subfieldName, valueIndex),
                                })}
                              </div>
                            ))}
                            {subfield.allowMultiple && (
                              <button type="button" onClick={() => addConditionalGroupValue(field, subfield)} className="secondary-btn" disabled={disabled}>
                                + Add {subfield.label || subfield.name}
                              </button>
                            )}
                          </div>
                        ) : (
                          <>
                        <label htmlFor={`${field.name}-${subfield.name}`}>{subfield.label || subfield.name}:</label>
                        {isListField(subfield) ? (
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
                          </>
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
            <div className={field.inputType === 'import-class' ? 'imported-class-input' : 'coordinates'}>
              {field.inputType === 'import-class' && (
                <div className="imported-class-heading">
                  <span>{field.label || field.name}</span>
                  {field.targetEntityType && <small>{field.targetEntityType}</small>}
                </div>
              )}
              {(field.allowMultiple ? (values[field.name] || [emptyGroupValue(field)]) : [values[field.name] || emptyGroupValue(field)]).map((groupValue, groupIndex) => (
                <div key={groupIndex} className="imported-class-instance">
                  {field.allowMultiple && (values[field.name] || []).length > 1 && (
                    <button type="button" className="delete-btn" onClick={() => removeRepeatedGroupValue(field, groupIndex)} disabled={disabled}>Remove</button>
                  )}
                  {renderGroupSubfields({
                    field,
                    groupValue,
                    idPrefix: `${field.name}-${groupIndex}`,
                    onSubfieldChange: (subfieldName, value) => (
                      field.allowMultiple
                        ? updateRepeatedGroupSubfield(field, groupIndex, subfieldName, value)
                        : updateGroupSubfield(field, subfieldName, value)
                    ),
                    onListSubfieldChange: (subfieldName, valueIndex, value) => (
                      field.allowMultiple
                        ? updateRepeatedGroupListSubfield(field, groupIndex, subfieldName, valueIndex, value)
                        : updateGroupListSubfield(field, subfieldName, valueIndex, value)
                    ),
                    onAddListSubfield: (subfieldName) => (
                      field.allowMultiple
                        ? addRepeatedGroupListSubfield(field, groupIndex, subfieldName)
                        : addGroupListSubfield(field, subfieldName)
                    ),
                    onRemoveListSubfield: (subfieldName, valueIndex) => (
                      field.allowMultiple
                        ? removeRepeatedGroupListSubfield(field, groupIndex, subfieldName, valueIndex)
                        : removeGroupListSubfield(field, subfieldName, valueIndex)
                    ),
                  })}
                </div>
              ))}
              {field.allowMultiple && (
                <button type="button" onClick={() => addRepeatedGroupValue(field)} className="secondary-btn" disabled={disabled}>
                  + Add {field.label || field.name}
                </button>
              )}
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
