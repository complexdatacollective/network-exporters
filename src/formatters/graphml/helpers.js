import { isNil } from 'lodash';
import { entityAttributesProperty } from '../../utils/reservedAttributes';

export const getEntityAttributes = node => (node && node[entityAttributesProperty]) || {};

// Gephi does not support long lines in graphML, meaning we need to "beautify" the output
export const formatXml = (xml, tab) => { // tab = optional indent value, default is tab (\t)
  console.log('formatXML');
  var formatted = '', indent= '';
  tab = tab || '\t';
  xml.split(/>\s*</).forEach(function(node) {
      if (node.match( /^\/\w/ )) indent = indent.substring(tab.length); // decrease indent by one 'tab'
      formatted += indent + '<' + node + '>\r\n';
      if (node.match( /^<?\w[^>]*[^\/]$/ )) indent += tab;              // increase indent
  });
  return formatted.substring(1, formatted.length-3);
}

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
