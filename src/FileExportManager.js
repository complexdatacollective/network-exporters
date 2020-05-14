import { merge, isEmpty } from 'lodash';
import { insertEgoIntoSessionNetworks, unionOfNetworks, transposedCodebook } from './formatters/network';
import { sessionProperty, caseProperty, protocolProperty } from './utils/reservedAttributes';

const fs = require('fs');
const path = require('path');
const logger = require('electron-log');
const { flattenDeep } = require('lodash');

const { archive } = require('./utils/archive');
const { RequestError, ErrorMessages } = require('./errors/RequestError');
const { makeTempDir, removeTempDir } = require('./formatters/dir');
const { getFileExtension, getFormatterClass, partitionByEdgeType } = require('./formatters/utils');

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
 * Export a single (CSV or graphml) file
 * @param  {string} namePrefix
 * @param  {formats} exportFormat
 * @param  {string} outDir directory where we should write the file
 * @param  {object} network NC-formatted network `({ nodes, edges, ego })`
 * @param  {object} [options]
 * @param  {boolean} [options.useDirectedEdges=false] true to force directed edges
 * @param  {Object} [options.codebook] needed for graphML export
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

  if (!Formatter || !extension) {
    return Promise.reject(new RequestError(`Invalid export format ${exportFormat}`));
  }

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
    // TODO: on('ready')?
    logger.debug(`Writing file ${filepath}`);
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
      adjacencyMatrix: false,
      attributeList: true,
      edgeList: true,
      egoAttributeList: true,
    };

    const defaultExportOptions = {
      exportGraphML: defaultGraphMLOptions,
      exportCSV: defaultCSVOptions,
      globalOptions: {
        resequenceIDs: false,
        unifyNetworks: false,
        useDirectedEdges: false,
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
      (!sessions && !isEmpty(sessions)) ||
      (!protocols && !isEmpty(protocols)) ||
      !destinationPath
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
      // Then, process the union option: conflate into one massive network if enabled.
      // This should be changed to group by protocol
      // TODO: this needs to happen PER PROTOCOL so that meta data can be maintained
      .then(sessionsWithEgo =>
        (this.exportOptions.unifyNetworks ? [unionOfNetworks(sessionsWithEgo)] : sessionsWithEgo))
      // Then, encode each network in each format specified, using the options for each.
      // Write the resulting file to the temp directory
      .then((sessionsWithUnion) => {
        promisedExports = flattenDeep(
          // Export every network
          // => [n1, n2]
          sessionsWithUnion.map((session) => {
            // TODO: update this to properly detect types
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
                const prefix = session[sessionProperty] ? `${session[caseProperty]}_${session[sessionProperty]}` : protocol.name;
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
              }),
            );
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
