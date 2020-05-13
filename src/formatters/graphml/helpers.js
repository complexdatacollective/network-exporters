import { entityAttributesProperty } from '../../utils/reservedAttributes';
const { isNil } = require('lodash');


export const getEntityAttributes = node => (node && node[entityAttributesProperty]) || {};

// TODO: VariableType[Values] is shared with 'protocol-consts' in NC
export const VariableType = Object.freeze({
  boolean: 'boolean',
  text: 'text',
  number: 'number',
  datetime: 'datetime',
  ordinal: 'ordinal',
  categorical: 'categorical',
  layout: 'layout',
  location: 'location',
});

export const VariableTypeValues = Object.freeze(Object.values(VariableType));

// returns a graphml type
export const getGraphMLTypeForKey = (data, key) => (
  data.reduce((result, value) => {
    const attrs = getEntityAttributes(value);
    if (isNil(attrs[key])) return result;
    let currentType = typeof attrs[key];
    if (currentType === 'number') {
      currentType = Number.isInteger(attrs[key]) ? 'int' : 'double';
      if (result && currentType !== result) return 'double';
    }
    if (String(Number.parseInt(attrs[key], 10)) === attrs[key]) {
      currentType = 'int';
      if (result === 'double') return 'double';
    } else if (String(Number.parseFloat(attrs[key], 10)) === attrs[key]) {
      currentType = 'double';
      if (result === 'int') return 'double';
    }
    if (isNil(currentType)) return result;
    if (currentType === result || result === '') return currentType;
    return 'string';
  }, ''));

export const getVariableInfo = (codebook, type, element, key) => (
  codebook[type]
  && codebook[type][element.type]
  && codebook[type][element.type].variables
  && codebook[type][element.type].variables[key]
);

export const codebookExists = (codebook, type, element, key) => {
  const variableInfo = getVariableInfo(codebook, type, element, key);
  return variableInfo && variableInfo.type && VariableTypeValues.includes(variableInfo.type);
};

export const getTypeFromCodebook = (codebook, type, element, key, variableAttribute = 'type') => {
  const variableInfo = getVariableInfo(codebook, type, element, key);
  return variableInfo && variableInfo[variableAttribute];
};

export const createElement = (xmlDoc, tagName, attrs = {}, child = null) => {
  const element = xmlDoc.createElement(tagName);
  Object.entries(attrs).forEach(([key, val]) => {
    element.setAttribute(key, val);
  });
  if (child) {
    element.appendChild(child);
  }
  return element;
};

export const createDataElement = (xmlDoc, key, text) =>
  createElement(xmlDoc, 'data', { key }, xmlDoc.createTextNode(text));
