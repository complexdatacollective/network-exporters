const ProgressMessages = {
  Begin: {
    progress: 0,
    statusText: 'Starting export...',
  },
  Formatting: {
    progress: 10,
    statusText: 'Formatting network data...',
  },
  Merging: {
    progress: 20,
    statusText: 'Merging sessions by protocol...',
  },
  ExportSession: (sessionExportCount, sessionExportTotal) => ({
    progress: 30 + ((50 - 30) * sessionExportCount / sessionExportTotal),
    statusText: `Exporting ${sessionExportCount} of ${sessionExportTotal} sessions...`,
  }),
  ZipStart: {
    progress: 60,
    statusText: 'Creating zip archive...',
  },
  ZipProgress: (percent) => ({
    progress: 60 + ((85 - 60) * (percent / 100)), // between ZipStart and Saving
    statusText: 'Zipping files...',
  }),
  Saving: {
    progress: 90,
    statusText: 'Saving file...',
  },
  Finished: {
    progress: 100,
    statusText: 'Export finished.',
  },
};

export default ProgressMessages;
