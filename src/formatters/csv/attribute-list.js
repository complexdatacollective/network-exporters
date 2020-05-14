import { entityAttributesProperty, entityTypeProperty, egoProperty, entityPrimaryKeyProperty } from '../../utils/reservedAttributes';
import { convertUuidToDecimal } from '../utils';
import { processEntityVariables } from '../network';

const { Readable } = require('stream');

const { cellValue, csvEOL } = require('./csv');

const asAttributeList = (network, codebook) => {
  const processedNodes = (network.nodes || []).map((node) => {
    if (codebook && codebook.node[node.type]) {
      return processEntityVariables(node, codebook.node[node.type].variables);
    }
    return node;
  });
  return processedNodes;
};

/**
 * The output of this formatter will contain the primary key (_uid)
 * and all model data (inside the `attributes` property)
 */
const attributeHeaders = (nodes) => {
  const initialHeaderSet = new Set([]);
  initialHeaderSet.add(egoProperty);
  initialHeaderSet.add(entityPrimaryKeyProperty);
  initialHeaderSet.add(entityTypeProperty);

  const headerSet = nodes.reduce((headers, node) => {
    Object.keys(node[entityAttributesProperty] || []).forEach((key) => {
      headers.add(key);
    });
    return headers;
  }, initialHeaderSet);
  return [...headerSet];
};

const getPrintableAttribute = (attribute) => {
  switch (attribute) {
    case egoProperty:
      return 'networkCanvasEgoID';
    case entityPrimaryKeyProperty:
      return 'networkCanvasAlterID';
    case entityTypeProperty:
      return 'networkCanvasNodeType';
    default:
      return attribute;
  }
};

/**
 * @return {Object} an abort controller; call the attached abort() method as needed.
 */
const toCSVStream = (nodes, outStream) => {
  const totalRows = nodes.length;
  const attrNames = attributeHeaders(nodes);
  let headerWritten = false;
  let rowIndex = 0;
  let rowContent;
  let node;

  const inStream = new Readable({
    read(/* size */) {
      if (!headerWritten) {
        this.push(`${attrNames.map(attr => cellValue(getPrintableAttribute(attr))).join(',')}${csvEOL}`);
        headerWritten = true;
      } else if (rowIndex < totalRows) {
        node = nodes[rowIndex];
        const values = attrNames.map((attrName) => {
          // The primary key and ego id exist at the top-level; all others inside `.attributes`
          let value;
          if (attrName === entityPrimaryKeyProperty || attrName === egoProperty) {
            value = convertUuidToDecimal(node[attrName]);
          } else if (attrName === entityTypeProperty) {
            value = node.type;
          } else {
            value = node[entityAttributesProperty][attrName];
          }
          return cellValue(value);
        });
        rowContent = `${values.join(',')}${csvEOL}`;
        this.push(rowContent);
        rowIndex += 1;
      } else {
        this.push(null);
      }
    },
  });

  // TODO: handle teardown. Use pipeline() API in Node 10?
  inStream.pipe(outStream);

  return {
    abort: () => { inStream.destroy(); },
  };
};

class AttributeListFormatter {
  constructor(data, codebook) {
    this.list = asAttributeList(data, codebook) || [];
  }

  writeToStream(outStream) {
    return toCSVStream(this.list, outStream);
  }
}

export default AttributeListFormatter;
