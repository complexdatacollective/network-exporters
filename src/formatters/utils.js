import { entityAttributesProperty } from '../utils/reservedAttributes';

/**
 * @module ExportUtils
 */
export const getEntityAttributes = entity => (entity && entity[entityAttributesProperty]) || {};

// This conversion is required because the Ego R package depends on numerical node IDs:
// https://github.com/codaco/Server/pull/237#issuecomment-479141519
// export const convertUuidToDecimal = uuid => (
//   uuid ? BigInt(`0x${uuid.toString().replace(/-/g, '')}`).toString(10) : uuid
// );
export const convertUuidToDecimal = uuid => uuid;

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
