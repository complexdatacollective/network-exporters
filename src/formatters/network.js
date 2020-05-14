/* eslint-disable no-underscore-dangle */
import { entityPrimaryKeyProperty, egoProperty, sessionProperty } from '../utils/reservedAttributes';
import { getEntityAttributes } from './utils';

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
    // Spread session vars over ego so they can be encoded in file
    ego: { ...session.sessionVariables, ...session.ego },
  }
);

export const insertEgoIntoSessionNetworks = sessions => (
  sessions.map(session => insertNetworkEgo(session))
);

export const resequenceIds = (sessions) => {
  let resequencedId = 1;
  const idMap = {};
  const resequencedEntities = sessions.map(session => ({
    ...session,
    nodes: session.nodes.map(
      (node) => {
        resequencedId += 1;
        idMap[node._uid] = resequencedId;
        return {
          _id: resequencedId,
          ...node,
        };
      },
    ),
    edges: session.edges.map(
      (edge) => {
        resequencedId += 1;
        idMap[edge._uid] = resequencedId;
        return {
          _id: resequencedId,
          ...edge,
        };
      },
    ),
  }));

  const resequencedEdges = resequencedEntities.map(session => ({
    ...session,
    edges: session.edges.map(
      edge => ({
        ...edge,
        _from: idMap[edge.from],
        _to: idMap[edge.to],
      }),
    ),
  }));

  return resequencedEdges;
};

export const transposedCodebookVariables = (sectionCodebook, definition) => {
  if (!definition.variables) { // not required for edges
    sectionCodebook[definition.name] = definition; // eslint-disable-line no-param-reassign
    return sectionCodebook;
  }

  const displayVariable = definition.variables[definition.displayVariable];

  const variables = Object.values(definition.variables).reduce((acc, variable) => {
    acc[variable.name] = variable;
    return acc;
  }, {});
  sectionCodebook[definition.name] = { // eslint-disable-line no-param-reassign
    ...definition,
    displayVariable: displayVariable && displayVariable.name,
    variables,
  };
  return sectionCodebook;
};

export const transposedCodebookSection = (section = {}) =>
  Object.values(section).reduce((sectionCodebook, definition) => (
    transposedCodebookVariables(sectionCodebook, definition)
  ), {});

export const transposedCodebook = (codebook = {}) => ({
  edge: transposedCodebookSection(codebook.edge),
  node: transposedCodebookSection(codebook.node),
  ego: transposedCodebookVariables({}, { ...codebook.ego, name: 'ego' }).ego,
});
