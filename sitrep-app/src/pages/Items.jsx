import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, gql } from '@apollo/client';
import { DynamicFieldInputs } from '../components/DynamicFieldForm.jsx';
import { fieldInputsPayload, fieldValidationFromError, formValuesFromFields } from '../components/dynamicFieldFormUtils.js';
import { displayValue, formatTimestamp, itemTitle, notifyReportsUpdated, reportTitle, titleForEntity } from '../utils/reportDisplay.js';
import OrganisationGate from '../components/OrganisationGate.jsx';
import { useOrganisationContext } from '../auth/useOrganisationContext.js';

const GET_RDF_STRUCTURE = gql`
  query GetRdfStructureForItems($organisationId: ID) {
    rdfStructure(organisationId: $organisationId) {
      json
    }
  }
`;

const GET_RDF_ENTITIES = gql`
  query GetRdfEntities($entityType: String!, $organisationId: ID) {
    rdfEntities(entityType: $entityType, organisationId: $organisationId) {
      entityType
      id
      uri
      className
      fieldValues {
        name
        label
        value
        kind
        datatype
        required
        inputType
        allowMultiple
        encrypted
        subfields {
          name
          label
          inputType
          datatype
          allowMultiple
          encrypted
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
            encrypted
          }
        }
      }
    }
  }
`;

const GET_REPORT_ITEMS = gql`
  query GetReportItems($organisationId: ID) {
    reportItems(organisationId: $organisationId) {
      entryNumber
      uri
      reportId
      reportTitle
      reportNumber
      reportDate
      createdAt
      updatedAt
      fieldValues {
        name
        label
        value
        kind
        datatype
        required
        inputType
        allowMultiple
        encrypted
        subfields {
          name
          label
          inputType
          datatype
          allowMultiple
          encrypted
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
            encrypted
          }
        }
      }
    }
  }
`;

const GET_REPORTS = gql`
  query GetReports($organisationId: ID) {
    reports(organisationId: $organisationId) {
      id
      selectedItemIds
      createdAt
      fieldValues {
        name
        label
        value
        kind
        subfields {
          name
          label
        }
        options {
          name
          label
          subfields {
            name
            label
          }
        }
      }
    }
  }
`;

const DELETE_REPORT_ITEM = gql`
  mutation DeleteReportItem($id: ID!, $organisationId: ID) {
    deleteReportItem(id: $id, organisationId: $organisationId)
  }
`;

const UPDATE_REPORT_ITEM = gql`
  mutation UpdateReportItemFromFields($id: ID!, $fieldValues: [RdfFieldValueInput!]!, $organisationId: ID) {
    updateReportItemFromFields(id: $id, fieldValues: $fieldValues, organisationId: $organisationId) {
      entryNumber
    }
  }
`;

const UPDATE_RDF_ENTITY = gql`
  mutation UpdateRdfEntity($entityType: String!, $id: ID!, $uri: String, $fieldValues: [RdfFieldValueInput!]!, $organisationId: ID) {
    updateRdfEntity(entityType: $entityType, id: $id, uri: $uri, fieldValues: $fieldValues, organisationId: $organisationId) {
      id
      uri
    }
  }
`;

const DELETE_RDF_ENTITY = gql`
  mutation DeleteRdfEntity($entityType: String!, $id: ID!, $uri: String, $organisationId: ID) {
    deleteRdfEntity(entityType: $entityType, id: $id, uri: $uri, organisationId: $organisationId)
  }
`;

const ADD_ITEM_TO_REPORT = gql`
  mutation AddItemToReport($reportId: ID!, $itemId: ID!, $organisationId: ID) {
    addItemToReport(reportId: $reportId, itemId: $itemId, organisationId: $organisationId)
  }
`;

const REMOVE_ITEM_FROM_REPORT = gql`
  mutation RemoveItemFromReport($reportId: ID!, $itemId: ID!, $organisationId: ID) {
    removeItemFromReport(reportId: $reportId, itemId: $itemId, organisationId: $organisationId)
  }
`;

function entityTitle(entity) {
  const labelValue = entity.fieldValues?.find(field =>
    field.value && ['name', 'title', 'label'].includes(field.name)
  )?.value;
  const primaryValue = labelValue || entity.fieldValues?.find(field => field.value && field.kind === 'scalar')?.value;
  return primaryValue || `${titleForEntity(entity.entityType)} #${entity.id}`;
}

