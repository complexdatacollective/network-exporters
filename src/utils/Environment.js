const environments = require('./environments');

const isElectron = () => !!window.electron || !!window.require;

if (typeof window !== 'undefined' && window) {
  const os = (window.require && window.require('os')) || window.os;
} else {
  const os = require('os');
}

const isMacOS = () => isElectron && os.platform() === 'darwin';

const isWindows = () => isElectron && os.platform() === 'win32';

const isLinux = () => isElectron && os.platform() === 'linux';

const isCordova = () => !!window.cordova;

const isWeb = () => (!isCordova() && !isElectron());

const getEnvironment = () => {
  if (isCordova()) return environments.CORDOVA;
  if (isElectron()) return environments.ELECTRON;
  return environments.WEB;
};

const inEnvironment = tree =>
  (...args) =>
    tree(getEnvironment())(...args);

module.exports = {
  default: inEnvironment,
  inEnvironment,
  isCordova,
  isLinux,
  isMacOS,
  isWeb,
  isWindows,
};
