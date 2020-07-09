import getEnvironment, { isElectron, isCordova } from './Environment';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const JSZip = require('jszip');
const {
  getTempFileSystem,
  resolveFileSystemUrl,
  splitUrl,
  readFile,
  newFile,
  getFileEntry,
  createReader,
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
const archiveElectron = (sourcePaths, destinationPath) =>
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
const archiveCordova = (sourcePaths, targetFileName) => {
  const zip = new JSZip();

  const promisedExports = sourcePaths.map(
    sourcePath => {
      const [baseDirectory, filename] = splitUrl(sourcePath);
      console.log('split', baseDirectory, filename, sourcePath)
      return readFile(sourcePath)
      .then(fileContent => zip.file(filename, fileContent))


      // return getFileEntry(sourcePath, filesystem)
      // .then(createReader)
      // .then(file => new Promise((resolve, reject) => {
      //   const reader = new FileReader();
      //   reader.onloadend = data => resolve(zip.file(file.name, data.target.result));
      //   reader.onerror = err => reject(err);
      //   reader.readAsText(file);
      // }))
    }
  );

  return new Promise((resolve, reject) => {
    Promise.all(promisedExports).then(() => {
      console.log('writing zip...gathered files', zip);
      const [baseDirectory, filename] = splitUrl(targetFileName);
      console.log('split', baseDirectory, filename);
      resolveFileSystemUrl(baseDirectory)
        .then(directoryEntry => newFile(directoryEntry, filename))
        .then(makeFileWriter)
        .then(fileWriter => {
          console.log('about to write...');
          zip.generateAsync({ type: 'blob' }).then((blob) => {
            console.log('GOT BLOB');
            fileWriter.seek(0);
            fileWriter.onwrite = () => {
              console.log('resolving with', targetFileName);
              resolve(targetFileName);
            } // eslint-disable-line no-param-reassign
            fileWriter.onerror = err => reject(err); // eslint-disable-line no-param-reassign
            fileWriter.write(blob);
          });
        })
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
const archive = (sourcePaths, tempDir) => {
  const defaultFileName = 'networkCanvasExport.zip';
  let writePath;
  if (isElectron()) {
    writePath = path.join(tempDir, defaultFileName);
    return archiveElectron(sourcePaths, writePath);
  }

  if (isCordova()) {
    writePath = `${tempDir}${defaultFileName}`;
    return archiveCordova(sourcePaths, writePath);
  }

  throw new Error(`zip archiving not available on platform ${getEnvironment()}`);
};

// This is adapted from Architect; consider using `extract` as well
export default archive;
