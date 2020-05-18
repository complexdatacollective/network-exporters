import { merge, isEmpty } from 'lodash';
import { insertEgoIntoSessionNetworks, unionOfNetworks, transposedCodebook, resequenceIds, partitionByEdgeType } from './formatters/network';
import { sessionProperty, caseProperty, protocolProperty } from './utils/reservedAttributes';
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

const makeFilename = (prefix, edgeType, exportFormat, extension) => {
  let name = prefix;
  if (extension !== `.${exportFormat}`) {
    name += name ? '_' : '';
    name += exportFormat;
  }
  if (edgeType) {
    name += `_${escapeFilePart(edgeType)}`;
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
 * @param  {string} edgeType an edge type - used by CSV formatters
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
  edgeType,
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
  // and the strem itself.
  let streamController;
  let writeStream;

  const pathPromise = new Promise((resolve, reject) => {
    const formatter = new Formatter(network, codebook, exportOptions);
    const outputName = makeFilename(namePrefix, edgeType, exportFormat, extension);
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
    const defaultGraphMLOptions = {
      includeNCMeta: true,
    };

    const defaultCSVOptions = {
      adjacencyMatrix: true,
      attributeList: true,
      edgeList: true,
      egoAttributeList: true,
    };

    const defaultExportOptions = {
      exportGraphML: defaultGraphMLOptions,
      exportCSV: defaultCSVOptions,
      globalOptions: {
        unifyNetworks: false, // TODO
        useDirectedEdges: false, // TODO
      },
    };

    // Allow shorthand 'true' to accept default export options for a given type
    this.exportOptions = {
      ...merge(defaultExportOptions, exportOptions),
      ...(exportOptions.exportGraphML === true ? { exportGraphML: defaultGraphMLOptions } : {}),
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

    // TODO: reject if sessions contains protocol not supplied in protocols
    // Reject if export options arent valid
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
      // Then, process the union option: conflate into one massive network if enabled.
      // TODO: this needs to happen PER PROTOCOL so that meta data can be maintained
      .then(sessionsWithResequencedIDs =>
        (this.exportOptions.unifyNetworks
          ? [unionOfNetworks(sessionsWithResequencedIDs)] : sessionsWithResequencedIDs))
      // Then, encode each network in each format specified, using the options for each.
      // Write the resulting file to the temp directory
      .then((sessionsWithUnion) => {
        promisedExports = flattenDeep(
          // Export every network
          // => [n1, n2]
          sessionsWithUnion.map((session) => {

            // Translate our new configuration object back into the old syntax
            // TODO: update this to use the new configuration object directly.
            const exportFormats = [
              'ego',
              ...(this.exportOptions.exportGraphML ? ['graphml'] : []),
              ...(this.exportOptions.exportCSV.adjacencyMatrix ? ['adjacencyMatrix'] : []),
              ...(this.exportOptions.exportCSV.attributeList ? ['attributeList'] : []),
              ...(this.exportOptions.exportCSV.edgeList ? ['edgeList'] : []),
            ];

            // ...in every file format requested
            // => [[n1.matrix.csv, n1.attrs.csv], [n2.matrix.csv, n2.attrs.csv]]
            return exportFormats.map(format =>
              // ...partitioning matrix & edge-list output based on edge type
              // => [ [[n1.matrix.knows.csv, n1.matrix.likes.csv], [n1.attrs.csv]],
              //      [[n2.matrix.knows.csv, n2.matrix.likes.csv], [n2.attrs.csv]]]
              partitionByEdgeType(session, format).map((partitionedNetwork) => {
                const protocol = protocols[session[protocolProperty]];

                // Strip illegal characters from caseID
                const sanitizedCaseID = sanitizeFilename(session.sessionVariables[caseProperty]);

                const prefix = session[sessionProperty] ? `${sanitizedCaseID}_${session[sessionProperty]}` : protocol.name;
                // gather one promise for each exported file
                return exportFile(
                  prefix,
                  partitionedNetwork.edgeType,
                  format,
                  tmpDir,
                  partitionedNetwork,
                  transposedCodebook(protocol.codebook),
                  this.exportOptions,
                );
              }));
          }),
        );
        return Promise.all(promisedExports);
      })
      // Then, Zip the result.
      // TODO: Determine if zipping is required based on number of files.
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
