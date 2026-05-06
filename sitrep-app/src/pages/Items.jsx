import { useEffect, useState } from 'react';
import { useQuery, useMutation, gql } from '@apollo/client';

const GET_REPORT_ITEMS = gql`
  query GetReportItems {
    reportItems {
      entryNumber
      reportId
      reportTitle
      reportNumber
      reportDate
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
  mutation DeleteReportItem($id: ID!) {
    deleteReportItem(id: $id)
  }
`;

const ADD_ITEM_TO_REPORT = gql`
  mutation AddItemToReport($reportId: ID!, $itemId: ID!) {
    addItemToReport(reportId: $reportId, itemId: $itemId)
  }
`;

const REMOVE_ITEM_FROM_REPORT = gql`
  mutation RemoveItemFromReport($reportId: ID!, $itemId: ID!) {
    removeItemFromReport(reportId: $reportId, itemId: $itemId)
  }
`;

function notifyReportsUpdated() {
  window.dispatchEvent(new Event('reportsUpdated'));
  const currentValue = localStorage.getItem('reportsUpdated');
  localStorage.setItem('reportsUpdated', currentValue === '1' ? '0' : '1');
}

function displayValue(field) {
  if (!field.value) return '';
  if (field.kind === 'array') return JSON.parse(field.value).join(', ');
  if (field.kind === 'group' || field.kind === 'location') {
    const groupValue = JSON.parse(field.value);
    return (field.subfields || [])
      .map(subfield => {
        const value = groupValue?.[subfield.name];
        return value ? `${subfield.label || subfield.name}: ${value}` : null;
      })
      .filter(Boolean)
      .join(', ');
  }
  if (field.kind === 'conditional') {
    const conditionalValue = JSON.parse(field.value);
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

function itemTitle(item) {
  const primaryValue = item.fieldValues.find(field => field.value && field.kind === 'scalar')?.value;
  return `Entry #${item.entryNumber}${primaryValue ? `: ${primaryValue}` : ''}`;
}

function reportTitle(report) {
  return report.fieldValues?.find(field => field.value && field.kind === 'scalar')?.value || `#${report.id}`;
}

export default function Items() {
  const [selectedReportByItem, setSelectedReportByItem] = useState({});
  const [actionError, setActionError] = useState('');

  const { data: itemsData, loading: itemsLoading, error: itemsError, refetch: refetchItems } = useQuery(GET_REPORT_ITEMS);
  const { data: reportsData, loading: reportsLoading, error: reportsError, refetch: refetchReports } = useQuery(GET_REPORTS);
  const [deleteReportItem] = useMutation(DELETE_REPORT_ITEM, {
    refetchQueries: [{ query: GET_REPORT_ITEMS }, { query: GET_REPORTS }]
  });
  const [addItemToReport] = useMutation(ADD_ITEM_TO_REPORT, {
    refetchQueries: [{ query: GET_REPORT_ITEMS }, { query: GET_REPORTS }]
  });
  const [removeItemFromReport] = useMutation(REMOVE_ITEM_FROM_REPORT, {
    refetchQueries: [{ query: GET_REPORT_ITEMS }, { query: GET_REPORTS }]
  });

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
  const loading = itemsLoading || reportsLoading;
  const error = actionError || itemsError?.message || reportsError?.message;

  const handleAddToReport = async (itemId) => {
    const reportId = selectedReportByItem[itemId];
    if (!reportId) return;

    try {
      setActionError('');
      await addItemToReport({ variables: { reportId, itemId } });
      setSelectedReportByItem({ ...selectedReportByItem, [itemId]: '' });
      notifyReportsUpdated();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleDeleteReportItem = async (id) => {
    try {
      setActionError('');
      await deleteReportItem({ variables: { id } });
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleClearItemReport = async (itemId) => {
    const item = reportItems.find(i => i.entryNumber === itemId);
    if (!item?.reportId) return;

    try {
      setActionError('');
      await removeItemFromReport({ variables: { reportId: item.reportId, itemId } });
      notifyReportsUpdated();
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <div className="items">
      <h2>Report Items</h2>
      {error && <div className="error-message">{error}</div>}

      <div className="report-items-list">
        <h3>Submitted Items ({reportItems.length})</h3>
        {loading && <p>Loading...</p>}
        {reportItems.length === 0 && !loading ? (
          <p>No items submitted yet.</p>
        ) : (
          <div className="report-items-container">
            {reportItems.map(item => (
              <div key={item.entryNumber} className="report-item-card">
                <h4>{itemTitle(item)}</h4>

                <div className="event-data-details">
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

                {item.reportId && (
                  <div className="report-assignment">
                    <strong>Assigned to report:</strong> {item.reportNumber || item.reportTitle}
                    {item.reportDate ? ` on ${new Date(item.reportDate).toLocaleDateString()}` : ''}
                  </div>
                )}

                <div className="item-actions">
                  {!item.reportId && reports.length > 0 && (
                    <>
                      <select
                        value={selectedReportByItem[item.entryNumber] || ''}
                        onChange={(e) => setSelectedReportByItem({ ...selectedReportByItem, [item.entryNumber]: e.target.value })}
                      >
                        <option value="">-- add to report --</option>
                        {reports.map(r => (
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
