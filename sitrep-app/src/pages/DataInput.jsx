import { useMemo, useState } from 'react';
import { useMutation, useQuery, gql } from '@apollo/client';

const GET_RDF_STRUCTURE = gql`
  query GetRdfStructure {
    rdfStructure {
      reportItemFields {
        name
        label
        required
        inputType
        kind
        datatype
        subfields {
          name
          label
          inputType
          datatype
          allowMultiple
        }
        options {
          name
          label
          subfields {
            name
            label
            inputType
            datatype
            allowMultiple
          }
        }
      }
    }
  }
`;

const CREATE_REPORT_ITEM = gql`
  mutation CreateReportItemFromFields($fieldValues: [RdfFieldValueInput!]!) {
    createReportItemFromFields(fieldValues: $fieldValues) {
      entryNumber
    }
  }
`;

function emptyValueFor(field) {
  if (field.kind === 'array') return [''];
  if (field.kind === 'group' || field.kind === 'location') {
    return Object.fromEntries((field.subfields || []).map(subfield => [subfield.name, '']));
  }
  if (field.kind === 'conditional') return { selectedOption: '', values: {} };
  return '';
}

function serializeValue(field, value) {
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

export default function DataInput() {
  const { data, loading: structureLoading, error: structureError } = useQuery(GET_RDF_STRUCTURE);
  const [formData, setFormData] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fields = useMemo(() => data?.rdfStructure?.reportItemFields || [], [data]);
  const initializedForm = useMemo(() => {
    return Object.fromEntries(fields.map(field => [field.name, formData[field.name] ?? emptyValueFor(field)]));
  }, [fields, formData]);

  const [createReportItem] = useMutation(CREATE_REPORT_ITEM, {
    refetchQueries: ['GetReportItems'],
    awaitRefetchQueries: true,
  });

  const updateValue = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const updateListValue = (name, index, value) => {
    const current = [...(initializedForm[name] || [''])];
    current[index] = value;
    updateValue(name, current);
  };

  const addListValue = (name) => {
    updateValue(name, [...(initializedForm[name] || []), '']);
  };

  const removeListValue = (name, index) => {
    updateValue(name, (initializedForm[name] || []).filter((_, i) => i !== index));
  };

  const updateConditionalOption = (field, selectedOption) => {
    updateValue(field.name, { selectedOption, values: {} });
  };

  const updateConditionalSubfield = (field, subfieldName, value) => {
    const current = initializedForm[field.name] || { selectedOption: '', values: {} };
    updateValue(field.name, {
      ...current,
      values: {
        ...(current.values || {}),
        [subfieldName]: value,
      },
    });
  };

  const updateConditionalListSubfield = (field, subfieldName, index, value) => {
    const current = initializedForm[field.name] || { selectedOption: '', values: {} };
    const currentValues = [...(current.values?.[subfieldName] || [''])];
    currentValues[index] = value;
    updateConditionalSubfield(field, subfieldName, currentValues);
  };

  const addConditionalListSubfield = (field, subfieldName) => {
    const current = initializedForm[field.name] || { selectedOption: '', values: {} };
    updateConditionalSubfield(field, subfieldName, [...(current.values?.[subfieldName] || ['']), '']);
  };

  const removeConditionalListSubfield = (field, subfieldName, index) => {
    const current = initializedForm[field.name] || { selectedOption: '', values: {} };
    updateConditionalSubfield(
      field,
      subfieldName,
      (current.values?.[subfieldName] || []).filter((_, valueIndex) => valueIndex !== index)
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const fieldValues = fields.map(field => ({
        name: field.name,
        value: serializeValue(field, initializedForm[field.name]),
      }));

      const result = await createReportItem({ variables: { fieldValues } });
      alert(`Item created successfully! Entry Number: ${result.data.createReportItemFromFields.entryNumber}`);
      setFormData({});
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (structureLoading) return <p>Loading RDF structure...</p>;
  if (structureError) return <div className="error-message">{structureError.message}</div>;

  return (
    <div className="data-input-page">
      <h2>Create New Report Item</h2>
      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit} className="report-item-form">
        {fields.map(field => (
          <div key={field.name} className="form-group">
            <label htmlFor={field.name}>{field.label || field.name}:</label>

            {field.kind === 'conditional' ? (
              <>
                <select
                  id={field.name}
                  value={initializedForm[field.name]?.selectedOption || ''}
                  onChange={(e) => updateConditionalOption(field, e.target.value)}
                  required={field.required}
                >
                  <option value="">-- select --</option>
                  {(field.options || []).map(option => (
                    <option key={option.name} value={option.name}>{option.label || option.name}</option>
                  ))}
                </select>

                {(() => {
                  const selectedOption = (field.options || []).find(option => option.name === initializedForm[field.name]?.selectedOption);
                  if (!selectedOption) return null;
                  return (
                    <div className="conditional-subfields">
                      {(selectedOption.subfields || []).map(subfield => (
                        <div key={subfield.name} className="form-group">
                          <label htmlFor={`${field.name}-${subfield.name}`}>{subfield.label || subfield.name}:</label>
                          {subfield.allowMultiple || subfield.inputType === 'uri-list' || subfield.inputType === 'text-list' ? (
                            <>
                              {(initializedForm[field.name]?.values?.[subfield.name] || ['']).map((value, index) => (
                                <div key={index} className="input-with-button">
                                  <input
                                    id={`${field.name}-${subfield.name}-${index}`}
                                    type="text"
                                    value={value}
                                    onChange={(e) => updateConditionalListSubfield(field, subfield.name, index, e.target.value)}
                                  />
                                  {(initializedForm[field.name]?.values?.[subfield.name] || []).length > 1 && (
                                    <button type="button" onClick={() => removeConditionalListSubfield(field, subfield.name, index)}>x</button>
                                  )}
                                </div>
                              ))}
                              <button type="button" onClick={() => addConditionalListSubfield(field, subfield.name)} className="secondary-btn">
                                + Add {subfield.label || subfield.name}
                              </button>
                            </>
                          ) : subfield.inputType === 'textarea' ? (
                            <textarea
                              id={`${field.name}-${subfield.name}`}
                              value={initializedForm[field.name]?.values?.[subfield.name] || ''}
                              onChange={(e) => updateConditionalSubfield(field, subfield.name, e.target.value)}
                              rows="4"
                            />
                          ) : (
                            <input
                              id={`${field.name}-${subfield.name}`}
                              type={subfield.inputType === 'date' ? 'date' : subfield.inputType === 'number' ? 'number' : 'text'}
                              value={initializedForm[field.name]?.values?.[subfield.name] || ''}
                              onChange={(e) => updateConditionalSubfield(field, subfield.name, e.target.value)}
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
                {(initializedForm[field.name] || ['']).map((value, index) => (
                  <div key={index} className="input-with-button">
                    <input
                      id={`${field.name}-${index}`}
                      type="text"
                      value={value}
                      onChange={(e) => updateListValue(field.name, index, e.target.value)}
                      required={field.required}
                    />
                    {(initializedForm[field.name] || []).length > 1 && (
                      <button type="button" onClick={() => removeListValue(field.name, index)}>x</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => addListValue(field.name)} className="secondary-btn">
                  + Add {field.label || field.name}
                </button>
              </>
            ) : field.kind === 'group' || field.kind === 'location' ? (
              <div className="coordinates">
                {(field.subfields || []).map((subfield) => (
                  <input
                    key={subfield.name}
                    type={field.inputType === 'location' ? 'number' : 'text'}
                    step={field.inputType === 'location' ? '0.0001' : undefined}
                    placeholder={subfield.label || subfield.name}
                    value={initializedForm[field.name]?.[subfield.name] || ''}
                    onChange={(e) => updateValue(field.name, { ...initializedForm[field.name], [subfield.name]: e.target.value })}
                  />
                ))}
              </div>
            ) : field.inputType === 'textarea' ? (
              <textarea
                id={field.name}
                value={initializedForm[field.name] || ''}
                onChange={(e) => updateValue(field.name, e.target.value)}
                required={field.required}
                rows="4"
              />
            ) : (
              <input
                id={field.name}
                type={field.inputType === 'date' ? 'date' : 'text'}
                value={initializedForm[field.name] || ''}
                onChange={(e) => updateValue(field.name, e.target.value)}
                required={field.required}
              />
            )}
          </div>
        ))}

        <button type="submit" disabled={loading}>
          {loading ? 'Submitting...' : 'Create Item'}
        </button>
      </form>
    </div>
  );
}