export default function Items() {
  const { activeOrganisationCanWrite, activeOrganisationId, activeOrganisationIsUnscoped } = useOrganisationContext();
  const [selectedEntityType, setSelectedEntityType] = useState('');
  const [selectedReportByItem, setSelectedReportByItem] = useState({});
  const [actionError, setActionError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [editingKey, setEditingKey] = useState('');
  const [editValues, setEditValues] = useState({});

  const queryVariables = { organisationId: activeOrganisationId };
  const refetchScopedQueries = [
    { query: GET_REPORT_ITEMS, variables: queryVariables },
    { query: GET_REPORTS, variables: queryVariables },
  ];
  const { data: structureData, loading: structureLoading, error: structureError } = useQuery(GET_RDF_STRUCTURE, {
    variables: queryVariables,
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const structure = useMemo(() => {
    if (!structureData?.rdfStructure?.json) return null;
    try {
      return JSON.parse(structureData.rdfStructure.json);
    } catch {
      return null;
    }
  }, [structureData]);
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

  const { data: entitiesData, loading: entitiesLoading, error: entitiesError, refetch: refetchEntities } = useQuery(
    GET_RDF_ENTITIES,
    {
      variables: { entityType: activeEntityType, organisationId: activeOrganisationId },
      skip: (!activeOrganisationId && !activeOrganisationIsUnscoped) || !activeEntityType || activeEntityType === 'reportItem',
    }
  );
  const { data: itemsData, loading: itemsLoading, error: itemsError, refetch: refetchItems } = useQuery(GET_REPORT_ITEMS, {
    variables: queryVariables,
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const { data: reportsData, loading: reportsLoading, error: reportsError, refetch: refetchReports } = useQuery(GET_REPORTS, {
    variables: queryVariables,
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const [deleteReportItem] = useMutation(DELETE_REPORT_ITEM, {
    refetchQueries: refetchScopedQueries
  });
  const [updateReportItem] = useMutation(UPDATE_REPORT_ITEM, {
    refetchQueries: refetchScopedQueries
  });
  const [updateRdfEntity] = useMutation(UPDATE_RDF_ENTITY);
  const [deleteRdfEntity] = useMutation(DELETE_RDF_ENTITY);
  const [addItemToReport] = useMutation(ADD_ITEM_TO_REPORT, {
    refetchQueries: refetchScopedQueries
  });
  const [removeItemFromReport] = useMutation(REMOVE_ITEM_FROM_REPORT, {
    refetchQueries: refetchScopedQueries
  });

  useEffect(() => {
    const handler = () => {
      refetchItems();
      refetchReports();
      if (activeEntityType && activeEntityType !== 'reportItem') refetchEntities();
    };
    window.addEventListener('reportsUpdated', handler);
    const storageHandler = (e) => {
      if (e.key === 'reportsUpdated') handler();
    };
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener('reportsUpdated', handler);
      window.removeEventListener('storage', storageHandler);
    };
  }, [refetchItems, refetchReports, refetchEntities, activeEntityType]);

  const reportItems = itemsData?.reportItems || [];
  const reports = reportsData?.reports || [];
  const entities = entitiesData?.rdfEntities || [];
  const loading = structureLoading || itemsLoading || reportsLoading || entitiesLoading;
  const error = actionError || structureError?.message || itemsError?.message || reportsError?.message || entitiesError?.message;
  const reportsAvailableForItem = (item) => reports.filter(report =>
    !(report.selectedItemIds || []).some(itemId => Number(itemId) === Number(item.entryNumber))
  );
  const startEditing = (key, fields) => {
    setActionError('');
    setFieldErrors({});
    setEditingKey(key);
    setEditValues(formValuesFromFields(fields));
  };

  const stopEditing = () => {
    setEditingKey('');
    setEditValues({});
    setFieldErrors({});
  };

  const handleUpdateReportItem = async (item) => {
    try {
      setActionError('');
      await updateReportItem({
        variables: {
          id: item.entryNumber,
          fieldValues: fieldInputsPayload(item.fieldValues, editValues),
          organisationId: activeOrganisationId,
        },
      });
      stopEditing();
      notifyReportsUpdated();
    } catch (err) {
      const fieldValidation = fieldValidationFromError(err);
      if (fieldValidation) {
        setFieldErrors({ [fieldValidation.fieldName]: fieldValidation.message });
        return;
      }
      setActionError(err.message);
    }
  };

  const handleUpdateEntity = async (entity) => {
    try {
      setActionError('');
      await updateRdfEntity({
        variables: {
          entityType: entity.entityType,
          id: entity.id,
          uri: entity.uri,
          fieldValues: fieldInputsPayload(entity.fieldValues, editValues),
          organisationId: activeOrganisationId,
        },
      });
      stopEditing();
      await refetchEntities();
    } catch (err) {
      const fieldValidation = fieldValidationFromError(err);
      if (fieldValidation) {
        setFieldErrors({ [fieldValidation.fieldName]: fieldValidation.message });
        return;
      }
      setActionError(err.message);
    }
  };

  const handleAddToReport = async (itemId) => {
    const reportId = selectedReportByItem[itemId];
    if (!reportId) return;

    try {
      setActionError('');
      await addItemToReport({ variables: { reportId, itemId, organisationId: activeOrganisationId } });
      setSelectedReportByItem({ ...selectedReportByItem, [itemId]: '' });
      notifyReportsUpdated();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleDeleteReportItem = async (id) => {
    try {
      setActionError('');
      await deleteReportItem({ variables: { id, organisationId: activeOrganisationId } });
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleDeleteEntity = async (entity) => {
    try {
      setActionError('');
      await deleteRdfEntity({ variables: { entityType: entity.entityType, id: entity.id, uri: entity.uri, organisationId: activeOrganisationId } });
      await refetchEntities();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleClearItemReport = async (itemId) => {
    const item = reportItems.find(i => i.entryNumber === itemId);
    if (!item?.reportId) return;

    try {
      setActionError('');
      await removeItemFromReport({ variables: { reportId: item.reportId, itemId, organisationId: activeOrganisationId } });
      notifyReportsUpdated();
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <OrganisationGate>
    <div className="settings-page">
      <div className="rdf-structure-window app-browser-window">
        <div className="rdf-window-header">
          <h2>Items</h2>
          {error && <div className="error-message">{error}</div>}
        </div>

        <aside className="rdf-class-sidebar">
          <div className="rdf-class-sidebar-heading">
            <h3>Classes</h3>
          </div>
          <div className="rdf-class-list">
            {entityTypes.map(entityType => (
              <div
                key={entityType}
                className={`rdf-class-card${entityType === activeEntityType ? ' selected' : ''}`}
              >
                <div className="rdf-class-card-top">
                  <button
                    type="button"
                    className="rdf-class-nav-button"
                    onClick={() => setSelectedEntityType(entityType)}
                    aria-current={entityType === activeEntityType ? 'page' : undefined}
                  >
                    {titleForEntity(entityType)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="rdf-field-pane entity-instance-pane">
          <div className="rdf-field-pane-header">
            <h3>{titleForEntity(activeEntityType)} Instances</h3>
          </div>
          {loading && <p>Loading...</p>}

          {activeEntityType === 'reportItem' ? (
            reportItems.length === 0 && !loading ? (
              <p>No items submitted yet.</p>
            ) : (
              <div className="entity-instance-list">
                {reportItems.map(item => {
                  const availableReports = reportsAvailableForItem(item);
                  const itemEditKey = `reportItem:${item.entryNumber}`;
                  const isEditing = editingKey === itemEditKey;

                  return (
                    <div key={item.entryNumber} className="report-item-card entity-instance-card">
                      <h4>{itemTitle(item)}</h4>

                      {isEditing && activeOrganisationCanWrite ? (
                        <form
                          className="entity-edit-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleUpdateReportItem(item);
                          }}
                        >
                          <DynamicFieldInputs
                            fields={item.fieldValues}
                            values={editValues}
                            onChange={setEditValues}
                            disabled={loading}
                            fieldErrors={fieldErrors}
                            onFieldErrorClear={(name) => setFieldErrors(current => {
                              const next = { ...current };
                              delete next[name];
                              return next;
                            })}
                          />
                          <div className="item-actions">
                            <button type="submit" className="generate-btn" disabled={loading}>Save</button>
                            <button type="button" className="secondary-btn" onClick={stopEditing} disabled={loading}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <div className="event-data-details">
                          {item.uri && (
                            <div className="event-detail-row">
                              <strong>URI:</strong> {item.uri}
                            </div>
                          )}
                          {item.fieldValues.map(field => {
                            const value = displayValue(field);
                            if (!value) return null;
                            return (
                              <div key={field.name} className="event-detail-row">
                                <strong>{field.label || field.name}:</strong> {value}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {item.reportId && (
                        <div className="report-assignment">
                          <strong>Assigned to report:</strong> {item.reportNumber || item.reportTitle}
                          {item.reportDate ? ` on ${new Date(item.reportDate).toLocaleDateString()}` : ''}
                        </div>
                      )}
                      {item.createdAt && (
                        <div className="report-meta">
                          Created: {formatTimestamp(item.createdAt)}
                          {item.updatedAt && (
                            <div>Updated: {formatTimestamp(item.updatedAt)}</div>
                          )}
                        </div>
                      )}

                      {activeOrganisationCanWrite && <div className="item-actions">
                        {availableReports.length > 0 && (
                          <>
                            <select
                              value={selectedReportByItem[item.entryNumber] || ''}
                              onChange={(e) => setSelectedReportByItem({ ...selectedReportByItem, [item.entryNumber]: e.target.value })}
                            >
                              <option value="">-- add to report --</option>
                              {availableReports.map(r => (
                                <option key={r.id} value={r.id}>{reportTitle(r)}</option>
                              ))}
                            </select>
                            <button
                              className="generate-btn"
                              onClick={() => handleAddToReport(item.entryNumber)}
                              disabled={!selectedReportByItem[item.entryNumber] || loading}
                            >
                              Add to Report
                            </button>
                          </>
                        )}
                        {!isEditing && (
                          <button
                            className="secondary-btn"
                            onClick={() => startEditing(itemEditKey, item.fieldValues)}
                            disabled={loading}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          className="delete-btn"
                          onClick={() => handleDeleteReportItem(item.entryNumber)}
                          disabled={loading}
                        >
                          Delete
                        </button>
                        {item.reportId && (
                          <button
                            className="delete-btn"
                            onClick={() => handleClearItemReport(item.entryNumber)}
                            disabled={loading}
                            title="Remove from report"
                          >
                            Remove from report
                          </button>
                        )}
                      </div>}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            entities.length === 0 && !loading ? (
              <p>No {titleForEntity(activeEntityType).toLowerCase()} instances found.</p>
            ) : (
              <div className="entity-instance-list">
                {entities.map(entity => (
                  (() => {
                    const entityEditKey = `${entity.entityType}:${entity.uri}`;
                    const isEditing = editingKey === entityEditKey;
                    return (
                      <div key={entity.uri} className="report-item-card entity-instance-card">
                        <div className="entity-instance-header">
                          <h4>{entityTitle(entity)}</h4>
                          {activeOrganisationCanWrite && <div className="item-actions">
                            {!isEditing && (
                              <button
                                className="secondary-btn"
                                onClick={() => startEditing(entityEditKey, entity.fieldValues)}
                                disabled={loading}
                              >
                                Edit
                              </button>
                            )}
                            <button
                              className="delete-btn"
                              onClick={() => handleDeleteEntity(entity)}
                              disabled={loading}
                            >
                              Delete
                            </button>
                          </div>}
                        </div>
                        {isEditing && activeOrganisationCanWrite ? (
                          <form
                            className="entity-edit-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleUpdateEntity(entity);
                            }}
                          >
                            <DynamicFieldInputs
                              fields={entity.fieldValues}
                              values={editValues}
                              onChange={setEditValues}
                              disabled={loading}
                              fieldErrors={fieldErrors}
                              onFieldErrorClear={(name) => setFieldErrors(current => {
                                const next = { ...current };
                                delete next[name];
                                return next;
                              })}
                            />
                            <div className="item-actions">
                              <button type="submit" className="generate-btn" disabled={loading}>Save</button>
                              <button type="button" className="secondary-btn" onClick={stopEditing} disabled={loading}>Cancel</button>
                            </div>
                          </form>
                        ) : (
                          <div className="event-data-details">
                            <div className="event-detail-row">
                              <strong>URI:</strong> {entity.uri}
                            </div>
                            {entity.fieldValues.map(field => {
                              const value = displayValue(field);
                              if (!value) return null;
                              return (
                                <div key={field.name} className="event-detail-row">
                                  <strong>{field.label || field.name}:</strong> {value}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()
                ))}
              </div>
            )
          )}
        </main>
      </div>
    </div>
    </OrganisationGate>
  );
}
