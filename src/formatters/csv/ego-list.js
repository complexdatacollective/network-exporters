const { Readable } = require('stream');
const {
  entityAttributesProperty,
  entityPrimaryKeyProperty,
  caseProperty,
  egoProperty,
  sessionProperty,
  protocolName,
  sessionStartTimeProperty,
  sessionFinishTimeProperty,
  sessionExportTimeProperty,
  ncCaseProperty,
  ncSessionProperty,
  ncProtocolNameProperty,
} = require('../../utils/reservedAttributes');
const { processEntityVariables } = require('../network');
const { sanitizedCellValue, csvEOL } = require('./csv');
const Papa = require('papaparse');

const asEgoAndSessionVariablesList = (network, codebook, exportOptions) => {
  if (exportOptions.globalOptions.unifyNetworks) {
    // If unified networks is enabled, network.ego is an object keyed by sessionID.
    return Object.keys(network.ego).map((sessionID) => (
      processEntityVariables({
        ...network.ego[sessionID],
        ...network.sessionVariables[sessionID],
      }, 'ego', codebook, exportOptions)
    ));
  }

  return [processEntityVariables({
    ...network.ego,
    ...network.sessionVariables,
  }, 'ego', codebook, exportOptions)];
};

/**
 * The output of this formatter will contain the primary key (_uid)
 * and all model data (inside the `attributes` property)
 */
const attributeHeaders = (egos) => {
  const initialHeaderSet = new Set([]);

  // Create initial headers for non-attribute (model) variables such as sessionID
  initialHeaderSet.add(entityPrimaryKeyProperty);
  initialHeaderSet.add(caseProperty);
  initialHeaderSet.add(sessionProperty);
  initialHeaderSet.add(protocolName);
  initialHeaderSet.add(sessionStartTimeProperty);
  initialHeaderSet.add(sessionFinishTimeProperty);
  initialHeaderSet.add(sessionExportTimeProperty);

  const headerSet = egos.reduce((headers, ego) => {
    // Add headers for attributes
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
      return ncCaseProperty;
    case sessionProperty:
      return ncSessionProperty;
    case protocolName:
      return ncProtocolNameProperty;
    case entityPrimaryKeyProperty:
      return egoProperty;
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
        this.push(`${attrNames.map((attr) => sanitizedCellValue(getPrintableAttribute(attr))).join(',')}${csvEOL}`);
        headerWritten = true;
      } else if (rowIndex < totalRows) {
        ego = egos[rowIndex] || {};
        const values = attrNames.map((attrName) => {
          // Session variables exist at the top level - all others inside `attributes`
          let value;
          if (
            attrName === entityPrimaryKeyProperty
            || attrName === caseProperty
            || attrName === sessionProperty
            || attrName === protocolName
            || attrName === sessionStartTimeProperty
            || attrName === sessionFinishTimeProperty
            || attrName === sessionExportTimeProperty
          ) {
            value = ego[attrName];
          } else {
            value = ego[entityAttributesProperty][attrName];
          }
          return sanitizedCellValue(value);
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

const toCSVString = (egos) => {
  const attrNames = attributeHeaders(egos);
  let ego;

  const data = [];

  const columns = attrNames.map((attr) => sanitizedCellValue(getPrintableAttribute(attr)))

  data.push(columns);

  for (let rowIndex = 0; rowIndex < egos.length; rowIndex += 1) {
    ego = egos[rowIndex];
    const values = attrNames.map((attrName) => {
      // Session variables exist at the top level - all others inside `attributes`
      let value;
      if (
        attrName === entityPrimaryKeyProperty
        || attrName === caseProperty
        || attrName === sessionProperty
        || attrName === protocolName
        || attrName === sessionStartTimeProperty
        || attrName === sessionFinishTimeProperty
        || attrName === sessionExportTimeProperty
      ) {
        value = ego[attrName];
      } else {
        value = ego[entityAttributesProperty][attrName];
      }
      return sanitizedCellValue(value);
    });
    data.push(values);
  }

  const papa = Papa.unparse(data, {
    quotes: false, //or array of booleans
    quoteChar: '"',
    escapeChar: '"',
    delimiter: ",",
    header: true,
    newline: "\r\n",
    skipEmptyLines: false, //other option is 'greedy', meaning skip delimiters, quotes, and whitespace.
  })

  console.log('finished:', columns, data, papa);
  return papa;
};

class EgoListFormatter {
  constructor(network, codebook, exportOptions) {
    this.list = asEgoAndSessionVariablesList(network, codebook, exportOptions) || [];
  }

  writeToStream(outStream) {
    return toCSVStream(this.list, outStream);
  }

  writeToString(writeFile, filepath) {
    const string = toCSVString(this.list);
    return writeFile(filepath, string);
  }
}

module.exports = {
  EgoListFormatter,
  asEgoAndSessionVariablesList,
  toCSVStream,
};
