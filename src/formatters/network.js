/* eslint-disable no-underscore-dangle */
import {
  entityPrimaryKeyProperty,
  egoProperty,
  sessionProperty,
  exportIDProperty,
  exportFromProperty,
  exportToProperty,
  ncSourceUUID,
  ncTargetUUID,
  edgeSourceProperty,
  edgeTargetProperty,
} from '../utils/reservedAttributes';
import { getEntityAttributes } from './utils';
import { getEntityAttributesWithNamesResolved } from '../../../networkFormat';

const { includes } = require('lodash');

export const unionOfNetworks = sessions =>
  sessions.reduce((union, session) => {
    union.nodes.push(...session.nodes);
    union.edges.push(...session.edges);
    union.ego.push(session.ego);
    return union;
  }, { nodes: [], edges: [], ego: [], [sessionProperty]: '' }); // Reset session ID


// Determine which variables to include
export const processEntityVariables = (entity, variables) => ({
  ...entity,
  attributes: Object.keys(getEntityAttributes(entity)).reduce(
    (accumulatedAttributes, attributeName) => {
      const attributeData = getEntityAttributes(entity)[attributeName];
      if (variables[attributeName] && variables[attributeName].type === 'categorical') {
        const optionNames = variables[attributeName].options || [];
        const optionData = optionNames.reduce((accumulatedOptions, optionName) => (
          {
            ...accumulatedOptions,
            [`${attributeName}_${optionName.value}`]: !!attributeData && includes(attributeData, optionName.value),
          }
        ), {});
        return { ...accumulatedAttributes, ...optionData };
      }

      if (variables[attributeName] && variables[attributeName].type === 'layout') {
        const layoutAttrs = {
          [`${attributeName}_x`]: attributeData && attributeData.x,
          [`${attributeName}_y`]: attributeData && attributeData.y,
        };
        return { ...accumulatedAttributes, ...layoutAttrs };
      }
      return { ...accumulatedAttributes, [attributeName]: attributeData };
    }, {},
  ),
});

// Iterates a network, and adds an attribute to nodes and edges
// that references the ego ID that nominated it
export const insertNetworkEgo = session => (
  {
    ...session,
    nodes: session.nodes.map(node => (
      { [egoProperty]: session.ego[entityPrimaryKeyProperty], ...node }
    )),
    edges: session.edges.map(edge => (
      { [egoProperty]: session.ego[entityPrimaryKeyProperty], ...edge }
    )),
  }
);

export const insertEgoIntoSessionNetworks = sessions => (
  sessions.map(session => insertNetworkEgo(session))
);

/**
 * Partition a network as needed for edge-list and adjacency-matrix formats.
 * Each network contains a reference to the original nodes, with a subset of edges
 * based on the type.
 *
 * @param  {Object} codebook
 * @param  {Array} session in NC format
 * @param  {string} format one of `formats`
 * @return {Array} An array of networks, partitioned by edge type. Each network object is decorated
 *                 with an additional `edgeType` prop to facilitate format naming.
 */
export const partitionNetworkByType = (codebook, session, format) => {
  console.log(
    'entered function',
    format,
    session,
  )

  const getEntityName = (uuid, type) => codebook[type][uuid].name || null;

  switch (format) {
    case 'graphml':
    case 'ego': {
      return [session];
    }
    case 'attributeList': {
      if (!session.nodes.length) {
        return [session];
      }

      const partitionedNodeMap = session.nodes.reduce((nodeMap, node) => {
        nodeMap[node.type] = nodeMap[node.type] || []; // eslint-disable-line no-param-reassign
        nodeMap[node.type].push(node);
        return nodeMap;
      }, {});

      return Object.entries(partitionedNodeMap).map(([nodeType, nodes]) => ({
        ...session,
        nodes,
        partitionEntity: getEntityName(nodeType, 'node'),
      }));
    }
    case 'edgeList':
    case 'adjacencyMatrix': {
      if (!session.edges.length) {
        return [session];
      }

      const partitionedEdgeMap = session.edges.reduce((edgeMap, edge) => {
        edgeMap[edge.type] = edgeMap[edge.type] || []; // eslint-disable-line no-param-reassign
        edgeMap[edge.type].push(edge);
        return edgeMap;
      }, {});

      return Object.entries(partitionedEdgeMap).map(([edgeType, edges]) => ({
        ...session,
        edges,
        partitionEntity: getEntityName(edgeType, 'edge'),
      }));
    }
    default:
      throw new Error('Unexpected format', format);
  }
};


// Iterates sessions and adds an automatically incrementing counter to
// allow for human readable IDs
export const resequenceIds = (sessions) => {
  let resequencedId = 0;
  const IDLookupMap = {}; // Create a lookup object { [oldID] -> [incrementedID] }
  const resequencedEntities = sessions.map(session => ({
    ...session,
    nodes: session.nodes.map(
      (node) => {
        resequencedId += 1;
        IDLookupMap[node[entityPrimaryKeyProperty]] = resequencedId;
        return {
          [exportIDProperty]: resequencedId,
          ...node,
        };
      },
    ),
    edges: session.edges.map(
      (edge) => {
        resequencedId += 1;
        IDLookupMap[edge[entityPrimaryKeyProperty]] = resequencedId;
        return {
          ...edge,
          [ncSourceUUID]: edge[edgeSourceProperty],
          [ncTargetUUID]: edge[edgeTargetProperty],
          [exportIDProperty]: resequencedId,
          from: IDLookupMap[edge[edgeSourceProperty]],
          to: IDLookupMap[edge[edgeTargetProperty]],
        };
      },
    ),
  }));

  return resequencedEntities;
};

// Transpose network entity variables to their human readable
// names using the protocol codebook.
export const ncCodebookTranspose = (network, codebook) => {
  const { nodes = [], edges = [], ego = {}, sessionVariables } = network;
  const { node: nodeRegistry = {}, edge: edgeRegistry = {}, ego: egoRegistry = {} } = codebook;

  return ({
    nodes: nodes.map(node => asExportableNode(node, nodeRegistry[node.type])),
    edges: edges.map(edge => asExportableEdge(edge, edgeRegistry[edge.type])),
    ego: asExportableEgo(ego, egoRegistry),
    sessionVariables,
  });
}

/**
 * Transposes attribute and type IDs to names for export.
 * Unlike `asWorkerAgentEntity()`, this does not flatten attributes.
 */
export const asExportableNode = (node, nodeTypeDefinition) => ({
  ...node,
  type: nodeTypeDefinition.name,
  attributes: getEntityAttributesWithNamesResolved(node, (nodeTypeDefinition || {}).variables),
});

export const asExportableEdge = (edge, edgeTypeDefinition) => ({
  ...edge,
  type: edgeTypeDefinition && edgeTypeDefinition.name,
  attributes: getEntityAttributesWithNamesResolved(edge, (edgeTypeDefinition || {}).variables),
});

export const asExportableEgo = (ego, egoDefinition) => ({
  ...ego,
  attributes: getEntityAttributesWithNamesResolved(ego, (egoDefinition || {}).variables),
});
