import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, gql } from '@apollo/client';
import { DynamicFieldInputs } from '../components/DynamicFieldForm.jsx';
import { emptyValueFor, fieldInputsPayload, fieldValidationFromError, formValuesFromFields } from '../components/dynamicFieldFormUtils.js';
import { displayValue, formatTimestamp, itemTitle, notifyReportsUpdated, reportTitle } from '../utils/reportDisplay.js';
import OrganisationGate from '../components/OrganisationGate.jsx';
import { useOrganisationContext } from '../auth/useOrganisationContext.js';

const GET_RDF_STRUCTURE = gql`
  query GetRdfStructureForReports($organisationId: ID) {
    rdfStructure(organisationId: $organisationId) {
      reportFields {
        name
        label
        required
        inputType
        kind
        datatype
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
      reportId
      fieldValues {
        name
        label
        value
        kind
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

const CREATE_REPORT = gql`
  mutation CreateReportFromFields($fieldValues: [RdfFieldValueInput!]!, $selectedItemIds: [Int!]!, $organisationId: ID) {
    createReportFromFields(fieldValues: $fieldValues, selectedItemIds: $selectedItemIds, organisationId: $organisationId) {
      id
    }
  }
`;

const DELETE_REPORT = gql`
  mutation DeleteReport($id: ID!, $organisationId: ID) {
    deleteReport(id: $id, organisationId: $organisationId)
  }
`;

const UPDATE_REPORT = gql`
  mutation UpdateReportFromFields($id: ID!, $fieldValues: [RdfFieldValueInput!]!, $selectedItemIds: [Int!], $organisationId: ID) {
    updateReportFromFields(id: $id, fieldValues: $fieldValues, selectedItemIds: $selectedItemIds, organisationId: $organisationId) {
      id
    }
  }
`;

const REMOVE_ITEM_FROM_REPORT = gql`
  mutation RemoveItemFromReport($reportId: ID!, $itemId: ID!, $organisationId: ID) {
    removeItemFromReport(reportId: $reportId, itemId: $itemId, organisationId: $organisationId)
  }
`;

const ADD_ITEM_TO_REPORT = gql`
  mutation AddItemToReport($reportId: ID!, $itemId: ID!, $organisationId: ID) {
    addItemToReport(reportId: $reportId, itemId: $itemId, organisationId: $organisationId)
  }
