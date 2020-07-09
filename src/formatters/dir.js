import { extensions } from './utils';
import uuid from 'uuid/v4';
import { tempDataPath, createDirectory } from '../../../filesystem';
import { isElectron, isCordova } from '../../../Environment';

const path = require('path');

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

  return createDirectory(directoryPath);
}

export const extensionPattern = new RegExp(`${Object.values(extensions).join('|')}$`);
