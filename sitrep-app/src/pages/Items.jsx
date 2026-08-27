import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, gql } from '@apollo/client';
import { DynamicFieldInputs } from '../components/DynamicFieldForm.jsx';
import { fieldInputsPayload, fieldValidationFromError, formValuesFromFields } from '../components/dynamicFieldFormUtils.js';
import { displayValue, formatTimestamp, itemTitle, notifyReportsUpdated, reportTitle, titleForEntity } from '../utils/reportDisplay.js';
import OrganisationGate from '../components/OrganisationGate.jsx';
import { useOrganisationContext } from '../auth/useOrganisationContext.js';
import FloatyConfirmation, { useFloatyConfirmation } from '../components/FloatyConfirmation.jsx';

const GET_RDF_STRUCTURE = gql`
  query GetRdfStructureForItems($organisationId: ID) {
    rdfStructure(organisationId: $organisationId) {
      json
    }
  }
`;

const RDF_FIELD_VALUE_FIELDS = gql`
  fragment RdfFieldValueLevel3 on RdfStructureField {
    name
    label
    inputType
    kind
    datatype
    allowMultiple
    encrypted
  }

  fragment RdfFieldValueLevel2 on RdfStructureField {
    ...RdfFieldValueLevel3
    subfields {
      ...RdfFieldValueLevel3
    }
    options {
      name
      label
      subfields {
        ...RdfFieldValueLevel3
      }
    }
  }

  fragment RdfFieldValueFields on RdfFieldValue {
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
      ...RdfFieldValueLevel2
    }
    options {
      name
      label
      subfields {
        ...RdfFieldValueLevel2
      }
    }
  }
`;

const GET_RDF_ENTITIES = gql`
  ${RDF_FIELD_VALUE_FIELDS}
  query GetRdfEntities($entityType: String!, $organisationId: ID, $limit: Int, $offset: Int) {
    rdfEntities(entityType: $entityType, organisationId: $organisationId, limit: $limit, offset: $offset) {
      entityType
      id
      uri
      className
      fieldValues {
        ...RdfFieldValueFields
      }
    }
    rdfEntityCount(entityType: $entityType, organisationId: $organisationId)
  }
`;

const GET_REPORT_ITEMS = gql`
  ${RDF_FIELD_VALUE_FIELDS}
  query GetReportItems($organisationId: ID, $limit: Int, $offset: Int) {
    reportItems(organisationId: $organisationId, limit: $limit, offset: $offset) {
      entryNumber
      uri
      reportId
      reportTitle
      reportNumber
      reportDate
      createdAt
      updatedAt
      fieldValues {
        ...RdfFieldValueFields
      }
    }
    reportItemCount(organisationId: $organisationId)
  }
`;

const GET_REPORTS = gql`
  query GetReports($organisationId: ID, $limit: Int, $offset: Int) {
    reports(organisationId: $organisationId, limit: $limit, offset: $offset) {
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
  // Prefer human-readable field values in item lists, then fall back to IDs/URIs.
  const labelValue = entity.fieldValues?.find(field =>
    field.value && ['name', 'title', 'label'].includes(field.name)
  )?.value;
  const primaryValue = labelValue || entity.fieldValues?.find(field => field.value && field.kind === 'scalar')?.value;
  return primaryValue || `${titleForEntity(entity.entityType)} #${entity.id}`;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

