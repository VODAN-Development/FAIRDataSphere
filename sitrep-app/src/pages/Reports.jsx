import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, gql } from '@apollo/client';

const GET_RDF_STRUCTURE = gql`
  query GetRdfStructureForReports {
    rdfStructure {
      reportFields {
        name
        label
        required
        inputType
        kind
        datatype
      }
    }
  }
`;

const GET_REPORT_ITEMS = gql`
  query GetReportItems {
    reportItems {
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
  query GetReports {
    reports {
      id
      selectedItemIds
      createdAt
      fieldValues {
        name
        label
        value
        kind
      }
    }
  }
`;

const CREATE_REPORT = gql`
  mutation CreateReportFromFields($fieldValues: [RdfFieldValueInput!]!, $selectedItemIds: [Int!]!) {
    createReportFromFields(fieldValues: $fieldValues, selectedItemIds: $selectedItemIds) {
      id
    }
  }
`;

const DELETE_REPORT = gql`
  mutation DeleteReport($id: ID!) {
    deleteReport(id: $id)
  }
`;

const REMOVE_ITEM_FROM_REPORT = gql`
  mutation RemoveItemFromReport($reportId: ID!, $itemId: ID!) {
    removeItemFromReport(reportId: $reportId, itemId: $itemId)
  }
`;

const ADD_ITEM_TO_REPORT = gql`
  mutation AddItemToReport($reportId: ID!, $itemId: ID!) {
    addItemToReport(reportId: $reportId, itemId: $itemId)
  }
`;

function notifyReportsUpdated() {
  window.dispatchEvent(new Event('reportsUpdated'));
  const currentValue = localStorage.getItem('reportsUpdated');
  localStorage.setItem('reportsUpdated', currentValue === '1' ? '0' : '1');
}

function serializeValue(field, value) {
  if (field.kind === 'array') return JSON.stringify((value || []).filter(Boolean));
  return value || null;
}

function displayValue(field) {
  if (!field.value) return '';
  if (field.kind === 'array') return JSON.parse(field.value).join(', ');
  return field.value;
}

function itemTitle(item) {
  const primaryValue = item.fieldValues.find(field => field.value && field.kind === 'scalar')?.value;
  return `Entry #${item.entryNumber}${primaryValue ? `: ${primaryValue}` : ''}`;
}

function reportTitle(report) {
  return report.fieldValues?.find(field => field.value && field.kind === 'scalar')?.value || `#${report.id}`;
}

