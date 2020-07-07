import { merge, isEmpty, groupBy } from 'lodash';
import {
  caseProperty,
  sessionProperty,
  remoteProtocolProperty,
  sessionExportTimeProperty,
  protocolProperty,
} from './utils/reservedAttributes';
import { insertEgoIntoSessionNetworks, resequenceIds, partitionNetworkByType } from './formatters/network';
import AdjacencyMatrixFormatter from './formatters/csv/matrix';
import AttributeListFormatter from './formatters/csv/attribute-list';
import EgoListFormatter from './formatters/csv/ego-list';
import EdgeListFormatter from './formatters/csv/edge-list';
import GraphMLFormatter from './formatters/graphml/GraphMLFormatter';

const fs = require('fs');
const path = require('path');
const logger = require('electron-log');
const { flattenDeep } = require('lodash');
const sanitizeFilename = require('sanitize-filename');

const { archive } = require('./utils/archive');
const { RequestError, ErrorMessages } = require('./errors/RequestError');
const { makeTempDir, removeTempDir } = require('./formatters/dir');
const { getFileExtension } = require('./formatters/utils');

const escapeFilePart = part => part.replace(/\W/g, '');

const makeFilename = (prefix, entityType, exportFormat, extension) => {
  let name = prefix;
  if (extension !== `.${exportFormat}`) {
    name += name ? '_' : '';
    name += exportFormat;
  }
  if (entityType) {
    name += `_${escapeFilePart(entityType)}`;
  }
  return `${name}${extension}`;
};

/**
 * Formatter factory
 * @param  {string} formatterType one of the `format`s
 * @return {class}
 */
const getFormatterClass = (formatterType) => {
  switch (formatterType) {
    case 'graphml':
      return GraphMLFormatter;
    case 'adjacencyMatrix':
      return AdjacencyMatrixFormatter;
    case 'edgeList':
      return EdgeListFormatter;
    case 'attributeList':
      return AttributeListFormatter;
    case 'ego':
      return EgoListFormatter;
    default:
      return null;
  }
};

/**
 * Export a single (CSV or graphml) file
 * @param  {string} namePrefix used to construct the filename
 * @param  {string} partitionedEntityName an entity name used by CSV formatters
 * @param  {formats} exportFormat a special config object that specifies the formatter class
 * @param  {string} outDir directory where we should write the file
 * @param  {object} network NC-formatted network `({ nodes, edges, ego })`
 * @param  {Object} codebook needed to lookup variable types for encoding
 * @param  {Object} exportOptions the new style configuration object, passed through to the formatter
 * @return {Promise} promise decorated with an `abort` method.
 *                           If aborted, the returned promise will never settle.
 * @private
 */
const exportFile = (
  namePrefix,
  partitonedEntityName,
  exportFormat,
  outDir,
  network,
  codebook,
  exportOptions,
) => {
  const Formatter = getFormatterClass(exportFormat);
  const extension = getFileExtension(exportFormat);

  // TODO: complete validation of parameters
  if (!Formatter || !extension) {
    return Promise.reject(new RequestError(`Invalid export format ${exportFormat}`));
  }

  // Establish variables to hold the stream controller (needed to handle abort method)
  // and the stream itself.
  let streamController;
  let writeStream;

  const pathPromise = new Promise((resolve, reject) => {
    const formatter = new Formatter(network, codebook, exportOptions);
    const outputName = makeFilename(namePrefix, partitonedEntityName, exportFormat, extension);
    const filepath = path.join(outDir, outputName);
    writeStream = fs.createWriteStream(filepath);
    writeStream.on('finish', () => {
      resolve(filepath);
    });
    writeStream.on('error', (err) => {
      reject(err);
    });

    streamController = formatter.writeToStream(writeStream);
  });

  pathPromise.abort = () => {
    if (streamController) {
      streamController.abort();
    }
    if (writeStream) {
      writeStream.destroy();
    }
  };

  return pathPromise;
};

