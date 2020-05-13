import { entityPrimaryKeyProperty, egoProperty, sessionProperty } from '../utils/reservedAttributes';
import { getEntityAttributes } from './utils';

const { includes } = require('lodash');
const getQuery = require('../../networkQuery/query').default;
const getFilter = require('../../networkQuery/filter').default;

export const unionOfNetworks = sessions =>
  sessions.reduce((union, session) => {
    union.nodes.push(...session.nodes);
    union.edges.push(...session.edges);
    union.ego.push(session.ego);
    return union;
  }, { nodes: [], edges: [], ego: [], [sessionProperty]: '' }); // Reset session ID

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
      } else if (variables[attributeName] && variables[attributeName].type === 'layout') {
        const layoutAttrs = {
          [`${attributeName}_x`]: attributeData && attributeData.x,
          [`${attributeName}_y`]: attributeData && attributeData.y,
        };
        return { ...accumulatedAttributes, ...layoutAttrs };
      }
      return { ...accumulatedAttributes, [attributeName]: attributeData };
    }, {}),
});

/**
 * Run the query on each network; filter for those which meet the criteria (i.e., where the query
 * evaluates to `true`).
 * @param  {Object[]} networks An array of NC networks
 * @param  {Object} inclusionQueryConfig a query definition with asserting rules
 * @return {Object[]} a subset of the networks
 */
export const filterNetworksWithQuery = (networks, inclusionQueryConfig) =>
  (inclusionQueryConfig ? networks.filter(getQuery(inclusionQueryConfig)) : networks);

/**
 * Filter each network based on the filter config.
 * @param  {Object[]} networks An array of NC networks
 * @param  {Object} filterConfig a filter definition with rules
 * @return {Object[]} a copy of `networks`, each possibly containing a subset of the original
 */
export const filterNetworkEntities = (networks, filterConfig) => {
  if (!filterConfig || !filterConfig.rules || !filterConfig.rules.length) {
    return networks;
  }
  const filter = getFilter(filterConfig);
  return networks.map(network => filter(network));
};

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
    // ego: { ...network.sessionVariables, ...network.ego }, -- Why spread session vars?
  }
);

export const insertEgoIntoSessionNetworks = sessions => (
  sessions.map(session => insertNetworkEgo(session))
);

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