export default function Reports() {
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [formData, setFormData] = useState({});
  const [error, setError] = useState('');
  const [reportAddSelection, setReportAddSelection] = useState({});

  const { data: structureData, loading: structureLoading, error: structureError } = useQuery(GET_RDF_STRUCTURE);
  const { data: itemsData, loading: itemsLoading, error: itemsError, refetch: refetchItems } = useQuery(GET_REPORT_ITEMS);
  const { data: reportsData, loading: reportsLoading, error: reportsError, refetch: refetchReports } = useQuery(GET_REPORTS);
  const [createReport] = useMutation(CREATE_REPORT, {
    refetchQueries: [{ query: GET_REPORTS }, { query: GET_REPORT_ITEMS }]
  });
  const [deleteReport] = useMutation(DELETE_REPORT, {
    refetchQueries: [{ query: GET_REPORTS }, { query: GET_REPORT_ITEMS }]
  });
  const [removeItemFromReport] = useMutation(REMOVE_ITEM_FROM_REPORT, {
    refetchQueries: [{ query: GET_REPORTS }, { query: GET_REPORT_ITEMS }]
  });
  const [addItemToReport] = useMutation(ADD_ITEM_TO_REPORT, {
    refetchQueries: [{ query: GET_REPORTS }, { query: GET_REPORT_ITEMS }]
  });

  const fields = useMemo(() => structureData?.rdfStructure?.reportFields || [], [structureData]);
  const initializedForm = useMemo(() => {
    return Object.fromEntries(fields.map(field => [field.name, formData[field.name] ?? '']));
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

  const reportItems = itemsData?.reportItems || [];
  const reports = reportsData?.reports || [];
  const gqlError = structureError || itemsError || reportsError;
  const loading = structureLoading || itemsLoading || reportsLoading;

  const handleAddItemToExistingReport = async (reportId) => {
    const itemId = reportAddSelection[reportId];
    if (!itemId) return;
    try {
      await addItemToReport({ variables: { reportId, itemId } });
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

    if (selectedItems.size === 0) {
      setError('Please select at least one report item');
      return;
    }

    try {
      setError('');
      const result = await createReport({
        variables: {
          fieldValues: fields.map(field => ({ name: field.name, value: serializeValue(field, initializedForm[field.name]) })),
          selectedItemIds: Array.from(selectedItems)
        }
      });

      alert(`Report created successfully! Report Number: ${result.data.createReportFromFields.id}`);
      setFormData({});
      setSelectedItems(new Set());
    } catch (err) {
      setError('Error creating report: ' + err.message);
    }
  };

  const handleDeleteReport = async (reportId) => {
    if (!window.confirm('Are you sure you want to delete this report?')) {
      return;
    }

    try {
      await deleteReport({ variables: { id: reportId } });
    } catch (err) {
      setError('Error deleting report: ' + err.message);
    }
  };

  const handleRemoveItemFromReport = async (reportId, itemId) => {
    try {
      await removeItemFromReport({ variables: { reportId, itemId } });
      notifyReportsUpdated();
    } catch (err) {
      setError('Error removing item: ' + err.message);
    }
  };

  const getReportItemDetails = (itemId) => {
    return reportItems.find(item => Number(item.entryNumber) === Number(itemId));
  };

  return (
    <div className="reports-page">
      <h2>Create Reports</h2>

      {(error || gqlError) && <div className="error-message">{error || gqlError.message}</div>}

      <div className="report-creation-section">
        <h3>Create a New Report</h3>
        <form onSubmit={handleCreateReport}>
          {fields.map(field => (
            <div key={field.name} className="form-group">
              <label htmlFor={field.name}>{field.label || field.name}:</label>
              <input
                id={field.name}
                type={field.inputType === 'date' ? 'date' : 'text'}
                value={initializedForm[field.name] || ''}
                onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                placeholder={field.label || field.name}
                disabled={loading}
                required={field.required}
              />
            </div>
          ))}

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
                        disabled={!!item.reportId}
                      />
                      <label htmlFor={`item-${item.entryNumber}`}>
                        <strong>{itemTitle(item)}</strong>
                        {item.reportId && <span className="disabled-notice"> (already in report)</span>}
                      </label>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || selectedItems.size === 0}
            className="create-report-button"
          >
            {loading ? 'Creating Report...' : 'Create Report'}
          </button>
        </form>
      </div>

      <div className="reports-list-section">
        <h3>Created Reports ({reports.length})</h3>
        {reports.length === 0 ? (
          <p className="no-reports-message">No reports created yet. Create one above!</p>
        ) : (
          <div className="reports-grid">
            {reports.map(report => (
              <div key={report.id} className="report-card">
                <div className="report-header">
                  <div className="report-header-info">
                    <h4>{reportTitle(report)}</h4>
                    {report.fieldValues.map(field => {
                      const value = displayValue(field);
                      if (!value || value === reportTitle(report)) return null;
                      return <div key={field.name} className="report-meta-inline">{value}</div>;
                    })}
                  </div>
                  <button
                    onClick={() => handleDeleteReport(report.id)}
                    className="delete-button"
                    title="Delete this report"
                  >
                    x
                  </button>
                </div>
                <div className="report-items">
                  <strong>Included Items:</strong>
                  <div className="report-items-list">
                    {report.selectedItemIds.map(itemId => {
                      const item = getReportItemDetails(itemId);
                      return item ? (
                        <div key={itemId} className="report-item-entry">
                          <div className="report-item-entry-header">
                            <h5>{itemTitle(item)}</h5>
                            <button
                              className="remove-item-btn"
                              title="Remove from report"
                              onClick={() => handleRemoveItemFromReport(report.id, itemId)}
                            >
                              x
                            </button>
                          </div>
                        </div>
                      ) : null;
                    })}
                  </div>
                  {reportItems.length > 0 && (() => {
                    const available = reportItems.filter(it => !it.reportId);
                    if (available.length === 0) return null;
                    return (
                      <div className="add-item-entry">
                        <label htmlFor={`add-item-${report.id}`}>Add item:</label>
                        <select
                          id={`add-item-${report.id}`}
                          value={reportAddSelection[report.id] || ''}
                          onChange={(e) => setReportAddSelection({ ...reportAddSelection, [report.id]: e.target.value })}
                        >
                          <option value="">-- select --</option>
                          {available.map(it => (
                            <option key={it.entryNumber} value={it.entryNumber}>
                              {itemTitle(it)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAddItemToExistingReport(report.id)}
                          disabled={!reportAddSelection[report.id] || loading}
                        >
                          Add
                        </button>
                      </div>
                    );
                  })()}
                </div>
                <div className="report-meta">
                  Created: {new Date(report.createdAt).toLocaleDateString()} at {new Date(report.createdAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
