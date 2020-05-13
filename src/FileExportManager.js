/* eslint-disable no-underscore-dangle */
import { merge, isEmpty } from 'lodash';

const fs = require('fs');
const path = require('path');
const logger = require('electron-log');
const { flattenDeep } = require('lodash');

const { archive } = require('./utils/archive');
const { RequestError, ErrorMessages } = require('./errors/RequestError');
const { makeTempDir, removeTempDir } = require('./formatters/dir');
const { insertEgoInNetworks, transposedCodebook, unionOfNetworks } = require('./formatters/network');
const { formatsAreValid, getFileExtension, getFormatterClass, partitionByEdgeType } = require('./formatters/utils');

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
  network, {
    useDirectedEdges,
    useEgoData,
    codebook,
  } = {},
) => {
  const Formatter = getFormatterClass(exportFormat);
  const extension = getFileExtension(exportFormat);
  if (!Formatter || !extension) {
    return Promise.reject(new RequestError(`Invalid export format ${exportFormat}`));
  }

  let streamController;
  let writeStream;

  const pathPromise = new Promise((resolve, reject) => {
    const formatter = new Formatter(network, useDirectedEdges, useEgoData, codebook);
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

/**
 * exportOptions is an object containing possible parameters for the exporter.
 * Available parameters are:
 *
 * {
 *   exportGraphML: { // [true|false|Object]
 *     includeNCMeta: [true|false],
 *   },
 *   exportCSV: { // [true|false|Object]
 *     adjacencyMatrix: [true|false],
 *     attributeList: [true|false],
 *     edgeList: [true|false],
 *     egoAttributeList: [true|false],
 *   },
 *   globalOptions: {
 *     resequenceIDs: [true|false],
 *     unifyNetworks: [true|false],
 *     useDirectedEdges: [true|false],
 *   },
 * };
 *
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

    // Reject if export options arent valid
    // if (!formatsAreValid(exportFormats) || !exportFormats.length) {
    //   return Promise.reject(new RequestError(ErrorMessages.InvalidExportOptions));
    // }

    let tmpDir;
    const cleanUp = () => removeTempDir(tmpDir);

    let promisedExports;

    const exportFormats = [
      ...(this.exportOptions.exportGraphML ? ['graphml'] : []),
      ...(this.exportOptions.exportCSV ? ['csv'] : []),
    ];

    const exportPromise = makeTempDir()
      .then((dir) => {
        tmpDir = dir;
        if (!tmpDir) {
          throw new Error('Temporary directory unavailable');
        }
      })
      .then(() => sessions.map((session) => {
        const id = session && session._id;
        const caseID = session && session.data && session.data.sessionVariables &&
          session.data.sessionVariables._caseID;
        return {
          ...session.data,
          _id: id,
          _caseID: caseID,
        };
      }))
      .then(networks => insertEgoInNetworks(networks))
      .then(networks => (this.exportOptions.unifyNetworks ? [unionOfNetworks(networks)] : networks))
      .then((networks) => {
        promisedExports = flattenDeep(
          // Export every network
          // => [n1, n2]
          networks.map(network =>
            // ...in every file format requested
            // => [[n1.matrix.csv, n1.attrs.csv], [n2.matrix.csv, n2.attrs.csv]]
            exportFormats.map(format =>
              // ...partitioning matrix & edge-list output based on edge type
              // => [ [[n1.matrix.knows.csv, n1.matrix.likes.csv], [n1.attrs.csv]],
              //      [[n2.matrix.knows.csv, n2.matrix.likes.csv], [n2.attrs.csv]]]
              partitionByEdgeType(network, format).map((partitionedNetwork) => {
                const prefix = network._id ? `${network._caseID}_${network._id}` : protocol.name;
                // gather one promise for each exported file
                return exportFile(
                  prefix,
                  partitionedNetwork.edgeType,
                  format,
                  tmpDir,
                  partitionedNetwork,
                  this.exportOptions,
                );
              }),
            ),
          ),
        );
        return Promise.all(promisedExports);
      })
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
