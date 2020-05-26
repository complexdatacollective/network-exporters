import { v4 as uuid } from 'uuid';
import { findKey, forInRight, includes } from 'lodash';
import {
  getEntityAttributes,
  createDataElement,
  getGraphMLTypeForKey,
  getTypeFromCodebook,
  VariableType,
  formatXml,
} from './helpers';
import {
  entityAttributesProperty,
  entityPrimaryKeyProperty,
  caseProperty,
  sessionProperty,
  remoteProtocolProperty,
  sessionExportTimeProperty,
  sessionFinishTimeProperty,
  sessionStartTimeProperty,
  ncProtocolName,
} from '../../utils/reservedAttributes';

// In a browser process, window provides a globalContext;
// in an electron main process, we can inject required globals
let globalContext;

/* eslint-disable no-undef, global-require */
if (typeof window !== 'undefined' && window.DOMParser && window.XMLSerializer) {
  globalContext = window;
} else {
  const dom = require('xmldom');
  globalContext = {};
  globalContext.DOMParser = dom.DOMParser;
  globalContext.XMLSerializer = dom.XMLSerializer;
}
/* eslint-enable */

const eol = '\n';

// If includeNCMeta is true, include our custom XML schema
const getXmlHeader = (exportOptions, sessionVariables) => {
  if (!exportOptions.exportGraphML.includeNCMeta) {
    return `<?xml version="1.0" encoding="UTF-8"?>
    <graphml xmlns="http://graphml.graphdrawing.org/xmlns"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns
             http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">${eol}`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
    <graphml xmlns="http://graphml.graphdrawing.org/xmlns"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xsi:schemaLocation="http://schema.networkcanvas.com/xmlns http://schema.networkcanvas.com/xmlns/1.0/graphml+netcanvas.xsd"
             xmlns:nc="http://schema.networkcanvas.com/xmlns"
             nc:caseID="${sessionVariables[caseProperty]}"
             nc:sessionUUID="${sessionVariables[sessionProperty]}"
             nc:protocolName="${sessionVariables[ncProtocolName]}"
             nc:remoteProtocolID="${sessionVariables[remoteProtocolProperty]}"
             nc:sessionStartTime="${sessionVariables[sessionStartTimeProperty]}"
             nc:sessionFinishTime="${sessionVariables[sessionFinishTimeProperty]}"
             nc:sessionExportTime="${sessionVariables[sessionExportTimeProperty]}"
             >${eol}`;
}


// Use exportOptions.defaultOptions from FileExportManager to determine parameters
// for edge direction.
const getGraphHeader = ({ globalOptions: { useDirectedEdges } }) => {
  const edgeDefault = useDirectedEdges ? 'directed' : 'undirected';
  return `<graph edgedefault="${edgeDefault}">${eol}`;
};

const xmlFooter = `</graph>${eol}</graphml>${eol}`;

// Use exportOptions from FileExportManager to determine XML properties
const setUpXml = (exportOptions, sessionVariables) => {
  const graphMLOutline = `${getXmlHeader(exportOptions, sessionVariables)}${getGraphHeader(exportOptions)}${xmlFooter}`;
  return (new globalContext.DOMParser()).parseFromString(graphMLOutline, 'text/xml');
};

// <key> elements provide the type definitions for GraphML data elements
// @return {Object} a fragment to insert
//                  codebook: `{ fragment: <DocumentFragment> }`.
const generateKeyElements = (
  document, // the XML ownerDocument
  entities, // network.nodes or edges
  type, // 'node' or 'edge'
  excludeList, // Variables to exlcude
  codebook, // codebook
  layoutVariable, // boolean value uses for edges?
  serialize, // serialize function
) => {
  let fragment = '';

  // generate keys for attributes
  const done = [];

  // add keys for gephi positions
  if (layoutVariable) {
    const xElement = document.createElement('key');
    xElement.setAttribute('id', 'x');
    xElement.setAttribute('attr.name', 'x');
    xElement.setAttribute('attr.type', 'double');
    xElement.setAttribute('for', type);
    fragment += `${serialize(xElement)}`;
    const yElement = document.createElement('key');
    yElement.setAttribute('id', 'y');
    yElement.setAttribute('attr.name', 'y');
    yElement.setAttribute('attr.type', 'double');
    yElement.setAttribute('for', type);
    fragment += `${serialize(yElement)}`;
  }

  if (type === 'edge') {
    const label = document.createElement('key');
    label.setAttribute('id', 'label');
    label.setAttribute('attr.name', 'label');
    label.setAttribute('attr.type', 'string');
    label.setAttribute('for', type);
    fragment += `${serialize(label)}`;
  }

  // add type
  if (type === 'edge') {
    const edgeType = document.createElement('key');
    edgeType.setAttribute('id', 'networkCanvasEdgeType');
    edgeType.setAttribute('attr.name', 'networkCanvasEdgeType');
    edgeType.setAttribute('attr.type', 'string');
    edgeType.setAttribute('for', type);
    fragment += `${serialize(edgeType)}`;
  } else {
    const nodeType = document.createElement('key');
    nodeType.setAttribute('id', 'networkCanvasNodeType');
    nodeType.setAttribute('attr.name', 'networkCanvasNodeType');
    nodeType.setAttribute('attr.type', 'string');
    nodeType.setAttribute('for', type);
    fragment += `${serialize(nodeType)}`;
  }

  entities.forEach((element) => {
    let iterableElement = element;
    iterableElement = getEntityAttributes(element);
    // Entity data model attributes are now stored under a specific property

    Object.keys(iterableElement).forEach((key) => {
      // transpose ids to names based on codebook; fall back to the raw key
      const keyName = getTypeFromCodebook(codebook, type, element, key, 'name') || key;
      if (done.indexOf(keyName) === -1 && !excludeList.includes(keyName)) {
        const keyElement = document.createElement('key');
        keyElement.setAttribute('id', keyName);
        keyElement.setAttribute('attr.name', keyName);

        const variableType = getTypeFromCodebook(codebook, type, element, key);
        switch (variableType) {
          case VariableType.boolean:
            keyElement.setAttribute('attr.type', variableType);
            break;
          case VariableType.ordinal:
          case VariableType.number: {
            const keyType = getGraphMLTypeForKey(entities, key);
            keyElement.setAttribute('attr.type', keyType || 'string');
            break;
          }
          case VariableType.layout: {
            // special handling for layout variables
            keyElement.setAttribute('attr.name', `${keyName}Y`);
            keyElement.setAttribute('id', `${keyName}Y`);
            keyElement.setAttribute('attr.type', 'double');
            const keyElement2 = document.createElement('key');
            keyElement2.setAttribute('id', `${keyName}X`);
            keyElement2.setAttribute('attr.name', `${keyName}X`);
            keyElement2.setAttribute('attr.type', 'double');
            keyElement2.setAttribute('for', type);
            fragment += `${serialize(keyElement2)}`;
            break;
          }
          case VariableType.categorical: {
            const options = getTypeFromCodebook(codebook, type, element, key, 'options');
            options.forEach((option, index) => {
              if (index === options.length - 1) {
                keyElement.setAttribute('id', `${keyName}_${option.value}`);
                keyElement.setAttribute('attr.name', `${keyName}_${option.value}`);
                keyElement.setAttribute('attr.type', 'boolean');
              } else {
                const keyElement2 = document.createElement('key');
                keyElement2.setAttribute('id', `${keyName}_${option.value}`);
                keyElement2.setAttribute('attr.name', `${keyName}_${option.value}`);
                keyElement2.setAttribute('attr.type', 'boolean');
                keyElement2.setAttribute('for', type);
                fragment += `${serialize(keyElement2)}`;
              }
            });
            break;
          }
          case VariableType.text:
          case VariableType.datetime:
          case VariableType.location: // TODO: special handling?
          default:
            keyElement.setAttribute('attr.type', 'string');
        }
        keyElement.setAttribute('for', type);
        console.log('key element is:', keyElement);
        fragment += `${serialize(keyElement)}`;
        done.push(keyName);
      }
    });
  });
  return fragment;
};

// @return {DocumentFragment} a fragment containing all XML elements for the supplied dataList
const generateDataElements = (
  document, // the XML ownerDocument
  dataList, // List of nodes or edges
  type, // Element type to be created. "node" or "egde"
  excludeList, // Attributes to exclude lookup of in codebook
  codebook, // Copy of codebook
  layoutVariable, // Primary layout variable. Null for edges
  serialize, // serialize function
) => {
  let fragment = '';

  dataList.forEach((dataElement) => {
    const domElement = document.createElement(type);
    const nodeAttrs = getEntityAttributes(dataElement);

    if (dataElement[entityPrimaryKeyProperty]) {
      domElement.setAttribute('id', dataElement[entityPrimaryKeyProperty]);
    } else {
      domElement.setAttribute('id', uuid());
    }

    if (type === 'edge') {
      domElement.setAttribute('source', dataElement.from);
      domElement.setAttribute('target', dataElement.to);
    }

    if (type === 'edge') {
      const label = codebook && codebook[type]
        && codebook[type][dataElement.type] && (codebook[type][dataElement.type].name
          || codebook[type][dataElement.type].label);

      domElement.appendChild(createDataElement(document, 'label', label));
      domElement.appendChild(createDataElement(document, 'networkCanvasEdgeType', dataElement.type));

      Object.keys(dataElement).forEach((key) => {
        const keyName = getTypeFromCodebook(codebook, type, dataElement, key, 'name') || key;
        if (!excludeList.includes(keyName)) {
          if (typeof dataElement[key] !== 'object') {
            domElement.appendChild(createDataElement(document, keyName, dataElement[key]));
          } else if (getTypeFromCodebook(codebook, type, dataElement, key) === 'layout') {
            domElement.appendChild(createDataElement(document, `${keyName}X`, dataElement[key].x));
            domElement.appendChild(createDataElement(document, `${keyName}Y`, dataElement[key].y));
          } else {
            domElement.appendChild(
              createDataElement(document, keyName, JSON.stringify(dataElement[key])),
            );
          }
        }
      });
    } else {
      domElement.appendChild(createDataElement(document, 'networkCanvasNodeType', dataElement.type));
    }

    // Add entity attributes
    Object.keys(nodeAttrs).forEach((key) => {
      const keyName = getTypeFromCodebook(codebook, type, dataElement, key, 'name') || key;
      if (!excludeList.includes(keyName) && !!nodeAttrs[key]) {
        if (getTypeFromCodebook(codebook, type, dataElement, key) === 'categorical') {
          const options = getTypeFromCodebook(codebook, type, dataElement, key, 'options');
          options.forEach((option) => {
            const optionKey = `${keyName}_${option.value}`;
            domElement.appendChild(createDataElement(
              document, optionKey, !!nodeAttrs[key] && includes(nodeAttrs[key], option.value),
            ));
          });
        } else if (typeof nodeAttrs[key] !== 'object') {
          domElement.appendChild(createDataElement(document, keyName, nodeAttrs[key]));
        } else if (getTypeFromCodebook(codebook, type, dataElement, key) === 'layout') {
          domElement.appendChild(createDataElement(document, `${keyName}X`, nodeAttrs[key].x));
          domElement.appendChild(createDataElement(document, `${keyName}Y`, nodeAttrs[key].y));
        } else {
          domElement.appendChild(
            createDataElement(document, keyName, JSON.stringify(nodeAttrs[key])),
          );
        }
      }
    });

    // Add positions for gephi layout. Use window dimensions for scaling if available.
    if (layoutVariable && nodeAttrs[layoutVariable]) {
      const canvasWidth = globalContext.innerWidth || 1024;
      const canvasHeight = globalContext.innerHeight || 768;
      domElement.appendChild(createDataElement(document, 'x', nodeAttrs[layoutVariable].x * canvasWidth));
      domElement.appendChild(createDataElement(document, 'y', (1.0 - nodeAttrs[layoutVariable].y) * canvasHeight));
    }

    fragment += `${formatXml(serialize(domElement))}`;
  });

  return fragment;
};

/**
 * Generator function to supply XML content in chunks to both string and stream producers
 * @param {*} network
 * @param {*} codebook
 * @param {*} exportOptions
 */
export function* graphMLGenerator(network, codebook, exportOptions) {
  const serializer = new globalContext.XMLSerializer();
  const serialize = fragment => `${serializer.serializeToString(fragment)}${eol}`;
  yield getXmlHeader(exportOptions, network.sessionVariables);

  const xmlDoc = setUpXml(exportOptions, network.sessionVariables);
  // find the first variable of type layout
  let layoutVariable;
  forInRight(codebook.node, (value) => {
    layoutVariable = findKey(value.variables, { type: 'layout' });
  });

  const generateNodeKeys = nodes => generateKeyElements(
    xmlDoc,
    nodes,
    'node',
    [entityPrimaryKeyProperty],
    codebook,
    layoutVariable,
    serialize,
  );
  const generateEdgeKeys = edges => generateKeyElements(
    xmlDoc,
    edges,
    'edge',
    [entityPrimaryKeyProperty, 'from', 'to', 'type'],
    codebook,
    null,
    serialize,
  );
  const generateNodeElements = nodes => generateDataElements(
    xmlDoc,
    nodes,
    'node',
    [entityPrimaryKeyProperty, entityAttributesProperty],
    codebook,
    layoutVariable,
    serialize,
  );
  const generateEdgeElements = edges => generateDataElements(
    xmlDoc,
    edges,
    'edge',
    [entityPrimaryKeyProperty, entityAttributesProperty, 'from', 'to', 'type'],
    codebook,
    null,
    serialize,
  );

  // generate keys for nodes
  yield generateNodeKeys(network.nodes);

  // generate keys for edges and add to keys for nodes
  yield generateEdgeKeys(network.edges);

  yield getGraphHeader(exportOptions);

  // add nodes and edges to graph
  for (let i = 0; i < network.nodes.length; i += 100) {
    yield generateNodeElements(network.nodes.slice(i, i + 100));
  }

  for (let i = 0; i < network.edges.length; i += 100) {
    yield generateEdgeElements(network.edges.slice(i, i + 100));
  }

  yield xmlFooter;
}

// /**
//  * Network Canvas interface for ExportData
//  * @param  {Object} network network from redux state
//  * @param  {Object} codebook from protocol in redux state
//  * @param  {Function} onError
//  * @param  {Function} saveFile injected SaveFile dependency (called with the xml contents)
//  * @param  {String} filePrefix to use for file name (defaults to 'networkcanvas')
//  * @return {} the return value from saveFile
//  */
// export const createGraphML = (network, codebook, onError, saveFile, filePrefix = 'networkcanvas') => {
//   let xmlString = '';
//   try {
//     for (const chunk of graphMLGenerator(network, codebook)) { // eslint-disable-line
//       xmlString += chunk;
//     }
//   } catch (err) {
//     onError(err);
//     return null;
//   }

//   const formattedString = formatXml(xmlString);
//   console.log(formattedString);
//   return saveFile(
//     formattedString,
//     onError,
//     'graphml',
//     ['graphml'],
//     `${filePrefix}.graphml`,
//     'text/xml',
//     { message: 'Your network canvas graphml file.', subject: 'network canvas export' },
//   );
// };
