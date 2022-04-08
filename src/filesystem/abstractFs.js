const copyFile = async (src, dest) => {
  // Do stuff
};

const readFile = async (filePath) => {
  // Do stuff
};

const writeFile = async (filePath, data) => {
  // Do stuff
};

/**
 *
 * @param {*} filePath
 * @returns fs.ReadStream object
 */
const createWriteStream = async (filePath) => {
  //return fs.createWriteStream(filePath);
  const writer = () => {};

  writer.abort = () => {};

  return writer;
};

const deleteFile = async (filePath) => {
};

const copyDirectory = async (src, dest) => {
  // Do stuff
};

const createDirectory = async (dirPath) => {
  // Do stuff
};

const deleteDirectory = async (dirPath) => {
  // Do stuff
};

const ensurePathExists = async (path) => {
  // const fse = require('fs-extra');
  // return fse.ensureDir(path);
  // Do stuff
};

const renameFile = async (oldPath, newPath) => {
  await copyFile(oldPath, newPath);
  await deleteFile(oldPath);
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
