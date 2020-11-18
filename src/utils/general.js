
const { ExportError, ErrorMessages } = require('../errors/ExportError');
const {
  caseProperty,
  sessionProperty,
  remoteProtocolProperty,
  entityAttributesProperty,
  sessionExportTimeProperty,
  codebookHashProperty,
} = require('./reservedAttributes');

// Session vars should match https://github.com/codaco/graphml-schemas/blob/master/xmlns/1.0/graphml%2Bnetcanvas.xsd
const verifySessionVariables = (sessionVariables) => {
  if (
    !sessionVariables[caseProperty]
    || !sessionVariables[sessionProperty]
    || !sessionVariables[remoteProtocolProperty]
    || !sessionVariables[sessionExportTimeProperty]
    || !sessionVariables[codebookHashProperty]
  ) {
    throw new ExportError(ErrorMessages.MissingParameters);
  }

  return true;
};

const getEntityAttributes = entity => (entity && entity[entityAttributesProperty]) || {};

const escapeFilePart = part => part.replace(/\W/g, '');

const sleep = (time = 2000) => () => new Promise(resolve => setTimeout(resolve, time));

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

const extensions = {
  graphml: '.graphml',
  csv: '.csv',
};

/**
 * Provide the appropriate file extension for the export type
 * @param  {string} formatterType one of the `format`s
 * @return {string}
 */
const getFileExtension = (formatterType) => {
  switch (formatterType) {
    case 'graphml':
      return extensions.graphml;
    case 'adjacencyMatrix':
    case 'edgeList':
    case 'attributeList':
    case 'ego':
      return extensions.csv;
    default:
      return null;
  }
};

const extensionPattern = new RegExp(`${Object.values(extensions).join('|')}$`);

module.exports = {
  escapeFilePart,
  extensionPattern,
  extensions,
  getEntityAttributes,
  getFileExtension,
  makeFilename,
  verifySessionVariables,
  sleep,
};
