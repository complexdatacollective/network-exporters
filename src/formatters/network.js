/* eslint-disable no-underscore-dangle */
const { includes } = require('lodash');
const {
  entityPrimaryKeyProperty,
  sessionProperty,
  egoProperty,
  exportIDProperty,
  ncSourceUUID,
  ncTargetUUID,
  edgeSourceProperty,
  edgeTargetProperty,
} = require('../utils/reservedAttributes');
const { getEntityAttributes } = require('../utils/general');
const { getAttributePropertyFromCodebook } = require('./graphml/helpers');

// Determine which variables to include
// TODO: Move this to CSV formatter, since only CSV uses it
const processEntityVariables = (entity, entityType, codebook, exportOptions) => ({
  ...entity,
  attributes: Object.keys(getEntityAttributes(entity)).reduce(
    (accumulatedAttributes, attributeUUID) => {
      const attributeName = getAttributePropertyFromCodebook(codebook, entityType, entity, attributeUUID, 'name');
      const attributeType = getAttributePropertyFromCodebook(codebook, entityType, entity, attributeUUID, 'type');
      const attributeData = getEntityAttributes(entity)[attributeUUID];

      if (attributeType === 'categorical') {
        const attributeOptions = getAttributePropertyFromCodebook(codebook, entityType, entity, attributeUUID, 'options') || [];
        const optionData = attributeOptions.reduce((accumulatedOptions, optionName) => (
          {
            ...accumulatedOptions,
            [`${attributeName}_${optionName.value}`]: !!attributeData && includes(attributeData, optionName.value),
          }
        ), {});
        return { ...accumulatedAttributes, ...optionData };
      }

      if (attributeType === 'layout') {
        // Process screenLayoutCoordinates option
        let xCoord;
        let yCoord;
        if (attributeData && exportOptions.globalOptions.useScreenLayoutCoordinates) {
          xCoord = (attributeData.x * exportOptions.globalOptions.screenLayoutWidth).toFixed(2);
          yCoord = ((1.0 - attributeData.y) * exportOptions.globalOptions.screenLayoutHeight)
            .toFixed(2);
        } else {
          xCoord = attributeData && attributeData.x;
          yCoord = attributeData && attributeData.y;
        }

        const layoutAttrs = {
          [`${attributeName}_x`]: xCoord,
          [`${attributeName}_y`]: yCoord,
        };
        return { ...accumulatedAttributes, ...layoutAttrs };
      }

      if (attributeName) {
        return { ...accumulatedAttributes, [attributeName]: attributeData };
      }

      return { ...accumulatedAttributes, [attributeUUID]: attributeData };
    }, {},
  ),
});

// Iterates a network, and adds an attribute to nodes and edges
// that references the ego ID that nominated it
const insertNetworkEgo = session => (
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

const insertEgoIntoSessionNetworks = sessions => (
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
 * @return {Array} An array of networks, partitioned by type. Each network object is decorated
 *                 with an additional `partitionEntity` prop to facilitate format naming.
 */
const partitionNetworkByType = (codebook, session, format) => {
  const getEntityName = (uuid, type) => codebook[type][uuid].name;

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
const resequenceIds = (sessions) => {
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

// Result is a SINGLE session, with MULTIPLE ego and sessionVariables
// We add the sessionID to each entity so that we can groupBy on it within
// the exporter to reconstruct the sessions.
const unionOfNetworks = sessionsByProtocol => Object.keys(sessionsByProtocol)
  .reduce((sessions, protocolUUID) => {
    const protocolSessions = sessionsByProtocol[protocolUUID]
      .reduce((union, session) => ({
      // Merge node list when union option is selected
        nodes: [...union.nodes, ...session.nodes.map(node => ({
          ...node,
          [sessionProperty]: session.sessionVariables[sessionProperty],
        }))],
        edges: [...union.edges, ...session.edges.map(edge => ({
          ...edge,
          [sessionProperty]: session.sessionVariables[sessionProperty],
        }))],
        ego: {
          ...union.ego,
          [session.sessionVariables[sessionProperty]]: session.ego,
        },
        sessionVariables: {
          ...union.sessionVariables,
          [session.sessionVariables[sessionProperty]]: session.sessionVariables,
        },
      }), { nodes: [], edges: [], ego: {}, sessionVariables: {} });
    return {
      ...sessions,
      [protocolUUID]: Array(protocolSessions),
    };
  }, {});

module.exports = {
  processEntityVariables,
  insertNetworkEgo,
  insertEgoIntoSessionNetworks,
  partitionNetworkByType,
  resequenceIds,
  unionOfNetworks,
};
