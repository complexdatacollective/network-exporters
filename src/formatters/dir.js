import { extensions } from './utils';
import uuid from 'uuid/v4';
import { tempDataPath, createDirectory } from '../../../filesystem';
import { isElectron, isCordova } from '../../../Environment';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readdir, rmdir, tryUnlink } = require('../utils/promised-fs');

/**
 * Create a new temp directory to hold intermediate export files
 * @async
 * @return {string} the directory (path) created
 */

export const makeTempDir = () => {
  const directoryName = `temp-export-${uuid()}`;
  let directoryPath;
  if (isElectron()) {
    directoryPath = path.join(tempDataPath(), directoryName);
  }

  if (isCordova()) {
    directoryPath = `${tempDataPath()}${directoryName}`;
  }

  if (!directoryPath) {
    return;
  }

  console.log('maketempdir', directoryPath);
  return createDirectory(directoryPath);
}

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
