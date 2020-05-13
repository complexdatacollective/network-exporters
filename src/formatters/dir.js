import { extensions } from './utils';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readdir, rmdir, tryUnlink } = require('../utils/promised-fs');

const tmpDirPrefix = 'org.codaco.server.exporting.';

/**
 * Create a new temp directory to hold intermediate export files
 * @async
 * @return {string} the directory (path) created
 */
export const makeTempDir = () =>
  new Promise((resolve, reject) => {
    fs.mkdtemp(path.join(os.tmpdir(), tmpDirPrefix), (err, dir) => {
      if (err) {
        reject(err);
      } else {
        resolve(dir);
      }
    });
  });

export const extensionPattern = new RegExp(`${Object.values(extensions).join('|')}$`);

/**
 * Best-effort clean up of the temp directory. Should not throw/reject.
 * @async
 */
export const removeTempDir = (tmpDir) => {
  const ignoreError = () => {};
  const removeFile = (name) => {
    if (extensionPattern.test(name)) {
      return tryUnlink(path.join(tmpDir, name)).catch(ignoreError);
    }
    return Promise.resolve();
  };

  return readdir(tmpDir, { withFileTypes: true })
    .then(fileNames => Promise.all(fileNames.map(fileName => removeFile(fileName.name))))
    .then(() => rmdir(tmpDir))
    .catch(ignoreError);
};
