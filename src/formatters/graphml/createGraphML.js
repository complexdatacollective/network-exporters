import { v4 as uuid } from 'uuid';
import { findKey, forInRight, includes } from 'lodash';
import {
  getEntityAttributes,
  createDataElement,
  getGraphMLTypeForKey,
  getAttributePropertyFromCodebook,
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
  <graphml
    xmlns="http://graphml.graphdrawing.org/xmlns"
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
  console.log('generate key elements', entities, type, codebook, layoutVariable);

  // Create an array to track variables we have already created <key>s for
  const done = [];

  /**
   * REMOVED LAYOUT KEY CREATION:
   * We used to create a Gephi readable layout <key> here, but
   * it has been removed because (1) Gephi is unstable and presently not well
   * maintained, and (2) its implementation is nonstandard.
   */

  /**
   * REMOVED LABEL KEY CREATION:
   * We used to create a Gephi readable LABEL <key> here, but
   * it has been removed because (1) Gephi is unstable and presently not well
   * maintained, and (2) its implementation is nonstandard.
   */

  /**
   * REMOVED `networkCanvas{entity}Type CREATION:
   * We used to create a key to store the network canvas entity type here, but
   * it has been removed because GraphML parsing is incomplete and undeveloped
   * in most software.
   */

  if (done.indexOf('label') === -1 && !excludeList.includes('label')) {
    // Create <key> for label
    const labelDataElement = document.createElement('key');
    labelDataElement.setAttribute('id', 'label');
    labelDataElement.setAttribute('attr.name', 'label');
    labelDataElement.setAttribute('attr.type', 'string');
    labelDataElement.setAttribute('for', 'all');
    fragment += `${serialize(labelDataElement)}`;
    done.push('label');
  }

  if (done.indexOf('type') === -1 && !excludeList.includes('type')) {
    // Create <key> for type
    const typeDataElement = document.createElement('key');
    typeDataElement.setAttribute('id', 'type');
    typeDataElement.setAttribute('attr.name', 'type');
    typeDataElement.setAttribute('attr.type', 'string');
    typeDataElement.setAttribute('for', 'all');
    fragment += `${serialize(typeDataElement)}`;
    done.push('type');
  }

  // Main loop over entities
  entities.forEach((element) => {
    // Get element attributes
    const elementAttributes = getEntityAttributes(element);

    // Loop over attributes
    Object.keys(elementAttributes).forEach((key) => {
      // transpose ids to names based on codebook; fall back to the raw key
      const keyName = getAttributePropertyFromCodebook(codebook, type, element, key, 'name') || key;

      // Test if we have already created a key for this variable, and that it
      // isn't on our exclude list.
      if (done.indexOf(keyName) === -1 && !excludeList.includes(keyName)) {
        const keyElement = document.createElement('key');

        // id must be xs:NMTOKEN: http://books.xmlschemata.org/relaxng/ch19-77231.html
        keyElement.setAttribute('id', key);

        // Use human readable variable name for the attr.name attribute
        keyElement.setAttribute('attr.name', keyName);

        // Determine attribute type, to decide
        const variableType = getAttributePropertyFromCodebook(codebook, type, element, key);
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
            /**
             * special handling for layout variables: split the variable into
             * two <key> elements - one for X and one for Y.
             */
            keyElement.setAttribute('attr.name', `${keyName}_Y`);
            keyElement.setAttribute('id', `${key}_Y`);
            keyElement.setAttribute('attr.type', 'double');

            // Create a second element to model the <key> for
            // the X value
            const keyElement2 = document.createElement('key');
            keyElement2.setAttribute('id', `${key}_X`);
            keyElement2.setAttribute('attr.name', `${keyName}_X`);
            keyElement2.setAttribute('attr.type', 'double');
            keyElement2.setAttribute('for', type);
            fragment += `${serialize(keyElement2)}`;
            break;
          }
          case VariableType.categorical: {
            /**
             * Special handling for categorical variables:
             * Because categorical variables can have multiple membership, we
             * split them out into several boolean variables
             */

            // fetch options property for this variable
            const options = getAttributePropertyFromCodebook(codebook, type, element, key, 'options');

            options.forEach((option, index) => {
              if (index === options.length - 1) {
                keyElement.setAttribute('id', `${key}_${option.value}`);
                keyElement.setAttribute('attr.name', `${keyName}_${option.value}`);
                keyElement.setAttribute('attr.type', 'boolean');
              } else {
                const keyElement2 = document.createElement('key');
                keyElement2.setAttribute('id', `${key}_${option.value}`);
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
          case VariableType.location: // TODO: remove all references to location variable type
          default:
            keyElement.setAttribute('attr.type', 'string');
        }

        keyElement.setAttribute('for', type);
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
  entities, // List of nodes or edges
  type, // Element type to be created. "node" or "egde"
  excludeList, // Attributes to exclude lookup of in codebook
  codebook, // Copy of codebook
  layoutVariable, // Primary layout variable. Null for edges
  serialize, // serialize function
) => {
  let fragment = '';
  console.log('generate data elements', entities, type, codebook, layoutVariable, excludeList);

  // Iterate entities
  entities.forEach((entity) => {
    // Create an element representing the entity (<node> or <edge>)
    const domElement = document.createElement(type);

    // Create a variable containing the entity's attributes
    const entityAttributes = getEntityAttributes(entity);

    // Set the id of the entity element to the primary key property,
    // or generate a new UUID
    if (entity[entityPrimaryKeyProperty]) {
      domElement.setAttribute('id', entity[entityPrimaryKeyProperty]);
    } else {
      domElement.setAttribute('id', uuid());
    }

    // Store the human readable name in a <data> element
    const entityTypeName = codebook[type][entity.type].name || entity.type;
    domElement.appendChild(createDataElement(document, { key: 'type' }, entityTypeName));

    // Main edge handling
    if (type === 'edge') {

      // If this is an edge, add source and target properties and map
      // them to the from and to attributes
      domElement.setAttribute('source', entity.from);
      domElement.setAttribute('target', entity.to);

      // Iterate
      Object.keys(entity).forEach((key) => {
        console.log('DEBUG ITERATING EDGE', entity, key);
        const keyName = getAttributePropertyFromCodebook(codebook, type, entity, key, 'name') || key;
        if (!excludeList.includes(keyName)) {
          if (typeof entity[key] !== 'object') {
            domElement.appendChild(createDataElement(document, { key }, entity[key]));
          } else if (getAttributePropertyFromCodebook(codebook, type, entity, key) === 'layout') {
            domElement.appendChild(createDataElement(document, { key: `${key}_X` }, entity[key].x));
            domElement.appendChild(createDataElement(document, { key: `${key}_Y` }, entity[key].y));
          } else {
            domElement.appendChild(
              createDataElement(document, { key: keyName }, JSON.stringify(entity[key])),
            );
          }
        }
      });
    } else {

      // For nodes, add <data> for label
      const entityLabel = () => {
        const variableCalledName = findKey(codebook[type][entity.type].variables, variable => variable.name.toLowerCase() === 'name');

        if (variableCalledName && entity[entityAttributesProperty][variableCalledName]) {
          return entity[entityAttributesProperty][variableCalledName];
        }

        return "Node"
      }

      domElement.appendChild(createDataElement(document, { key: 'label' }, entityLabel()));
    }

    // Add entity attributes
    Object.keys(entityAttributes).forEach((key) => {
      console.log('DEBUG ITERATING EDGE 2', entity, key);
      const keyName = getAttributePropertyFromCodebook(codebook, type, entity, key, 'name') || key;
      if (!excludeList.includes(keyName) && !!entityAttributes[key]) {
        if (getAttributePropertyFromCodebook(codebook, type, entity, key) === 'categorical') {
          const options = getAttributePropertyFromCodebook(codebook, type, entity, key, 'options');
          options.forEach((option) => {
            const optionKey = `${key}_${option.value}`;
            domElement.appendChild(createDataElement(
              document, { key: optionKey }, !!entityAttributes[key] && includes(entityAttributes[key], option.value),
            ));
          });
        } else if (typeof entityAttributes[key] !== 'object') {
          domElement.appendChild(createDataElement(document, { key }, entityAttributes[key]));
        } else if (getAttributePropertyFromCodebook(codebook, type, entity, key) === 'layout') {
          domElement.appendChild(createDataElement(document, { key: `${key}_X` }, entityAttributes[key].x));
          domElement.appendChild(createDataElement(document, { key: `${key}_Y` }, entityAttributes[key].y));
        } else {
          domElement.appendChild(
            createDataElement(document, { key }, JSON.stringify(entityAttributes[key])),
          );
        }
      }
    });

    // TODO: Use code below to convert all layout variable data values to screen space coordinates ?
    // if (layoutVariable && entityAttributes[layoutVariable]) {
    //   const canvasWidth = globalContext.innerWidth || 1024;
    //   const canvasHeight = globalContext.innerHeight || 768;
    //   domElement.appendChild(createDataElement(document, 'x', entityAttributes[layoutVariable].x * canvasWidth));
    //   domElement.appendChild(createDataElement(document, 'y', (1.0 - entityAttributes[layoutVariable].y) * canvasHeight));
    // }

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
  // todo move serialize up so it doesnt need to be passed
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
    [entityPrimaryKeyProperty, entityAttributesProperty, 'from', 'to', 'type', '_from', '_to', '_id', '_egoID'],
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