/**
 * Interface for all data exports
 */
class FileExportManager {

  constructor(exportOptions = {}) {
    const defaultCSVOptions = {
      adjacencyMatrix: false,
      attributeList: true,
      edgeList: true,
      egoAttributeList: true,
    };

    const defaultExportOptions = {
      exportGraphML: true,
      exportCSV: defaultCSVOptions,
      globalOptions: {
        unifyNetworks: false,
        useDirectedEdges: false, // TODO
        useScreenLayoutCoordinates: true,
        screenLayoutHeight: 1080,
        screenLayoutWidth: 1920,
      },
    };

    // Allow shorthand 'true' to accept default export options for a given type
    this.exportOptions = {
      ...merge(defaultExportOptions, exportOptions),
      ...(exportOptions.exportCSV === true ? { exportCSV: defaultCSVOptions } : {}),
    };
  }

  /**
   * Main export method. Returns a promise.
   *
   * @param {*} sessions        collection of session objects
   * @param {*} protocols       collection of protocol objects, containing all protocols
   *                            mentioned in sessions collection.
   * @param {*} destinationPath path to write the resulting files to
   */
  exportSessions(sessions, protocols, destinationPath) {
    // Reject if required parameters aren't provided
    if (
      (!sessions && !isEmpty(sessions))
      || (!protocols && !isEmpty(protocols))
      || !destinationPath
    ) {
      return Promise.reject(new RequestError(ErrorMessages.MissingParameters));
    }

    // Todo: Reject if export options arent valid
    // if (!formatsAreValid(exportFormats) || !exportFormats.length) {
    //   return Promise.reject(new RequestError(ErrorMessages.InvalidExportOptions));
    // }

    let tmpDir;
    const cleanUp = () => removeTempDir(tmpDir);

    let promisedExports;

    // First, create a temporary working directory somewhere on the FS.
    const exportPromise = makeTempDir()
      .then((dir) => {
        tmpDir = dir;
        if (!tmpDir) {
          throw new Error('Temporary directory unavailable');
        }
      })
      // Then, insert a reference to the ego ID in to all nodes and edges
      .then(() => insertEgoIntoSessionNetworks(sessions))
      // Then, resequence IDs for this export
      .then(sessionsWithEgo => resequenceIds(sessionsWithEgo))
      // Group sessions by protocol UUID
      .then(sessionsWithResequencedIDs => groupBy(sessionsWithResequencedIDs, `sessionVariables.${protocolProperty}`))
      // Then, process the union option
      .then(sessionsByProtocol => {
        console.log('sessionsbyprotocol', sessionsByProtocol);
        if (this.exportOptions.globalOptions.unifyNetworks) {
          // Result is a SINGLE session, with MULTIPLE ego and sessionVariables
          // We add the sessionID to each entity so that we can groupBy on it within
          // the exporter to reconstruct the sessions.
          return Object.keys(sessionsByProtocol)
          .reduce((sessions, protocolUUID) => {
              const protocolSessions = sessionsByProtocol[protocolUUID]
                  .reduce((union, session) => ({
                      // Merge node list when union option is selected
                      nodes: [...union.nodes, ...session.nodes.map(node => ({
                        ...node,
                        [sessionProperty]: session.sessionVariables[sessionProperty],
                      }))],
                      edges: [...union.edges, ...session.edges.map(edge => ({
                        ...edge,
                        [sessionProperty]: session.sessionVariables[sessionProperty],
                      }))],
                      ego: {
                        ...union.ego,
                        [session.sessionVariables[sessionProperty]]: session.ego,
                      },
                      sessionVariables: {
                        ...union.sessionVariables,
                        [session.sessionVariables[sessionProperty]]: session.sessionVariables,
                      } ,
                  }), { nodes: [], edges: [], ego: {}, sessionVariables: {} });
              return {
                  ...sessions,
                  [protocolUUID]: Array(protocolSessions),
              }
          }, {});
        }
        return sessionsByProtocol;
      })
      // From this point on, ego and sessionVariables are collections.
      // Encode each network in each format specified
      .then((unifiedSessions) => {
        promisedExports = flattenDeep(
          // Export every network
          // => [n1, n2]
          Object.keys(unifiedSessions).map(protocolUUID => {
            // Reject if no protocol was provided for this session
            if (!protocols[protocolUUID]) {
              return Promise.reject(new RequestError(ErrorMessages.MissingParameters));
            };

            return unifiedSessions[protocolUUID].map(session => {

              // todo: move out of this loop to network utils
              const verifySessionVariables = (sessionVariables) => {
                if (
                  !sessionVariables[caseProperty] ||
                  !sessionVariables[sessionProperty] ||
                  !sessionVariables[remoteProtocolProperty] ||
                  !sessionVariables[sessionExportTimeProperty]
                ) {
                  return Promise.reject(new RequestError(ErrorMessages.MissingParameters));
                }
              }

              // Reject if sessions don't have required sessionVariables
              // Should match https://github.com/codaco/graphml-schemas/blob/master/xmlns/1.0/graphml%2Bnetcanvas.xsd
              if (this.exportOptions.globalOptions.unifyNetworks) {
                Object.values(session.sessionVariables).forEach(sessionVariables => {
                  verifySessionVariables(sessionVariables);
                })
              } else {
                verifySessionVariables(session.sessionVariables);
              }


              const protocol = protocols[protocolUUID];
              let prefix;

              // Determine filename prefix based on if we are exporting a single session
              // or a unified network
              if (this.exportOptions.globalOptions.unifyNetworks) {
                prefix = sanitizeFilename(protocol.name);
              } else {
                prefix = `${sanitizeFilename(session.sessionVariables[caseProperty])}_${session.sessionVariables[sessionProperty]}`;
              }

              // Translate our new configuration object back into the old syntax
              // TODO: update this to use the new configuration object directly.
              const exportFormats = [
                ...(this.exportOptions.exportGraphML ? ['graphml'] : []),
                ...(this.exportOptions.exportCSV ? ['ego'] : []),
                ...(this.exportOptions.exportCSV.adjacencyMatrix ? ['adjacencyMatrix'] : []),
                ...(this.exportOptions.exportCSV.attributeList ? ['attributeList'] : []),
                ...(this.exportOptions.exportCSV.edgeList ? ['edgeList'] : []),
              ];
              // ...in every file format requested
              // => [[n1.matrix.csv, n1.attrs.csv], [n2.matrix.csv, n2.attrs.csv]]
              return exportFormats.map(format =>
                // partitioning network based on node and edge type so we can create
                // an individual export file for each type

                // partitionNetworkByType returns array:
                //
                partitionNetworkByType(protocol.codebook, session, format).map((partitionedNetwork) => {
                  const partitionedEntity = partitionedNetwork.partitionEntity;
                  // gather one promise for each exported file
                  return exportFile(
                    prefix,
                    partitionedEntity,
                    format,
                    tmpDir,
                    partitionedNetwork,
                    protocol.codebook,
                    this.exportOptions,
                  );
                })
              );
            })
          }),
        );

        return Promise.all(promisedExports);
      })
      // Then, Zip the result.
      .then((exportedPaths) => {
        if (exportedPaths.length === 0) {
          throw new RequestError(ErrorMessages.NothingToExport);
        }
        return archive(exportedPaths, destinationPath);
      })
      .catch((err) => {
        cleanUp();
        logger.error(err);
        throw err;
      })
      .then(cleanUp);

    exportPromise.abort = () => {
      if (promisedExports) {
        promisedExports.forEach(promise => promise.abort());
      }
      cleanUp();
    };

    return exportPromise;
  }
}

export default FileExportManager;
