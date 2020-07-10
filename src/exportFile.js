import { createWriteStream } from './utils/filesystem';
import {
  getFileExtension,
  makeFilename,
} from './utils/general';
import { isCordova, isElectron } from './utils/Environment';
import getFormatterClass from './utils/getFormatterClass';

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
export const exportFile = (
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

  // Create a promise
  const pathPromise = new Promise((resolve, reject) => {
    let filePath;

    const formatter = new Formatter(network, codebook, exportOptions);
    const outputName = makeFilename(namePrefix, partitonedEntityName, exportFormat, extension);
    if (isElectron()) {
      const path = require('path');
      filePath = path.join(outDir, outputName);
    }

    if (isCordova()) {
      filePath = `${outDir}${outputName}`;
    }

    createWriteStream(filePath)
    .then((ws) => {
      writeStream = ws;
      writeStream.on('finish', () => {
        resolve(filePath);
      });
      writeStream.on('error', (err) => {
        reject(err);
      });

      streamController = formatter.writeToStream(writeStream);
    });
  });

  // Decorate the promise with an abort method that also tears down the
  // streamController and the writeStream
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
