import { entityAttributesProperty, entityPrimaryKeyProperty, caseProperty } from '../../utils/reservedAttributes';
import { convertUuidToDecimal } from '../utils';
import { processEntityVariables } from '../network';

const { Readable } = require('stream');
const { cellValue, csvEOL } = require('./csv');

const asEgoList = (network, codebook) => {
  const egoList = Array.isArray(network.ego) ? network.ego : [network.ego];
  const variables = codebook && codebook.ego ? codebook.ego.variables : {};
  const processedEgo = egoList.map(ego => (processEntityVariables(ego, variables)));
  return processedEgo;
};

/**
 * The output of this formatter will contain the primary key (_uid)
 * and all model data (inside the `attributes` property)
 */
const attributeHeaders = (egos) => {
  const initialHeaderSet = new Set([]);
  initialHeaderSet.add(entityPrimaryKeyProperty);
  initialHeaderSet.add(caseProperty);

  const headerSet = egos.reduce((headers, ego) => {
    Object.keys((ego && ego[entityAttributesProperty]) || {}).forEach((key) => {
      headers.add(key);
    });
    return headers;
  }, initialHeaderSet);
  return [...headerSet];
};

const getPrintableAttribute = (attribute) => {
  switch (attribute) {
    case caseProperty:
      return 'networkCanvasCaseID';
    case entityPrimaryKeyProperty:
      return 'networkCanvasEgoID';
    default:
      return attribute;
  }
};

/**
 * @return {Object} an abort controller; call the attached abort() method as needed.
 */
const toCSVStream = (egos, outStream) => {
  const totalRows = egos.length;
  const attrNames = attributeHeaders(egos);
  let headerWritten = false;
  let rowIndex = 0;
  let rowContent;
  let ego;

  const inStream = new Readable({
    read(/* size */) {
      if (!headerWritten) {
        this.push(`${attrNames.map(attr => cellValue(getPrintableAttribute(attr))).join(',')}${csvEOL}`);
        headerWritten = true;
      } else if (rowIndex < totalRows) {
        ego = egos[rowIndex] || {};
        const values = attrNames.map((attrName) => {
          // The primary key and ego id exist at the top-level; all others inside `.attributes`
          let value;
          if (attrName === entityPrimaryKeyProperty) {
            value = convertUuidToDecimal(ego[attrName]);
          } else if (attrName === caseProperty) {
            value = ego[attrName];
          } else {
            value = ego[entityAttributesProperty][attrName];
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

class EgoListFormatter {
  constructor(data, codebook) {
    this.list = asEgoList(data, codebook) || [];
  }
  writeToStream(outStream) {
    // TODO not a list here...somewhere else needs to compile the egos
    return toCSVStream(this.list, outStream);
  }
}

export default EgoListFormatter;
