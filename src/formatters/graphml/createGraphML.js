import { v4 as uuid } from 'uuid';
import { findKey, includes } from 'lodash';
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
  exportIDProperty,
  egoProperty,
  exportFromProperty,
  exportToProperty,
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

// Create a serializer for reuse below.
const serializer = new globalContext.XMLSerializer();
const serialize = fragment => `${serializer.serializeToString(fragment)}${eol}`;

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
    nc:caseId="${sessionVariables[caseProperty]}"
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
  exportOptions, // export options object
) => {
  let fragment = '';
  console.log('generate key elements', entities, type, codebook);

  // Create an array to track variables we have already created <key>s for
  const done = [];

  /**
   * REMOVED LAYOUT KEY CREATION:
   * We used to create a Gephi readable layout <key> here, but
   * it has been removed because (1) Gephi is unstable and presently not well
   * maintained, and (2) its implementation is nonstandard.
   */

  // Create <key> for a 'label' variable allowed on all elements.
  // This is used by gephi to label nodes/edges.
  // Only create once!
  if (type === 'node' && done.indexOf('label') === -1 && !excludeList.includes('label')) {

    const labelDataElement = document.createElement('key');
    labelDataElement.setAttribute('id', 'label');
    labelDataElement.setAttribute('attr.name', 'label');
    labelDataElement.setAttribute('attr.type', 'string');
    labelDataElement.setAttribute('for', 'all');
    fragment += `${serialize(labelDataElement)}`;
    done.push('label');
  }

  // Create a <key> for the network canvas entity type.
  if (type === 'node' && done.indexOf('type') === -1 && !excludeList.includes('type')) {
    // Create <key> for type
    const typeDataElement = document.createElement('key');
    typeDataElement.setAttribute('id', 'networkCanvasType');
    typeDataElement.setAttribute('attr.name', 'networkCanvasType');
    typeDataElement.setAttribute('attr.type', 'string');
    typeDataElement.setAttribute('for', 'all');
    fragment += `${serialize(typeDataElement)}`;
    done.push('type');
  }

  // Create a <key> for network canvas UUID.
  if (type === 'node' && done.indexOf('uuid') === -1 && !excludeList.includes('uuid')) {
    // Create <key> for type
    const typeDataElement = document.createElement('key');
    typeDataElement.setAttribute('id', 'networkCanvasUUID');
    typeDataElement.setAttribute('attr.name', 'networkCanvasUUID');
    typeDataElement.setAttribute('attr.type', 'string');
    typeDataElement.setAttribute('for', 'all');
    fragment += `${serialize(typeDataElement)}`;
    done.push('uuid');
  }

  // Create a <key> for from and to properties that reference network canvas UUIDs.
  if (type === 'edge' && done.indexOf('originalEdgeSource') === -1) {
    // Create <key> for type
    const typeDataElement = document.createElement('key');
    typeDataElement.setAttribute('id', 'networkCanvasToUUID');
    typeDataElement.setAttribute('attr.name', 'networkCanvasToUUID');
    typeDataElement.setAttribute('attr.type', 'string');
    typeDataElement.setAttribute('for', 'edge');
    fragment += `${serialize(typeDataElement)}`;

    const typeDataElement2 = document.createElement('key');
    typeDataElement2.setAttribute('id', 'networkCanvasFromUUID');
    typeDataElement2.setAttribute('attr.name', 'networkCanvasFromUUID');
    typeDataElement2.setAttribute('attr.type', 'string');
    typeDataElement2.setAttribute('for', 'edge');
    fragment += `${serialize(typeDataElement2)}`;

    done.push('originalEdgeSource');
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
        // do not be tempted to change this to the variable 'name' for this reason!
        keyElement.setAttribute('id', key);

        // Use human readable variable name for the attr.name attribute
        keyElement.setAttribute('attr.name', keyName);

        // Determine attribute type to decide how to encode
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
  exportOptions, // Export options object
) => {
  let fragment = '';
  console.log('generate data elements', entities, type, codebook, excludeList);

  // Iterate entities
  entities.forEach((entity) => {
    // Create an element representing the entity (<node> or <edge>)
    const domElement = document.createElement(type);

    // Create a variable containing the entity's attributes
    const entityAttributes = getEntityAttributes(entity);

    // Set the id of the entity element to the export ID property,
    // or generate a new UUID
    if (entity[entityPrimaryKeyProperty]) {
      domElement.setAttribute('id', entity[exportIDProperty]);
    } else {
      console.warn('no export ID found on entity. Generating random UUID...');
      domElement.setAttribute('id', uuid());
    }

    // Create data element for entity UUID
    domElement.appendChild(createDataElement(document, { key: 'networkCanvasUUID' }, entity[entityPrimaryKeyProperty]));

    // Create data element for entity type
    const entityTypeName = codebook[type][entity.type].name || entity.type;
    domElement.appendChild(createDataElement(document, { key: 'networkCanvasType' }, entityTypeName));

    // Special handling for model variables and variables unique to entity type
    if (type === 'edge') {

      // Add source and target properties and map
      // them to the _from and _to attributes
      domElement.setAttribute('source', entity[exportFromProperty]);
      domElement.setAttribute('target', entity[exportToProperty]);

      // Insert the nc UUID versions of 'to' and 'from' under special properties
      domElement.appendChild(createDataElement(document, { key: 'networkCanvasFromUUID' }, entity['from']));
      domElement.appendChild(createDataElement(document, { key: 'networkCanvasToUUID' }, entity['to']));

      // Iterate
      Object.keys(entity).forEach((key) => {

        const keyName = getAttributePropertyFromCodebook(codebook, type, entity, key, 'name') || key;
        if (!excludeList.includes(keyName)) {
          if (typeof entity[key] !== 'object') {
            domElement.appendChild(createDataElement(document, { key }, entity[key]));
          } else {
            domElement.appendChild(
              createDataElement(document, { key: keyName }, JSON.stringify(entity[key])),
            );
          }
        }
      });
    } else {

      // For nodes, add <data> for label
      // If there is no name property, fall back to labelling as "Node"
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
          // Determine if we should use the normalized or the "screen space" value
          let xCoord;
          let yCoord;
          if (exportOptions.globalOptions.useScreenLayoutCoordinates) {
            xCoord = (entityAttributes[key].x * exportOptions.globalOptions.screenLayoutWidth).toFixed(2);
            yCoord = ((1.0 - entityAttributes[key].y) * exportOptions.globalOptions.screenLayoutHeight).toFixed(2);
          } else {
            xCoord = entityAttributes[key].x;
            yCoord = entityAttributes[key].y;
          }

          domElement.appendChild(createDataElement(document, { key: `${key}_X` }, xCoord));
          domElement.appendChild(createDataElement(document, { key: `${key}_Y` }, yCoord));

        } else {
          domElement.appendChild(
            createDataElement(document, { key }, JSON.stringify(entityAttributes[key])),
          );
        }
      }
    });

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
  yield getXmlHeader(exportOptions, network.sessionVariables);

  const xmlDoc = setUpXml(exportOptions, network.sessionVariables);

  const generateNodeKeys = nodes => generateKeyElements(
    xmlDoc,
    nodes,
    'node',
    [entityPrimaryKeyProperty],
    codebook,
    exportOptions,
  );
  const generateEdgeKeys = edges => generateKeyElements(
    xmlDoc,
    edges,
    'edge',
    [entityPrimaryKeyProperty, 'from', 'to', 'itemType'],
    codebook,
    exportOptions,
  );
  const generateNodeElements = nodes => generateDataElements(
    xmlDoc,
    nodes,
    'node',
    [entityPrimaryKeyProperty, entityAttributesProperty],
    codebook,
    exportOptions,
  );
  const generateEdgeElements = edges => generateDataElements(
    xmlDoc,
    edges,
    'edge',
    [entityPrimaryKeyProperty, entityAttributesProperty, 'from', 'to', 'type', 'itemType', exportToProperty, exportFromProperty, exportIDProperty, egoProperty],
    codebook,
    exportOptions,
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
