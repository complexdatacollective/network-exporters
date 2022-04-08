const { merge } = require('lodash');
const sanitizeFilename = require('sanitize-filename');
const { ExportError, ErrorMessages } = require('../consts/errors/ExportError');
const {
  caseProperty,
  sessionProperty,
  protocolProperty,
  entityAttributesProperty,
  sessionExportTimeProperty,
  codebookHashProperty,
} = require('../consts/reservedAttributes');
const { EXTENSIONS, DEFAULT_EXPORT_OPTIONS, FORMATS } = require('../consts/export-consts');

// Session vars should match https://github.com/codaco/graphml-schemas/blob/master/xmlns/1.0/graphml%2Bnetcanvas.xsd
const verifySessionVariables = (sessionVariables) => {
  if (
    !sessionVariables[caseProperty]
    || !sessionVariables[sessionProperty]
    || !sessionVariables[protocolProperty]
    || !sessionVariables[sessionExportTimeProperty]
    || !sessionVariables[codebookHashProperty]
  ) {
    throw new ExportError(ErrorMessages.MissingParameters);
  }

  return true;
};

const getEntityAttributes = (entity) => (entity && entity[entityAttributesProperty]) || {};

const escapeFilePart = (part) => part.replace(/\W/g, '');

const sleep = (time = 2000) => (passThrough) => (
  new Promise((resolve) => {
    setTimeout(() => resolve(passThrough), time);
  })
);

const makeFilename = (prefix, entityType, exportFormat, extension) => {
  let name = prefix;
  if (extension !== `.${exportFormat}`) {
    name += name ? '_' : '';
    name += exportFormat;
  }
  if (entityType) {
    name += `_${escapeFilePart(entityType)}`;
  }
  return `${name}${extension}`;
};

/**
 * Provide the appropriate file extension for the export type
 * @param  {string} formatterType one of the `format`s
 * @return {string}
 */
const getFileExtensionForType = (formatterType) => {
  switch (formatterType) {
    case 'graphml':
      return EXTENSIONS.graphml;
    case 'adjacencyMatrix':
    case 'edgeList':
    case 'attributeList':
    case 'ego':
      return EXTENSIONS.csv;
    default:
      return null;
  }
};

// Determine filename prefix based on if we are exporting a single session
// or a unified network
const getFilePrefix = (session, protocol, unifyNetworks) => {
  if (unifyNetworks) {
    return sanitizeFilename(protocol.name);
  }

  return `${sanitizeFilename(session.sessionVariables[caseProperty])}_${session.sessionVariables[sessionProperty]}`;
};

const inSequence = (items, apply) => items.reduce(
  (result, item) => result.then(() => apply(item)),
  Promise.resolve(),
);

const concatTypedArrays = (a, b) => {
  const combined = new Uint8Array(a.byteLength + b.byteLength);
  combined.set(a);
  combined.set(b, a.length);
  return combined;
};

const getFileExportListFromFormats = (
  formats,
  csvIncludeAdjacencyMatrix,
  csvIncludeAttributeList,
  csvIncludeEdgeList,
) => {
  if (!formats) {
    return [];
  }

  return [
    ...(formats.includes(FORMATS.graphml) ? ['graphml'] : []),
    ...(formats.includes(FORMATS.csv) ? [
      'ego',
      ...(csvIncludeAdjacencyMatrix ? ['adjacencyMatrix'] : []),
      ...(csvIncludeAttributeList ? ['attributeList'] : []),
      ...(csvIncludeEdgeList ? ['edgeList'] : []),
    ] : []),
  ];
};

// Merge default and user-supplied options
const getOptions = (exportOptions) => merge(DEFAULT_EXPORT_OPTIONS, exportOptions);

module.exports = {
  getOptions,
  getFileExportListFromFormats,
  concatTypedArrays,
  inSequence,
  escapeFilePart,
  getEntityAttributes,
  getFileExtensionForType,
  getFilePrefix,
  makeFilename,
  verifySessionVariables,
  sleep,
};