`;

export default function Reports() {
  const { activeOrganisationCanWrite, activeOrganisationId, activeOrganisationIsUnscoped } = useOrganisationContext();
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [formData, setFormData] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [reportAddSelection, setReportAddSelection] = useState({});
  const [selectedReportId, setSelectedReportId] = useState('');
  const [isCreatingReport, setIsCreatingReport] = useState(false);
  const [editingReportId, setEditingReportId] = useState('');
  const [editReportValues, setEditReportValues] = useState({});

  const queryVariables = { organisationId: activeOrganisationId };
  const refetchScopedQueries = [
    { query: GET_REPORTS, variables: queryVariables },
    { query: GET_REPORT_ITEMS, variables: queryVariables },
  ];
  const { data: structureData, loading: structureLoading, error: structureError } = useQuery(GET_RDF_STRUCTURE, {
    variables: queryVariables,
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const { data: itemsData, loading: itemsLoading, error: itemsError, refetch: refetchItems } = useQuery(GET_REPORT_ITEMS, {
    variables: queryVariables,
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const { data: reportsData, loading: reportsLoading, error: reportsError, refetch: refetchReports } = useQuery(GET_REPORTS, {
    variables: queryVariables,
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const [createReport] = useMutation(CREATE_REPORT, {
    refetchQueries: refetchScopedQueries
  });
  const [deleteReport] = useMutation(DELETE_REPORT, {
    refetchQueries: refetchScopedQueries
  });
  const [updateReport] = useMutation(UPDATE_REPORT, {
    refetchQueries: refetchScopedQueries
  });
  const [removeItemFromReport] = useMutation(REMOVE_ITEM_FROM_REPORT, {
    refetchQueries: refetchScopedQueries
  });
  const [addItemToReport] = useMutation(ADD_ITEM_TO_REPORT, {
    refetchQueries: refetchScopedQueries
  });

  const fields = useMemo(() => structureData?.rdfStructure?.reportFields || [], [structureData]);
  const initializedForm = useMemo(() => {
    return Object.fromEntries(fields.map(field => [field.name, formData[field.name] ?? emptyValueFor(field)]));
  }, [fields, formData]);

  useEffect(() => {
    const handler = () => {
      refetchItems();
      refetchReports();
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
  }, [refetchItems, refetchReports]);

  const reportItems = useMemo(() => itemsData?.reportItems || [], [itemsData]);
  const reports = useMemo(() => reportsData?.reports || [], [reportsData]);
  const gqlError = structureError || itemsError || reportsError;
  const loading = structureLoading || itemsLoading || reportsLoading;
  const selectedReport = !isCreatingReport
    ? reports.find(report => String(report.id) === String(selectedReportId)) || reports[0] || null
    : null;

  const reportHasItem = (report, item) => {
    return (report?.selectedItemIds || []).some(itemId => Number(itemId) === Number(item.entryNumber));
  };

  const startEditingReport = (report) => {
    setError('');
    setFieldErrors({});
    setEditingReportId(report.id);
    setEditReportValues(formValuesFromFields(report.fieldValues));
  };

  const stopEditingReport = () => {
    setEditingReportId('');
    setEditReportValues({});
    setFieldErrors({});
  };

  const handleUpdateReport = async (report) => {
    try {
      setError('');
      await updateReport({
        variables: {
          id: report.id,
          fieldValues: fieldInputsPayload(report.fieldValues, editReportValues),
          selectedItemIds: report.selectedItemIds,
          organisationId: activeOrganisationId,
        },
      });
      stopEditingReport();
      notifyReportsUpdated();
    } catch (err) {
      const fieldValidation = fieldValidationFromError(err);
      if (fieldValidation) {
        setFieldErrors({ [fieldValidation.fieldName]: fieldValidation.message });
        return;
      }
      setError('Error updating report: ' + err.message);
    }
  };

  const handleAddItemToExistingReport = async (reportId) => {
    const itemId = reportAddSelection[reportId];
    if (!itemId) return;
    try {
      await addItemToReport({ variables: { reportId, itemId, organisationId: activeOrganisationId } });
      setReportAddSelection(prev => ({ ...prev, [reportId]: '' }));
      notifyReportsUpdated();
    } catch (err) {
      setError('Error adding item: ' + err.message);
    }
  };

  const handleItemCheckboxChange = (itemId) => {
    const numericItemId = Number(itemId);
    const newSelected = new Set(selectedItems);
    if (newSelected.has(numericItemId)) {
      newSelected.delete(numericItemId);
    } else {
      newSelected.add(numericItemId);
    }
    setSelectedItems(newSelected);
  };

  const handleCreateReport = async (e) => {
    e.preventDefault();

    try {
      setError('');
      setFieldErrors({});
      const result = await createReport({
        variables: {
          fieldValues: fieldInputsPayload(fields, initializedForm),
          selectedItemIds: Array.from(selectedItems),
          organisationId: activeOrganisationId,
        }
      });

      setFormData({});
      setSelectedItems(new Set());
      setIsCreatingReport(false);
      setSelectedReportId(result.data.createReportFromFields.id);
      notifyReportsUpdated();
    } catch (err) {
      const fieldValidation = fieldValidationFromError(err);
      if (fieldValidation) {
        setFieldErrors({ [fieldValidation.fieldName]: fieldValidation.message });
        return;
      }
      setError('Error creating report: ' + err.message);
    }
  };

  const handleDeleteReport = async (reportId) => {
    if (!window.confirm('Are you sure you want to delete this report?')) {
      return;
    }

    try {
      await deleteReport({ variables: { id: reportId, organisationId: activeOrganisationId } });
      setSelectedReportId('');
      notifyReportsUpdated();
    } catch (err) {
      setError('Error deleting report: ' + err.message);
    }
  };

  const handleRemoveItemFromReport = async (reportId, itemId) => {
    try {
      await removeItemFromReport({ variables: { reportId, itemId, organisationId: activeOrganisationId } });
      notifyReportsUpdated();
    } catch (err) {
      setError('Error removing item: ' + err.message);
    }
  };

  const getReportItemDetails = (itemId) => {
    return reportItems.find(item => Number(item.entryNumber) === Number(itemId));
  };

  return (
    <OrganisationGate>
    <div className="settings-page">
      <div className="rdf-structure-window app-browser-window reports-browser-window">
        <div className="rdf-window-header">
          <h2>Reports</h2>
          {(error || gqlError) && <div className="error-message">{error || gqlError.message}</div>}
        </div>

        <aside className="rdf-class-sidebar">
          <div className="rdf-class-sidebar-heading report-sidebar-heading">
            <h3>Reports</h3>
            {activeOrganisationCanWrite && (
              <button
                type="button"
                className="create-report-button compact-action"
                onClick={() => {
                  setIsCreatingReport(true);
                  setSelectedReportId('');
                  setError('');
                  setFieldErrors({});
                }}
              >
                Add Report
              </button>
            )}
          </div>
          <div className="rdf-class-list">
            {reports.length === 0 && !loading ? (
              <p className="no-reports-message">No reports created yet.</p>
            ) : (
              reports.map(report => (
                <div
                  key={report.id}
                  className={`rdf-class-card${!isCreatingReport && String(report.id) === String(selectedReport?.id) ? ' selected' : ''}`}
                >
                  <div className="rdf-class-card-top">
                    <button
                      type="button"
                      className="rdf-class-nav-button"
                      onClick={() => {
                        setIsCreatingReport(false);
                        setSelectedReportId(report.id);
                      }}
                      aria-current={!isCreatingReport && String(report.id) === String(selectedReport?.id) ? 'page' : undefined}
                    >
                      {reportTitle(report)}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="rdf-field-pane report-detail-pane">
          {isCreatingReport ? (
            <div className="report-creation-section report-detail-surface">
              <div className="rdf-field-pane-header">
                <h3>Create a New Report</h3>
              </div>
              <form onSubmit={handleCreateReport}>
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

                <div className="form-group">
                  <label>Select Report Items:</label>
                  <div className="items-selection">
                    {reportItems.length === 0 ? (
                      <p className="no-items-message">No report items available. Create some items first on the Data Input page.</p>
                    ) : (
                      reportItems.map(item => {
                        const itemId = Number(item.entryNumber);

                        return (
                          <div key={item.entryNumber} className="item-checkbox-container">
                            <input
                              type="checkbox"
                              id={`item-${item.entryNumber}`}
                              checked={selectedItems.has(itemId)}
                              onChange={() => handleItemCheckboxChange(item.entryNumber)}
                            />
                            <label htmlFor={`item-${item.entryNumber}`}>
                              <strong>{itemTitle(item)}</strong>
                            </label>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="create-report-button"
                >
                  {loading ? 'Creating Report...' : 'Create Report'}
                </button>
              </form>
            </div>
          ) : selectedReport ? (
            <div className="report-card report-detail-surface">
              <div className="report-header">
                <div className="report-header-info">
                  <h4>{reportTitle(selectedReport)}</h4>
                  {editingReportId !== selectedReport.id && selectedReport.fieldValues.map(field => {
                    const value = displayValue(field);
                    if (!value || value === reportTitle(selectedReport)) return null;
                    return <div key={field.name} className="report-meta-inline">{value}</div>;
                  })}
                </div>
                {activeOrganisationCanWrite && <div className="item-actions">
                  {editingReportId !== selectedReport.id && (
                    <button
                      onClick={() => startEditingReport(selectedReport)}
                      className="secondary-btn"
                      disabled={loading}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteReport(selectedReport.id)}
                    className="delete-btn"
                    title="Delete this report"
                    disabled={loading}
                  >
                    Delete
                  </button>
                </div>}
              </div>
              {editingReportId === selectedReport.id && (
                <form
                  className="entity-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleUpdateReport(selectedReport);
                  }}
                >
                  <DynamicFieldInputs
                    fields={selectedReport.fieldValues}
                    values={editReportValues}
                    onChange={setEditReportValues}
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
                    <button type="button" className="secondary-btn" onClick={stopEditingReport} disabled={loading}>Cancel</button>
                  </div>
                </form>
              )}
              <div className="report-items">
                <strong>Included Items:</strong>
                <div className="report-items-list">
                  {selectedReport.selectedItemIds.length === 0 ? (
                    <p className="no-items-message">No items included in this report.</p>
                  ) : (
                    selectedReport.selectedItemIds.map(itemId => {
                      const item = getReportItemDetails(itemId);
                      return item ? (
                        <div key={itemId} className="report-item-entry">
                          <div className="report-item-entry-header">
                            <h5>{itemTitle(item)}</h5>
                            {activeOrganisationCanWrite && (
                              <button
                                className="remove-item-btn"
                                title="Remove from report"
                                onClick={() => handleRemoveItemFromReport(selectedReport.id, itemId)}
                              >
                                x
                              </button>
                            )}
                          </div>
                        </div>
                      ) : null;
                    })
                  )}
                </div>
                {activeOrganisationCanWrite && reportItems.length > 0 && (() => {
                  const available = reportItems.filter(it => !reportHasItem(selectedReport, it));
                  if (available.length === 0) return null;
                  return (
                    <div className="add-item-entry">
                      <label htmlFor={`add-item-${selectedReport.id}`}>Add item:</label>
                      <select
                        id={`add-item-${selectedReport.id}`}
                        value={reportAddSelection[selectedReport.id] || ''}
                        onChange={(e) => setReportAddSelection({ ...reportAddSelection, [selectedReport.id]: e.target.value })}
                      >
                        <option value="">-- select --</option>
                        {available.map(it => (
                          <option key={it.entryNumber} value={it.entryNumber}>
                            {itemTitle(it)}
                          </option>
                        ))}
                      </select>
                      <button
                        className="generate-btn"
                        onClick={() => handleAddItemToExistingReport(selectedReport.id)}
                        disabled={!reportAddSelection[selectedReport.id] || loading}
                      >
                        Add
                      </button>
                    </div>
                  );
                })()}
              </div>
              {selectedReport.createdAt && (
                <div className="report-meta">
                  Created: {formatTimestamp(selectedReport.createdAt)}
                  {selectedReport.updatedAt && (
                    <div>Updated: {formatTimestamp(selectedReport.updatedAt)}</div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="report-detail-surface empty-detail">
              <h3>No report selected</h3>
            </div>
          )}
        </main>
      </div>
    </div>
    </OrganisationGate>
  );
}
