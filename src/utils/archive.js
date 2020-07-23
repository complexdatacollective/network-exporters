import getEnvironment, { isElectron, isCordova } from './Environment';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const JSZip = require('jszip');
const {
  resolveFileSystemUrl,
  splitUrl,
  readFile,
  newFile,
  makeFileWriter,
} = require('../../../filesystem');

// const zlibFastestCompression = 1;
// const zlibBestCompression = 9;
const zlibDefaultCompression = -1;

// Use zlib default: compromise speed & size
// archiver overrides zlib's default (with 'best speed'), so we need to provide it
const archiveOptions = {
  zlib: { level: zlibDefaultCompression },
  store: true,
};

/**
 * Write a bundled (zip) from source files
 * @param {string} destinationPath full FS path to write
 * @param {string[]} sourcePaths
 * @return Returns a promise that resolves to (sourcePath, destinationPath)
 */
const archiveElectron = (sourcePaths, destinationPath, updateCallback) =>
  new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinationPath);
    const zip = archiver('zip', archiveOptions);

    output.on('close', () => {
      resolve(destinationPath);
    });

    output.on('warning', reject);
    output.on('error', reject);

    zip.pipe(output);

    zip.on('warning', reject);
    zip.on('error', reject);
    zip.on('progress', (progress) => {
      const percent = progress.entries.processed / progress.entries.total * 100;
      updateCallback(percent);
    });

    sourcePaths.forEach((sourcePath) => {
      zip.append(fs.createReadStream(sourcePath), { name: path.basename(sourcePath) });
    });

    zip.finalize();
  });


/**
 * Write a bundled (zip) from source files
 * @param {object} filesystem filesystem to use for reading files in to zip
 * @param {object} fileWriter fileWriter to use for outputting zip
 * @param {string} targetFileName full FS path to write
 * @param {string[]} sourcePaths
 * @return Returns a promise that resolves to (sourcePath, destinationPath)
 */
const archiveCordova = (sourcePaths, targetFileName, updateCallback) => {
  const zip = new JSZip();

  const promisedExports = sourcePaths.map(
    (sourcePath) => {
      const [filename] = splitUrl(sourcePath);
      return readFile(sourcePath)
        .then(fileContent => zip.file(filename, fileContent));
    },
  );

  return new Promise((resolve, reject) => {
    Promise.all(promisedExports).then(() => {
      const [baseDirectory, filename] = splitUrl(targetFileName);
      resolveFileSystemUrl(baseDirectory)
        .then(directoryEntry => newFile(directoryEntry, filename))
        .then(makeFileWriter)
        .then((fileWriter) => {
          zip.generateAsync({ type: 'blob' }, (update) => {
            updateCallback(update.percent);
          }).then((blob) => {
            fileWriter.seek(0);
            fileWriter.onwrite = () => { // eslint-disable-line no-param-reassign
              resolve(targetFileName);
            };
            fileWriter.onerror = err => reject(err); // eslint-disable-line no-param-reassign
            fileWriter.write(blob);
          });
        });
    });
  });
};

/**
 * Write a bundled (zip) from source files
 * @param {string[]} sourcePaths
 * @param {string} targetFileName full FS path to write
 * @param {object} fileWriter fileWriter to use for outputting zip
 * @param {object} filesystem filesystem to use for reading files in to zip
 * @return Returns a promise that resolves to (sourcePath, destinationPath)
 */
const archive = (sourcePaths, tempDir, updateCallback) => {
  const defaultFileName = 'networkCanvasExport.zip';
  let writePath;
  if (isElectron()) {
    writePath = path.join(tempDir, defaultFileName);
    return archiveElectron(sourcePaths, writePath, updateCallback);
  }

  if (isCordova()) {
    writePath = `${tempDir}${defaultFileName}`;
    return archiveCordova(sourcePaths, writePath, updateCallback);
  }

  throw new Error(`zip archiving not available on platform ${getEnvironment()}`);
};

// This is adapted from Architect; consider using `extract` as well
export default archive;
