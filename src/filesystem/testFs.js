/* eslint-disable no-console */
const copyFile = async (src, dest) => {
  console.info(`testFS: Copying ${src} to ${dest}`);
  return Promise.resolve();
};

const readFile = async (filePath) => {
  console.info(`testFS: Reading ${filePath}`);
  return Promise.resolve();
};

const writeFile = async (filePath) => {
  console.info(`testFS: Writing ${filePath}`);
  return Promise.resolve();
};

const createWriteStream = async (filePath) => {
  console.info(`testFS: Creating write stream for ${filePath}`);
  const writer = () => {};

  writer.abort = () => {};

  return Promise.resolve(writer);
};

const deleteFile = async (filePath) => {
  console.info(`testFS: Deleting ${filePath}`);
  return Promise.resolve();
};

const copyDirectory = async (src, dest, overwrite = true, useTempDir = false) => {
  console.info(`testFS: Copying ${src} to ${dest} with overwrite ${overwrite} and useTempDir ${useTempDir}`);
  return Promise.resolve();
};

const createDirectory = async (dirPath) => {
  console.info(`testFS: Creating directory ${dirPath}`);
  return Promise.resolve();
};

const deleteDirectory = async (dirPath) => {
  console.info(`testFS: Deleting directory ${dirPath}`);
  return Promise.resolve();
};

const ensurePathExists = async (path) => {
  console.info(`testFS: Ensuring path ${path} exists`);
  return Promise.resolve();
};

const renameFile = async (oldPath, newPath) => {
  console.info(`testFS: Renaming ${oldPath} to ${newPath}`);
  return Promise.resolve();
};

module.exports = {
  copyFile,
  readFile,
  writeFile,
  renameFile,
  createWriteStream,
  deleteFile,
  copyDirectory,
  createDirectory,
  deleteDirectory,
  ensurePathExists,
};
