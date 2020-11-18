/* eslint-disable global-require */
const { merge, isEmpty, groupBy, first } = require('lodash');
const { EventEmitter } = require('eventemitter3');
const logger = require('electron-log');
const queue = require('async/queue');
const {
  caseProperty,
  sessionProperty,
  protocolProperty,
} = require('./utils/reservedAttributes');
const {
  getFileNativePath,
  rename,
  removeDirectory,
  makeTempDir,
} = require('./utils/filesystem');
const exportFile = require('./exportFile');
const {
  insertEgoIntoSessionNetworks,
  resequenceIds,
  partitionNetworkByType,
  unionOfNetworks,
} = require('./formatters/network');
const { verifySessionVariables, getFilePrefix } = require('./utils/general');
const { isCordova, isElectron } = require('./utils/Environment');
const archive = require('./utils/archive');
const { ExportError, ErrorMessages } = require('./errors/ExportError');
const ProgressMessages = require('./ProgressMessages');
const UserCancelledExport = require('./errors/UserCancelledExport');


const defaultCSVOptions = {
  adjacencyMatrix: false,
  attributeList: true,
  edgeList: true,
  // If CSV is exported, egoAttributeList must be exported
  // as it contains session info so this option is generally
  // ignored and only relevant for *only* exporting
  // egoAttributeList
  egoAttributeList: true,
};

const defaultExportOptions = {
  exportGraphML: true,
  exportCSV: defaultCSVOptions,
  globalOptions: {
    unifyNetworks: false,
    useDirectedEdges: false, // TODO
    useScreenLayoutCoordinates: true,
    screenLayoutHeight: 1080,
    screenLayoutWidth: 1920,
  },
};

// Merge default and user-supplied options
const getOptions = exportOptions => ({
  ...merge(defaultExportOptions, exportOptions),
  ...(exportOptions.exportCSV === true ? { exportCSV: defaultCSVOptions } : {}),
});

/**
 * Interface for all data exports
 */
class FileExportManager {
  constructor(exportOptions = {}) {
    this.exportOptions = getOptions(exportOptions);

    this.events = new EventEmitter();
  }

  on = (...args) => {
    this.events.on(...args);
  }

  emit(event, payload) {
    if (!event) {
      // eslint-disable-next-line no-console
      console.warn('Malformed emit.');
      return;
    }

    this.events.emit(event, payload);
  }

  removeAllListeners = () => {
    this.events.removeAllListeners();
  }

