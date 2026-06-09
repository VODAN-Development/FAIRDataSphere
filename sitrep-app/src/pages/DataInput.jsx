import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, gql } from '@apollo/client';
import { DynamicFieldInputs } from '../components/DynamicFieldForm.jsx';
import { emptyValueFor, fieldInputsPayload, fieldValidationFromError } from '../components/dynamicFieldFormUtils.js';
import OrganisationGate from '../components/OrganisationGate.jsx';
import { useOrganisationContext } from '../auth/useOrganisationContext.js';
import { notifyReportsUpdated, titleForEntity } from '../utils/reportDisplay.js';

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

const groupPropertyNames = new Set(['label', 'predicate', 'inputType', 'required', 'resourceMode', 'className', 'targetEntityType', 'targetClass', 'targetTemplate', 'targetLabelField']);

function groupSubfieldEntries(group = {}) {
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
  const kind = fieldKind(field);
  return {
    name,
    kind,
    ...field,
    subfields: kind === 'group'
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

export default function DataInput() {
  const { activeOrganisationId, activeOrganisationIsUnscoped } = useOrganisationContext();
  const { data, loading: structureLoading, error: structureError } = useQuery(GET_RDF_STRUCTURE, {
    variables: { organisationId: activeOrganisationId },
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const [formData, setFormData] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedEntityType, setSelectedEntityType] = useState('');

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
      setMessage(`${titleForEntity(created.entityType)} created.`);
      setFormData({});
      notifyReportsUpdated();
    } catch (err) {
      const fieldValidation = fieldValidationFromError(err);
      if (fieldValidation) {
        setFieldErrors({ [fieldValidation.fieldName]: fieldValidation.message });
        return;
      }
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (structureLoading) return <p>Loading RDF structure...</p>;
  if (structureError) return <div className="error-message">{structureError.message}</div>;
  if (!activeEntityType) return <div className="error-message">No RDF classes are available for data input.</div>;

  return (
    <OrganisationGate requireWrite>
      <main className="settings-page">
        <div className="rdf-structure-window app-browser-window data-input-browser-window">
          <div className="rdf-window-header">
            <h2>Data Input</h2>
            {error && <div className="error-message">{error}</div>}
            {message && <div className="success-message">{message}</div>}
          </div>

          <aside className="rdf-class-sidebar data-input-sidebar">
            <div className="rdf-class-sidebar-heading">
              <h3>Input</h3>
            </div>

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
        </div>
      </main>
    </OrganisationGate>
  );
}
