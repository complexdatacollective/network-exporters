const EXTENSIONS = {
  graphml: '.graphml',
  csv: '.csv',
};

const FORMATS = {
  graphml: 'graphml',
  csv: 'csv',
};

const DEFAULT_EXPORT_OPTIONS = {
  tempDataPath: '/temp',
  queueConcurrency: 50,
  unifyNetworks: false,
  useScreenLayoutCoordinates: true,
  screenLayoutWidth: 1920,
  screenLayoutHeight: 1080,
  csvIncludeAdjacencyMatrix: false,
  csvIncludeAttributeList: true,
  csvIncludeEdgeList: true,
};

module.exports = {
  FORMATS,
  EXTENSIONS,
  DEFAULT_EXPORT_OPTIONS,
};