  /**
   * Main export method. Returns a promise.
   * Rejections from the main promise chain emit a fatal error, but rejections
   * within the promisedExports task only fail that specific task.
   *
   * @param {*} sessions    collection of session objects
   * @param {*} protocols   collection of protocol objects, containing all protocols
   *                        mentioned in sessions collection.
   */
  exportSessions(sessions, protocols) {
    let tmpDir; // Temporary directory location
    let cancelled = false; // Top-level cancelled property used to abort promise chain

    const exportFormats = [
      ...(this.exportOptions.exportGraphML ? ['graphml'] : []),
      ...(this.exportOptions.exportCSV ? ['ego'] : []),
      ...(this.exportOptions.exportCSV.adjacencyMatrix ? ['adjacencyMatrix'] : []),
      ...(this.exportOptions.exportCSV.attributeList ? ['attributeList'] : []),
      ...(this.exportOptions.exportCSV.edgeList ? ['edgeList'] : []),
    ];

    // Utility function to delete temporary directory (and contents) when needed.
    const cleanUp = () => {
      if (tmpDir) {
        removeDirectory(tmpDir);
      }
    };

    this.emit('begin', ProgressMessages.Begin);

    // Reject if required parameters aren't provided
    if (
      (!sessions && !isEmpty(sessions))
      || (!protocols && !isEmpty(protocols))
    ) {
      return Promise.reject(new ExportError(ErrorMessages.MissingParameters));
    }

    const exportPromise = makeTempDir().then(dir => { tmpDir = dir; })
      // Delay for 2 seconds to give consumer UI time to render a toast
      .then(() => new Promise((resolve) => setTimeout(resolve, 2000)))
      // Insert a reference to the ego ID into all nodes and edges
      .then(() => {
        this.emit('update', ProgressMessages.Formatting);
        return insertEgoIntoSessionNetworks(sessions);
      })
      // Resequence IDs for this export
      .then(sessionsWithEgo => resequenceIds(sessionsWithEgo))
      // Group sessions by protocol UUID
      .then(sessionsWithResequencedIDs => groupBy(sessionsWithResequencedIDs, `sessionVariables.${protocolProperty}`))
      // Then, process the union option
      .then((sessionsByProtocol) => {
        if (cancelled) {
          return Promise.reject(new UserCancelledExport());
        }

        if (!this.exportOptions.globalOptions.unifyNetworks) {
          return sessionsByProtocol;
        }

        this.emit('update', ProgressMessages.Merging);
        return unionOfNetworks(sessionsByProtocol);
      })
      .then((unifiedSessions) => {
        if (cancelled) {
          return Promise.reject(new UserCancelledExport());
        }

        return new Promise(resolve => {
          const results = [];
          const promisedExports = [];

          let q = queue((task, callback) => {
            task().then(result => {
              results.push(result);
              callback();
            }).catch((result) => {
              console.log('task result (fail)');
              callback();
            });
          }, 1000);
  
          // Create an array of promises representing each session in each export format
          const finishedSessions = [];
          const sessionExportTotal = this.exportOptions.globalOptions.unifyNetworks
            ? Object.keys(unifiedSessions).length : sessions.length;

          Object.keys(unifiedSessions).forEach((protocolUUID) => {
              // Reject if no protocol was provided for this session
              if (!protocols[protocolUUID]) {
                throw new ExportError(ErrorMessages.MissingParameters);
              }

              unifiedSessions[protocolUUID].forEach((session) => {
                // Skip if sessions don't have required sessionVariables
                try {
                  if (this.exportOptions.globalOptions.unifyNetworks) {
                    Object.values(session.sessionVariables)
                      .forEach((sessionVariables) => {
                        verifySessionVariables(sessionVariables);
                      });
                  } else {
                    verifySessionVariables(session.sessionVariables);
                  }
                } catch (e) {
                  logger.log('Export error:', e);
                  return;
                }
        
                const protocol = protocols[protocolUUID];
                const prefix = getFilePrefix(session, protocol, this.exportOptions.globalOptions.unifyNetworks);

                
                // Returns promise resolving to filePath for each format exported
                // ['file1', ['file1_person', 'file1_place']]
                exportFormats.forEach((format) => {
                  // partitioning network based on node and edge type so we can create
                  // an individual export file for each type
                  const partitionedNetworks = partitionNetworkByType(
                    protocol.codebook,
                    session,
                    format,
                  );
        
                  partitionedNetworks.forEach((partitionedNetwork) => {
                    const partitionedEntity = partitionedNetwork.partitionEntity;
                    promisedExports.push(() => exportFile(
                      prefix,
                      partitionedEntity,
                      format,
                      tmpDir,
                      partitionedNetwork,
                      protocol.codebook,
                      this.exportOptions,
                    ).then(result => {
                      if (!finishedSessions.includes(prefix)) {
                        this.emit('session-exported', session.sessionVariables.sessionId);
                        this.emit('update', ProgressMessages.ExportSession(finishedSessions.length + 1, sessionExportTotal));
                        finishedSessions.push(prefix);
                      }
                      return result;
                    }).catch((error) => {
                      this.emit('error', `Encoding ${prefix} failed: ${error.message}`);
                      return Promise.reject(error);
                    }));
                  });
                });
              });
          })
          
          q.push(promisedExports, (something) => console.log('push callback:', something));
          q.drain().then(() => {
            resolve(results);
          });
        })
      })
      // Then, Zip the result.
      .then((exportedPaths) => {
        if (cancelled) {
          return Promise.reject(new UserCancelledExport());
        }

        // FatalError if no sessions survived the cull
        if (exportedPaths.length === 0) {
          throw new ExportError(ErrorMessages.NothingToExport);
        }

        // Start the zip process, and attach a callback to the update
        // progress event.
        this.emit('update', ProgressMessages.ZipStart);
        return archive(exportedPaths, tmpDir, (percent) => {
          this.emit('update', ProgressMessages.ZipProgress(percent));
        });
      })
      .then((zipLocation) => {
        if (cancelled) {
          return Promise.reject(new UserCancelledExport());
        }

        // Prompt the user for a path to save the ZIP (electron)
        // or open the share dialog (cordova)
        this.emit('update', ProgressMessages.Saving);
        return new Promise((resolve, reject) => {
          if (isElectron()) {
            let electron;

            if (typeof window !== 'undefined' && window) {
              electron = window.require('electron').remote;
            } else {
              // if no window object assume we are in nodejs environment (Electron main)
              // no remote needed
              electron = require('electron');
            }

            const { dialog } = electron;
            const browserWindow = first(electron.BrowserWindow.getAllWindows());

            dialog.showSaveDialog(
              browserWindow,
              {
                filters: [{ name: 'zip', extensions: ['zip'] }],
                defaultPath: 'networkCanvasExport.zip',
              },
            )
              .then(({ canceled, filePath }) => {
                if (canceled) {
                  this.emit('cancelled', ProgressMessages.Cancelled);
                  resolve();
                }

                rename(zipLocation, filePath)
                  .then(() => {
                    const { shell } = electron;
                    shell.showItemInFolder(filePath);
                    resolve();
                  })
                  .catch(reject);
              });
          }

          if (isCordova()) {
            getFileNativePath(zipLocation)
              .then((nativePath) => {
                window.plugins.socialsharing.shareWithOptions({
                  message: 'Your zipped network canvas data.', // not supported on some apps
                  subject: 'network canvas export',
                  files: [nativePath],
                  chooserTitle: 'Share zip file via', // Android only
                }, resolve, reject);
              });
          }
        });
      })
      .then(() => {
        if (cancelled) {
          return Promise.reject(new UserCancelledExport());
        }

        this.emit('finished', ProgressMessages.Finished);
        cleanUp();

        return Promise.resolve();
      })
      .catch((err) => {
        // We don't throw if this is an error from user cancelling
        if (err instanceof UserCancelledExport) {
          return;
        }

        cleanUp();
        throw err;
      });

    exportPromise.abort = () => {
      q.kill();
      cancelled = true;
      cleanUp();
    };

    return exportPromise;
  }
}

module.exports = FileExportManager;
