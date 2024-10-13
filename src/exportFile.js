/* eslint-disable global-require */
const { writeFile } = require('./utils/filesystem');
const {
  getFileExtension,
  makeFilename,
} = require('./utils/general');
const { isCordova, isElectron } = require('./utils/Environment');
const getFormatterClass = require('./utils/getFormatterClass');
const { ExportError } = require('./errors/ExportError');

/**
 * Export a single (CSV or graphml) file
 * @param  {string}   namePrefix used to construct the filename
 * @param  {string}   partitionedEntityName an entity name used by CSV formatters
 * @param  {formats}  exportFormat a special config object that specifies the formatter class
 * @param  {string}   outDir directory where we should write the file
 * @param  {object}   network NC-formatted network `({ nodes, edges, ego })`
 * @param  {Object}   codebook needed to lookup variable types for encoding
 * @param  {Object}   exportOptions the new style configuration object, passed through to
 *                    the formatter
 * @return {Promise}  promise decorated with an `abort` method.
 *                    If aborted, the returned promise will never settle.
 * @private
 */
const exportFile = async (
  namePrefix,
  partitonedEntityName,
  exportFormat,
  outDir,
  network,
  codebook,
  exportOptions,
  logger,
) => {
  const Formatter = getFormatterClass(exportFormat);
  const extension = getFileExtension(exportFormat);

  if (!Formatter || !extension) {
    throw new ExportError(`Invalid export format ${exportFormat}`);
  }

  logger(`Exporting session ${namePrefix} (${partitonedEntityName}) in ${exportFormat} format...`);
  logger(network);

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

  logger(`Exporting to ${filePath}.`);

  // createWriteStream(filePath)
  //   .then((ws) => {
  //     writeStream = ws;
  //     writeStream.on('finish', () => {
  //       promiseResolve(filePath);
  //     });
  //     writeStream.on('error', (err) => {
  //       promiseReject(err);
  //     });

  //     streamController = formatter.writeToStream(writeStream);
  //   });

  // Test writing to string
  try {
    const string = formatter.writeToString();
    logger(string);
    await writeFile(filePath, string);
    logger(`Completed exporting ${namePrefix} as ${exportFormat} to path ${filePath}`);
    return filePath;
  } catch (e) {
    logger(`Failed to write file! ${err}`);
    throw (e);
  }
};

module.exports = exportFile;
