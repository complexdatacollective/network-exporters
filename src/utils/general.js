
import {
  caseProperty,
  sessionProperty,
  remoteProtocolProperty,
  entityAttributesProperty,
  sessionExportTimeProperty,
} from './reservedAttributes';

// Session vars should match https://github.com/codaco/graphml-schemas/blob/master/xmlns/1.0/graphml%2Bnetcanvas.xsd
export const verifySessionVariables = (sessionVariables) => {
  if (
    !sessionVariables[caseProperty] ||
    !sessionVariables[sessionProperty] ||
    !sessionVariables[remoteProtocolProperty] ||
    !sessionVariables[sessionExportTimeProperty]
  ) {
    return Promise.reject(new ExportError(ErrorMessages.MissingParameters));
  }
}

export const getEntityAttributes = entity => (entity && entity[entityAttributesProperty]) || {};

export const makeFilename = (prefix, entityType, exportFormat, extension) => {
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

export const escapeFilePart = part => part.replace(/\W/g, '');

export const extensions = {
  graphml: '.graphml',
  csv: '.csv',
};

/**
 * Provide the appropriate file extension for the export type
 * @param  {string} formatterType one of the `format`s
 * @return {string}
 */
export const getFileExtension = (formatterType) => {
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

export const extensionPattern = new RegExp(`${Object.values(extensions).join('|')}$`);
