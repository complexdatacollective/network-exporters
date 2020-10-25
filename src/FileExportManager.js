/* eslint-disable global-require */
const { merge, isEmpty, groupBy, flattenDeep, first } = require('lodash');
const { EventEmitter } = require('eventemitter3');
const sanitizeFilename = require('sanitize-filename');
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
const { verifySessionVariables } = require('./utils/general');
const { isCordova, isElectron } = require('./utils/Environment');
const archive = require('./utils/archive');
const { ExportError, ErrorMessages } = require('./errors/ExportError');
const ProgressMessages = require('./ProgressMessages');
const UserCancelledExport = require('./errors/UserCancelledExport');

/**
 * Interface for all data exports
 */
class FileExportManager {
  constructor(exportOptions = {}) {
    const defaultCSVOptions = {
      adjacencyMatrix: false,
      attributeList: true,
      edgeList: true,
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
    this.exportOptions = {
      ...merge(defaultExportOptions, exportOptions),
      ...(exportOptions.exportCSV === true ? { exportCSV: defaultCSVOptions } : {}),
    };

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
    let promisedExports; // Will hold array of promises representing each export task
    let cancelled = false; // Top-level cancelled property used to abort promise chain

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

    // exportPromise is the return value of this method
    const exportPromise = makeTempDir() // Begin by creating temporary directory
      .then((dir) => {
        tmpDir = isCordova() ? dir.toInternalURL() : dir;
      })
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

        // Create an array of promises representing each session in each export format
        const finishedSessions = [];
        const sessionExportTotal = this.exportOptions.globalOptions.unifyNetworks
          ? Object.keys(unifiedSessions).length : sessions.length;

        promisedExports = flattenDeep(
          Object.keys(unifiedSessions).map((protocolUUID) => {
            // Reject if no protocol was provided for this session
            if (!protocols[protocolUUID]) {
              return Promise.reject(new ExportError(ErrorMessages.MissingParameters));
            }

            return unifiedSessions[protocolUUID].map((session) => {
              // Reject if sessions don't have required sessionVariables
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
                return Promise.reject(e);
              }

              const protocol = protocols[protocolUUID];
              let prefix;

              // Determine filename prefix based on if we are exporting a single session
              // or a unified network
              if (this.exportOptions.globalOptions.unifyNetworks) {
                prefix = sanitizeFilename(protocol.name);
              } else {
                prefix = `${sanitizeFilename(session.sessionVariables[caseProperty])}_${session.sessionVariables[sessionProperty]}`;
              }

              const exportFormats = [
                ...(this.exportOptions.exportGraphML ? ['graphml'] : []),
                ...(this.exportOptions.exportCSV ? ['ego'] : []),
                ...(this.exportOptions.exportCSV.adjacencyMatrix ? ['adjacencyMatrix'] : []),
                ...(this.exportOptions.exportCSV.attributeList ? ['attributeList'] : []),
                ...(this.exportOptions.exportCSV.edgeList ? ['edgeList'] : []),
              ];

              // Returns promise resolving to filePath for each format exported
              // ['file1', ['file1_person', 'file1_place']]
              return exportFormats.map((format) => {
                // partitioning network based on node and edge type so we can create
                // an individual export file for each type
                const partitionedNetworks = partitionNetworkByType(
                  protocol.codebook,
                  session,
                  format,
                );

                return partitionedNetworks.map((partitionedNetwork) => {
                  const partitionedEntity = partitionedNetwork.partitionEntity;
                  if (!finishedSessions.includes(prefix)) {
                    this.emit('session-exported', session.sessionVariables.sessionId);
                    this.emit('update', ProgressMessages.ExportSession(finishedSessions.length + 1, sessionExportTotal));
                    finishedSessions.push(prefix);
                  }

                  try {
                    // gather one promise for each exported file
                    return exportFile(
                      prefix,
                      partitionedEntity,
                      format,
                      tmpDir,
                      partitionedNetwork,
                      protocol.codebook,
                      this.exportOptions,
                    );
                  } catch (error) {
                    this.emit('error', `Encoding ${prefix} failed: ${error.message}`);
                    return Promise.reject(error);
                  }
                });
              });
            });
          }),
        );

        return Promise.allSettled(promisedExports);
      })
      // Then, Zip the result.
      .then((exportedPaths) => {
        if (cancelled) {
          return Promise.reject(new UserCancelledExport());
        }

        // Remove any exports that failed - we don't need
        // to try and add them to the ZIP.
        const validExportedPaths = exportedPaths
          .filter(path => path.status === 'fulfilled')
          .map(filteredPath => filteredPath.value);

        // FatalError if no sessions survived the cull
        if (validExportedPaths.length === 0) {
          throw new ExportError(ErrorMessages.NothingToExport);
        }

        // Start the zip process, and attach a callback to the update
        // progress event.
        this.emit('update', ProgressMessages.ZipStart);
        return archive(validExportedPaths, tmpDir, (percent) => {
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
      if (promisedExports) {
        promisedExports.forEach((promise) => {
          if (promise.abort) {
            promise.abort();
          }
        });
      }
      cancelled = true;
      cleanUp();
    };

    return exportPromise;
  }
}

module.exports = FileExportManager;
