import { entityAttributesProperty } from '../utils/reservedAttributes';

/**
 * @module ExportUtils
 */
export const getEntityAttributes = node => (node && node[entityAttributesProperty]) || {};


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
 * Partition a network as needed for edge-list and adjacency-matrix formats.
 * Each network contains a reference to the original nodes, with a subset of edges
 * based on the type.
 *
 * @param  {Array} network in NC format
 * @param  {string} format one of `formats`
 * @return {Array} An array of networks, partitioned by edge type. Each network object is decorated
 *                 with an additional `edgeType` prop to facilitate format naming.
 */
export const partitionByEdgeType = (network, format) => {
  switch (format) {
    case 'graphml':
    case 'ego':
    case 'attributeList':
      return [network];
    case 'edgeList':
    case 'adjacencyMatrix': {
      if (!network.edges.length) {
        return [network];
      }

      const { nodes } = network;
      const partitionedEdgeMap = network.edges.reduce((edgeMap, edge) => {
        edgeMap[edge.type] = edgeMap[edge.type] || []; // eslint-disable-line no-param-reassign
        edgeMap[edge.type].push(edge);
        return edgeMap;
      }, {});

      return Object.entries(partitionedEdgeMap).map(([edgeType, edges]) => ({
        nodes,
        edges,
        edgeType,
      }));
    }
    default:
      throw new Error('Unexpected format', format);
  }
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