function PaginationControls({ pageIndex, pageSize, totalCount, onPageChange, onPageSizeChange, disabled }) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(pageIndex + 1, totalPages);
  const start = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min(totalCount, (pageIndex + 1) * pageSize);
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter(page => (
      page === 1
      || page === totalPages
      || Math.abs(page - currentPage) <= 2
    ));

  return (
    <div className="pagination-bar">
      <div className="pagination-summary">
        {totalCount === 0 ? 'No items' : `${start}-${end} of ${totalCount}`}
      </div>
      <div className="pagination-pages" aria-label="Pages">
        {pages.map((page, index) => {
          const previousPage = pages[index - 1];
          return (
            <span key={page} className="pagination-page-slot">
              {previousPage && page - previousPage > 1 && <span className="pagination-ellipsis">...</span>}
              <button
                type="button"
                className={`pagination-page${page === currentPage ? ' active' : ''}`}
                onClick={() => onPageChange(page - 1)}
                disabled={disabled || page === currentPage}
                aria-current={page === currentPage ? 'page' : undefined}
              >
                {page}
              </button>
            </span>
          );
        })}
      </div>
      <label className="page-size-control">
        Per page
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          disabled={disabled}
        >
          {PAGE_SIZE_OPTIONS.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default function Items() {
  // Items displays built-in report items and custom RDF entities, with dynamic
  // edit forms generated from the active RDF structure.
  const { activeOrganisationCanWrite, activeOrganisationId, activeOrganisationIsUnscoped } = useOrganisationContext();
  const [selectedEntityType, setSelectedEntityType] = useState('');
  const [selectedReportByItem, setSelectedReportByItem] = useState({});
  const [actionError, setActionError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [editingKey, setEditingKey] = useState('');
  const [editValues, setEditValues] = useState({});
  const [itemPageIndex, setItemPageIndex] = useState(0);
  const [entityPageIndex, setEntityPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const { notice, showNotice, confirmAction, clearNotice } = useFloatyConfirmation();

  const reportItemVariables = { organisationId: activeOrganisationId, limit: pageSize, offset: itemPageIndex * pageSize };
  const reportsVariables = { organisationId: activeOrganisationId };
  const refetchScopedQueries = [
    { query: GET_REPORT_ITEMS, variables: reportItemVariables },
    { query: GET_REPORTS, variables: reportsVariables },
  ];
  const { data: structureData, loading: structureLoading, error: structureError } = useQuery(GET_RDF_STRUCTURE, {
    variables: { organisationId: activeOrganisationId },
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

  const entityVariables = { entityType: activeEntityType, organisationId: activeOrganisationId, limit: pageSize, offset: entityPageIndex * pageSize };
  const { data: entitiesData, loading: entitiesLoading, error: entitiesError, refetch: refetchEntities } = useQuery(
    GET_RDF_ENTITIES,
    {
      variables: entityVariables,
      skip: (!activeOrganisationId && !activeOrganisationIsUnscoped) || !activeEntityType || activeEntityType === 'reportItem',
    }
  );
  const { data: itemsData, loading: itemsLoading, error: itemsError, refetch: refetchItems } = useQuery(GET_REPORT_ITEMS, {
    variables: reportItemVariables,
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const { data: reportsData, loading: reportsLoading, error: reportsError, refetch: refetchReports } = useQuery(GET_REPORTS, {
    variables: reportsVariables,
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

  useEffect(() => {
    setItemPageIndex(0);
    setEntityPageIndex(0);
  }, [selectedEntityType, activeOrganisationId]);

  useEffect(() => {
    setItemPageIndex(0);
    setEntityPageIndex(0);
  }, [pageSize]);

  const reportItems = itemsData?.reportItems || [];
  const reportItemCount = itemsData?.reportItemCount || 0;
  const reports = reportsData?.reports || [];
  const entities = entitiesData?.rdfEntities || [];
  const entityCount = entitiesData?.rdfEntityCount || 0;
  const loading = structureLoading || itemsLoading || reportsLoading || entitiesLoading;
  const error = actionError || structureError?.message || itemsError?.message || reportsError?.message || entitiesError?.message;
  const reportsAvailableForItem = (item) => reports.filter(report =>
    !(report.selectedItemIds || []).some(itemId => Number(itemId) === Number(item.entryNumber))
  );

  useEffect(() => {
    if (itemsLoading) return;
    const lastPageIndex = Math.max(0, Math.ceil(reportItemCount / pageSize) - 1);
    if (itemPageIndex > lastPageIndex) setItemPageIndex(lastPageIndex);
  }, [itemPageIndex, itemsLoading, pageSize, reportItemCount]);

  useEffect(() => {
    if (entitiesLoading) return;
    const lastPageIndex = Math.max(0, Math.ceil(entityCount / pageSize) - 1);
    if (entityPageIndex > lastPageIndex) setEntityPageIndex(lastPageIndex);
  }, [entitiesLoading, entityCount, entityPageIndex, pageSize]);

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
    const confirmed = await confirmAction(`Delete report item #${id}? This cannot be undone.`, {
      confirmLabel: 'Delete item',
    });
    if (!confirmed) return;

    try {
      setActionError('');
      await deleteReportItem({ variables: { id, organisationId: activeOrganisationId } });
      showNotice(`Report item #${id} deleted.`);
    } catch (err) {
      setActionError(err.message);
      showNotice(`Error deleting report item: ${err.message}`, 'error');
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
                <PaginationControls
                  pageIndex={itemPageIndex}
                  pageSize={pageSize}
                  totalCount={reportItemCount}
                  onPageChange={setItemPageIndex}
                  onPageSizeChange={setPageSize}
                  disabled={loading}
                />
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
                <PaginationControls
                  pageIndex={itemPageIndex}
                  pageSize={pageSize}
                  totalCount={reportItemCount}
                  onPageChange={setItemPageIndex}
                  onPageSizeChange={setPageSize}
                  disabled={loading}
                />
              </div>
            )
          ) : (
            entities.length === 0 && !loading ? (
              <p>No {titleForEntity(activeEntityType).toLowerCase()} instances found.</p>
            ) : (
              <div className="entity-instance-list">
                <PaginationControls
                  pageIndex={entityPageIndex}
                  pageSize={pageSize}
                  totalCount={entityCount}
                  onPageChange={setEntityPageIndex}
                  onPageSizeChange={setPageSize}
                  disabled={loading}
                />
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
                <PaginationControls
                  pageIndex={entityPageIndex}
                  pageSize={pageSize}
                  totalCount={entityCount}
                  onPageChange={setEntityPageIndex}
                  onPageSizeChange={setPageSize}
                  disabled={loading}
                />
              </div>
            )
          )}
        </main>
      </div>
      <FloatyConfirmation notice={notice} onClose={clearNotice} />
    </div>
    </OrganisationGate>
  );
}
