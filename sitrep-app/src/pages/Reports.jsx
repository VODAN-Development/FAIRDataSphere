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

const GET_COMPILED_REPORT_CONFIG = gql`
  query GetCompiledReportConfig($organisationId: ID) {
    compiledReportConfig(organisationId: $organisationId) {
      organisationName
      reportSeriesTitle
      headerNote
      footerText
      accentColor
      includeFieldLabels
      itemFieldNames
    }
  }
`;

const GET_COMPILED_REPORTS = gql`
  query GetCompiledReports($organisationId: ID) {
    compiledReports(organisationId: $organisationId) {
      id
      sourceReportId
      title
      subtitle
      executiveSummary
      bodyHtml
      selectedItemIds
      itemFieldNames
      configSnapshot
      createdAt
      updatedAt
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

const SAVE_COMPILED_REPORT_CONFIG = gql`
  mutation SaveCompiledReportConfig($config: CompiledReportConfigInput!, $organisationId: ID) {
    updateCompiledReportConfig(config: $config, organisationId: $organisationId) {
      organisationName
      reportSeriesTitle
      headerNote
      footerText
      accentColor
      includeFieldLabels
      itemFieldNames
    }
  }
`;

const CREATE_COMPILED_REPORT = gql`
  mutation CreateCompiledReport($input: CompiledReportInput!, $organisationId: ID) {
    createCompiledReport(input: $input, organisationId: $organisationId) {
      id
    }
  }
`;

const UPDATE_COMPILED_REPORT = gql`
  mutation UpdateCompiledReport($id: ID!, $input: CompiledReportUpdateInput!, $organisationId: ID) {
    updateCompiledReport(id: $id, input: $input, organisationId: $organisationId) {
      id
      title
      subtitle
      executiveSummary
      bodyHtml
      selectedItemIds
      itemFieldNames
      updatedAt
    }
  }
`;

const DEFAULT_COMPILED_CONFIG = {
  organisationName: 'EEPA',
  reportSeriesTitle: 'Situation Report EEPA Horn',
  headerNote: 'Situation report',
  footerText: 'Compiled from SITREP report items.',
  accentColor: '#1f4e79',
  includeFieldLabels: true,
  itemFieldNames: [],
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function safeFilename(value, fallback = 'compiled-report') {
  return String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function fieldValueByName(fields, name) {
  return fields.find(field => field.name === name);
}

function itemParagraph(item) {
  return displayValue(fieldValueByName(item.fieldValues, 'paragraph') || {}) || itemTitle(item);
}

function generatedBodyHtml({ report, items, config, selectedItemIds, itemFieldNames }) {
  const orderedItems = selectedItemIds
    .map(itemId => items.find(item => Number(item.entryNumber) === Number(itemId)))
    .filter(Boolean);
  const includedNames = new Set(itemFieldNames || []);
  return orderedItems.map((item, index) => {
    const detailRows = item.fieldValues
      .filter(field => field.value && (!includedNames.size || includedNames.has(field.name)))
      .filter(field => field.name !== 'paragraph' && field.name !== 'title')
      .map(field => {
        const value = displayValue(field);
        if (!value) return '';
        return config.includeFieldLabels
          ? `<p class="compiled-field"><strong>${escapeHtml(field.label || field.name)}:</strong> ${textToHtml(value)}</p>`
          : `<p class="compiled-field">${textToHtml(value)}</p>`;
      })
      .join('');
    return `
      <section class="compiled-item">
        <h2>${index + 1}. ${escapeHtml(itemTitle(item))}</h2>
        <p>${textToHtml(itemParagraph(item))}</p>
        ${detailRows}
      </section>
    `;
  }).join('\n') || `<p>${escapeHtml(`No report items selected for ${reportTitle(report)}.`)}</p>`;
}

function compiledHtmlDocument(compiledReport, config) {
  const accent = config.accentColor || DEFAULT_COMPILED_CONFIG.accentColor;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(compiledReport.title)}</title>
  <style>
    @page { margin: 18mm 16mm; }
    body { color: #1e2933; font-family: Georgia, 'Times New Roman', serif; line-height: 1.48; margin: 0; background: #f2f4f7; }
    .page { background: #fff; box-sizing: border-box; margin: 0 auto; max-width: 820px; min-height: 100vh; padding: 34px 42px 42px; }
    .masthead { border-bottom: 4px solid ${accent}; display: grid; gap: 8px; padding-bottom: 16px; }
    .org { color: ${accent}; font: 700 14px Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
    h1 { color: #102a43; font-size: 30px; line-height: 1.15; margin: 0; }
    .subtitle { color: #52606d; font: 600 14px Arial, sans-serif; margin: 0; }
    .summary { border-left: 4px solid ${accent}; margin: 24px 0; padding: 10px 0 10px 16px; }
    .compiled-item { border-top: 1px solid #d9e2ec; padding: 18px 0; }
    .compiled-item h2 { color: ${accent}; font: 700 18px Arial, sans-serif; margin: 0 0 8px; }
    .compiled-field { color: #334e68; font-size: 14px; margin: 6px 0; }
    footer { border-top: 1px solid #d9e2ec; color: #66788a; font: 12px Arial, sans-serif; margin-top: 30px; padding-top: 12px; }
    @media print { body { background: #fff; } .page { max-width: none; padding: 0; } }
  </style>
</head>
<body>
  <article class="page">
    <header class="masthead">
      <div class="org">${escapeHtml(config.organisationName || '')}</div>
      <h1>${escapeHtml(compiledReport.title)}</h1>
      <p class="subtitle">${escapeHtml(compiledReport.subtitle || config.headerNote || '')}</p>
    </header>
    ${compiledReport.executiveSummary ? `<section class="summary">${textToHtml(compiledReport.executiveSummary)}</section>` : ''}
    <main>${compiledReport.bodyHtml || ''}</main>
    <footer>${escapeHtml(config.footerText || '')}</footer>
  </article>
</body>
</html>`;
}

function downloadHtml(filename, html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function compiledConfigInput(config, itemFieldNames = config.itemFieldNames || []) {
  return {
    organisationName: config.organisationName || '',
    reportSeriesTitle: config.reportSeriesTitle || '',
    headerNote: config.headerNote || '',
    footerText: config.footerText || '',
    accentColor: config.accentColor || DEFAULT_COMPILED_CONFIG.accentColor,
    includeFieldLabels: !!config.includeFieldLabels,
    itemFieldNames,
  };
}

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
  const [compileItemIds, setCompileItemIds] = useState(new Set());
  const [compileFieldNames, setCompileFieldNames] = useState(new Set());
  const [compiledConfigDraft, setCompiledConfigDraft] = useState(DEFAULT_COMPILED_CONFIG);
  const [selectedCompiledReportId, setSelectedCompiledReportId] = useState('');
  const [compiledEditDraft, setCompiledEditDraft] = useState(null);

  const queryVariables = { organisationId: activeOrganisationId };
  const refetchScopedQueries = [
    { query: GET_REPORTS, variables: queryVariables },
    { query: GET_REPORT_ITEMS, variables: queryVariables },
    { query: GET_COMPILED_REPORTS, variables: queryVariables },
    { query: GET_COMPILED_REPORT_CONFIG, variables: queryVariables },
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
  const { data: compiledConfigData, loading: compiledConfigLoading, error: compiledConfigError } = useQuery(GET_COMPILED_REPORT_CONFIG, {
    variables: queryVariables,
    skip: !activeOrganisationId && !activeOrganisationIsUnscoped,
  });
  const { data: compiledReportsData, loading: compiledReportsLoading, error: compiledReportsError, refetch: refetchCompiledReports } = useQuery(GET_COMPILED_REPORTS, {
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
  const [saveCompiledReportConfig] = useMutation(SAVE_COMPILED_REPORT_CONFIG, {
    refetchQueries: refetchScopedQueries
  });
  const [createCompiledReport] = useMutation(CREATE_COMPILED_REPORT, {
    refetchQueries: refetchScopedQueries
  });
  const [updateCompiledReport] = useMutation(UPDATE_COMPILED_REPORT, {
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
      refetchCompiledReports();
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
  }, [refetchItems, refetchReports, refetchCompiledReports]);

  useEffect(() => {
    if (compiledConfigData?.compiledReportConfig) {
      const config = compiledConfigInput({
        ...DEFAULT_COMPILED_CONFIG,
        ...compiledConfigData.compiledReportConfig,
      }, compiledConfigData.compiledReportConfig.itemFieldNames || []);
      setCompiledConfigDraft(config);
      setCompileFieldNames(new Set(config.itemFieldNames || []));
    }
  }, [compiledConfigData]);

  const reportItems = useMemo(() => itemsData?.reportItems || [], [itemsData]);
  const reports = useMemo(() => reportsData?.reports || [], [reportsData]);
  const compiledReports = useMemo(() => compiledReportsData?.compiledReports || [], [compiledReportsData]);
  const compiledConfig = compiledConfigData?.compiledReportConfig || compiledConfigDraft || DEFAULT_COMPILED_CONFIG;
  const itemFieldOptions = useMemo(() => {
    const fieldsByName = new Map();
    reportItems.forEach(item => item.fieldValues.forEach(field => {
      if (!field.name || fieldsByName.has(field.name)) return;
      fieldsByName.set(field.name, { name: field.name, label: field.label || field.name });
    }));
    return Array.from(fieldsByName.values());
  }, [reportItems]);
  const gqlError = structureError || itemsError || reportsError || compiledConfigError || compiledReportsError;
  const loading = structureLoading || itemsLoading || reportsLoading || compiledConfigLoading || compiledReportsLoading;
  const selectedReport = !isCreatingReport
    ? reports.find(report => String(report.id) === String(selectedReportId)) || reports[0] || null
    : null;
  const selectedCompiledReport = compiledReports.find(report => String(report.id) === String(selectedCompiledReportId))
    || compiledReports.find(report => String(report.sourceReportId) === String(selectedReport?.id))
    || compiledReports[0]
    || null;

  useEffect(() => {
    if (selectedReport?.selectedItemIds) {
      setCompileItemIds(new Set(selectedReport.selectedItemIds.map(Number)));
    }
  }, [selectedReport?.id]);

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

  const toggleCompileItem = (itemId) => {
    const numericItemId = Number(itemId);
    setCompileItemIds(current => {
      const next = new Set(current);
      if (next.has(numericItemId)) next.delete(numericItemId);
      else next.add(numericItemId);
      return next;
    });
  };

  const toggleCompileField = (fieldName) => {
    setCompileFieldNames(current => {
      const next = new Set(current);
      if (next.has(fieldName)) next.delete(fieldName);
      else next.add(fieldName);
      return next;
    });
  };

  const handleSaveCompiledConfig = async () => {
    try {
      setError('');
      const itemFieldNames = Array.from(compileFieldNames);
      await saveCompiledReportConfig({
        variables: {
          organisationId: activeOrganisationId,
          config: compiledConfigInput(compiledConfigDraft, itemFieldNames),
        },
      });
    } catch (err) {
      setError('Error saving compiled report configuration: ' + err.message);
    }
  };

  const handleCompileReport = async () => {
    if (!selectedReport) return;
    try {
      setError('');
      const selectedItemIds = Array.from(compileItemIds);
      const itemFieldNames = Array.from(compileFieldNames);
      const title = `${compiledConfig.reportSeriesTitle || 'Situation Report'} No. ${selectedReport.id}`;
      const subtitle = reportTitle(selectedReport);
      const executiveSummary = selectedItemIds.length
        ? `${selectedItemIds.length} report item${selectedItemIds.length === 1 ? '' : 's'} compiled from ${reportTitle(selectedReport)}.`
        : `Compiled report from ${reportTitle(selectedReport)}.`;
      const bodyHtml = generatedBodyHtml({
        report: selectedReport,
        items: reportItems,
        config: compiledConfig,
        selectedItemIds,
        itemFieldNames,
      });
      const result = await createCompiledReport({
        variables: {
          organisationId: activeOrganisationId,
          input: {
            sourceReportId: selectedReport.id,
            title,
            subtitle,
            executiveSummary,
            bodyHtml,
            selectedItemIds,
            itemFieldNames,
            configSnapshot: JSON.stringify(compiledConfig),
          },
        },
      });
      setSelectedCompiledReportId(result.data.createCompiledReport.id);
      setCompiledEditDraft(null);
      await refetchCompiledReports();
    } catch (err) {
      setError('Error compiling report: ' + err.message);
    }
  };

  const startEditingCompiledReport = (compiledReport) => {
    setCompiledEditDraft({
      id: compiledReport.id,
      title: compiledReport.title,
      subtitle: compiledReport.subtitle || '',
      executiveSummary: compiledReport.executiveSummary || '',
      bodyHtml: compiledReport.bodyHtml || '',
    });
  };

  const handleUpdateCompiledReport = async () => {
    if (!compiledEditDraft) return;
    try {
      setError('');
      await updateCompiledReport({
        variables: {
          id: compiledEditDraft.id,
          organisationId: activeOrganisationId,
          input: {
            title: compiledEditDraft.title,
            subtitle: compiledEditDraft.subtitle,
            executiveSummary: compiledEditDraft.executiveSummary,
            bodyHtml: compiledEditDraft.bodyHtml,
          },
        },
      });
      setCompiledEditDraft(null);
      await refetchCompiledReports();
    } catch (err) {
      setError('Error updating compiled report: ' + err.message);
    }
  };

  const handleDownloadCompiledReport = (compiledReport) => {
    let snapshot = compiledConfig;
    try {
      snapshot = { ...compiledConfig, ...JSON.parse(compiledReport.configSnapshot || '{}') };
    } catch {
      snapshot = compiledConfig;
    }
    downloadHtml(`${safeFilename(compiledReport.title)}.html`, compiledHtmlDocument(compiledReport, snapshot));
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
              <div className="compiled-report-panel">
                <div className="compiled-report-panel-header">
                  <div>
                    <h4>Compiled report</h4>
                    <p>Choose the items and fields to include, then store a print-ready compiled version.</p>
                  </div>
                  {activeOrganisationCanWrite && (
                    <button
                      type="button"
                      className="create-report-button"
                      onClick={handleCompileReport}
                      disabled={loading || compileItemIds.size === 0}
                    >
                      Compile Report
                    </button>
                  )}
                </div>

                <div className="compiled-config-grid">
                  <label>
                    Organisation
                    <input
                      type="text"
                      value={compiledConfigDraft.organisationName || ''}
                      onChange={(e) => setCompiledConfigDraft({ ...compiledConfigDraft, organisationName: e.target.value })}
                      disabled={!activeOrganisationCanWrite}
                    />
                  </label>
                  <label>
                    Series title
                    <input
                      type="text"
                      value={compiledConfigDraft.reportSeriesTitle || ''}
                      onChange={(e) => setCompiledConfigDraft({ ...compiledConfigDraft, reportSeriesTitle: e.target.value })}
                      disabled={!activeOrganisationCanWrite}
                    />
                  </label>
                  <label>
                    Header note
                    <input
                      type="text"
                      value={compiledConfigDraft.headerNote || ''}
                      onChange={(e) => setCompiledConfigDraft({ ...compiledConfigDraft, headerNote: e.target.value })}
                      disabled={!activeOrganisationCanWrite}
                    />
                  </label>
                  <label>
                    Accent
                    <input
                      type="color"
                      value={compiledConfigDraft.accentColor || DEFAULT_COMPILED_CONFIG.accentColor}
                      onChange={(e) => setCompiledConfigDraft({ ...compiledConfigDraft, accentColor: e.target.value })}
                      disabled={!activeOrganisationCanWrite}
                    />
                  </label>
                  <label className="compiled-config-wide">
                    Footer
                    <input
                      type="text"
                      value={compiledConfigDraft.footerText || ''}
                      onChange={(e) => setCompiledConfigDraft({ ...compiledConfigDraft, footerText: e.target.value })}
                      disabled={!activeOrganisationCanWrite}
                    />
                  </label>
                </div>

                <label className="compiled-toggle">
                  <input
                    type="checkbox"
                    checked={!!compiledConfigDraft.includeFieldLabels}
                    onChange={(e) => setCompiledConfigDraft({ ...compiledConfigDraft, includeFieldLabels: e.target.checked })}
                    disabled={!activeOrganisationCanWrite}
                  />
                  Show field labels in compiled item details
                </label>

                <div className="compiled-pickers">
                  <div>
                    <strong>Report items</strong>
                    <div className="compiled-checkbox-list">
                      {selectedReport.selectedItemIds.map(itemId => {
                        const item = getReportItemDetails(itemId);
                        return item ? (
                          <label key={itemId} className="compiled-checkbox">
                            <input
                              type="checkbox"
                              checked={compileItemIds.has(Number(itemId))}
                              onChange={() => toggleCompileItem(itemId)}
                            />
                            {itemTitle(item)}
                          </label>
                        ) : null;
                      })}
                    </div>
                  </div>
                  <div>
                    <strong>Item fields</strong>
                    <div className="compiled-checkbox-list">
                      {itemFieldOptions.map(field => (
                        <label key={field.name} className="compiled-checkbox">
                          <input
                            type="checkbox"
                            checked={compileFieldNames.has(field.name)}
                            onChange={() => toggleCompileField(field.name)}
                          />
                          {field.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {activeOrganisationCanWrite && (
                  <div className="item-actions">
                    <button type="button" className="secondary-btn" onClick={handleSaveCompiledConfig} disabled={loading}>
                      Save Layout Configuration
                    </button>
                  </div>
                )}
              </div>

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
              <div className="compiled-report-panel">
                <div className="compiled-report-panel-header">
                  <div>
                    <h4>Stored compiled reports</h4>
                    <p>Every compile is kept here for viewing, editing, and download.</p>
                  </div>
                  {selectedCompiledReport && (
                    <button
                      type="button"
                      className="create-report-button"
                      onClick={() => handleDownloadCompiledReport(selectedCompiledReport)}
                    >
                      Download Compiled Report
                    </button>
                  )}
                </div>
                {compiledReports.length === 0 ? (
                  <p className="no-items-message">No compiled reports stored yet.</p>
                ) : (
                  <div className="compiled-report-browser">
                    <div className="compiled-report-list">
                      {compiledReports.map(compiledReport => (
                        <button
                          key={compiledReport.id}
                          type="button"
                          className={String(compiledReport.id) === String(selectedCompiledReport?.id) ? 'selected' : ''}
                          onClick={() => {
                            setSelectedCompiledReportId(compiledReport.id);
                            setCompiledEditDraft(null);
                          }}
                        >
                          <strong>{compiledReport.title}</strong>
                          <span>{formatTimestamp(compiledReport.createdAt)}</span>
                        </button>
                      ))}
                    </div>
                    {selectedCompiledReport && (
                      <div className="compiled-report-editor">
                        {compiledEditDraft?.id === selectedCompiledReport.id ? (
                          <form onSubmit={(e) => {
                            e.preventDefault();
                            handleUpdateCompiledReport();
                          }}>
                            <label>
                              Title
                              <input
                                type="text"
                                value={compiledEditDraft.title}
                                onChange={(e) => setCompiledEditDraft({ ...compiledEditDraft, title: e.target.value })}
                              />
                            </label>
                            <label>
                              Subtitle
                              <input
                                type="text"
                                value={compiledEditDraft.subtitle}
                                onChange={(e) => setCompiledEditDraft({ ...compiledEditDraft, subtitle: e.target.value })}
                              />
                            </label>
                            <label>
                              Executive summary
                              <textarea
                                value={compiledEditDraft.executiveSummary}
                                onChange={(e) => setCompiledEditDraft({ ...compiledEditDraft, executiveSummary: e.target.value })}
                              />
                            </label>
                            <label>
                              Body HTML
                              <textarea
                                className="compiled-body-editor"
                                value={compiledEditDraft.bodyHtml}
                                onChange={(e) => setCompiledEditDraft({ ...compiledEditDraft, bodyHtml: e.target.value })}
                              />
                            </label>
                            <div className="item-actions">
                              <button type="submit" className="generate-btn" disabled={loading}>Save Compiled Report</button>
                              <button type="button" className="secondary-btn" onClick={() => setCompiledEditDraft(null)}>Cancel</button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="compiled-preview">
                              <h4>{selectedCompiledReport.title}</h4>
                              {selectedCompiledReport.subtitle && <p className="report-meta-inline">{selectedCompiledReport.subtitle}</p>}
                              {selectedCompiledReport.executiveSummary && <p>{selectedCompiledReport.executiveSummary}</p>}
                              <div dangerouslySetInnerHTML={{ __html: selectedCompiledReport.bodyHtml }} />
                            </div>
                            {activeOrganisationCanWrite && (
                              <div className="item-actions">
                                <button type="button" className="secondary-btn" onClick={() => startEditingCompiledReport(selectedCompiledReport)}>
                                  Edit Compiled Report
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
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
