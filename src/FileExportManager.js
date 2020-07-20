import { merge, isEmpty, groupBy, flattenDeep, compact } from 'lodash';
import { EventEmitter } from 'eventemitter3';
import {
  caseProperty,
  sessionProperty,
  protocolProperty,
} from './utils/reservedAttributes';
import {
  getFileNativePath,
  rename,
  removeDirectory,
  makeTempDir,
} from './utils/filesystem';
import { exportFile } from './exportFile';
import {
  insertEgoIntoSessionNetworks,
  resequenceIds,
  partitionNetworkByType
} from './formatters/network';
import { verifySessionVariables } from './utils/general';
import { isCordova, isElectron } from './utils/Environment';
import archive from './utils/archive';
import sanitizeFilename from 'sanitize-filename';
import { ExportError, ErrorMessages} from './errors/ExportError';
import ProgressMessages from './ProgressMessages';
import UserCancelledExport from './errors/UserCancelledExport';

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
   *
   * @param {*} sessions        collection of session objects
   * @param {*} protocols       collection of protocol objects, containing all protocols
   *                            mentioned in sessions collection.
   * @param {*} destinationPath path to write the resulting files to
   */
  exportSessions(sessions, protocols) {
    let tmpDir;
    let promisedExports;
    let cancelled = false;

    this.emit('begin', ProgressMessages.Begin);

    // Reject if required parameters aren't provided
    if (
      (!sessions && !isEmpty(sessions)) ||
      (!protocols && !isEmpty(protocols))
    ) {
      return Promise.reject(new ExportError(ErrorMessages.MissingParameters));
    }

    const cleanUp = () => {
      if (tmpDir) {
        removeDirectory(tmpDir)
      }
    };

    // First, create a temporary working directory somewhere on the FS.
    const exportPromise = makeTempDir()
      .then((dir) => {
        tmpDir = isCordova() ? dir.toInternalURL() : dir;
        return;
      })
      // Then, insert a reference to the ego ID into all nodes and edges
      .then(() => {
        this.emit('update', ProgressMessages.Formatting);

        return insertEgoIntoSessionNetworks(sessions);
      })
      // Then, resequence IDs for this export
      .then(sessionsWithEgo => resequenceIds(sessionsWithEgo))
      // Group sessions by protocol UUID
      .then(sessionsWithResequencedIDs => groupBy(sessionsWithResequencedIDs, `sessionVariables.${protocolProperty}`))
      // Then, process the union option
      .then(sessionsByProtocol => {
        if (cancelled) {
          return Promise.reject(new UserCancelledExport());
        }

        if (!this.exportOptions.globalOptions.unifyNetworks) {
          return sessionsByProtocol;
        }

        this.emit('update', ProgressMessages.Merging);

        // Result is a SINGLE session, with MULTIPLE ego and sessionVariables
        // We add the sessionID to each entity so that we can groupBy on it within
        // the exporter to reconstruct the sessions.
        return Object.keys(sessionsByProtocol)
        .reduce((sessions, protocolUUID) => {
          const protocolSessions = sessionsByProtocol[protocolUUID]
            .reduce((union, session) => ({
              // Merge node list when union option is selected
              nodes: [...union.nodes, ...session.nodes.map(node => ({
                ...node,
                [sessionProperty]: session.sessionVariables[sessionProperty],
              }))],
              edges: [...union.edges, ...session.edges.map(edge => ({
                ...edge,
                [sessionProperty]: session.sessionVariables[sessionProperty],
              }))],
              ego: {
                ...union.ego,
                [session.sessionVariables[sessionProperty]]: session.ego,
              },
              sessionVariables: {
                ...union.sessionVariables,
                [session.sessionVariables[sessionProperty]]: session.sessionVariables,
              },
            }), { nodes: [], edges: [], ego: {}, sessionVariables: {} });
          return {
            ...sessions,
            [protocolUUID]: Array(protocolSessions),
          }
        }, {});
      })
      .then((unifiedSessions) => {
        if (cancelled) {
          return Promise.reject(new UserCancelledExport());
        }

        // Create an array of promises representing each session in each export format
        const finishedSessions = [];
        const sessionExportTotal = this.exportOptions.globalOptions.unifyNetworks ? Object.keys(unifiedSessions).length : sessions.length;

        promisedExports = flattenDeep(
          Object.keys(unifiedSessions).map(protocolUUID => {
            // Reject if no protocol was provided for this session
            if (!protocols[protocolUUID]) {
              return Promise.reject(new ExportError(ErrorMessages.MissingParameters));
            };

            return unifiedSessions[protocolUUID].map((session) => {
              // Reject if sessions don't have required sessionVariables
              if (this.exportOptions.globalOptions.unifyNetworks) {
                Object.values(session.sessionVariables).forEach(sessionVariables => {
                  verifySessionVariables(sessionVariables);
                })
              } else {
                verifySessionVariables(session.sessionVariables);
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
              return exportFormats.map(format => {
                // partitioning network based on node and edge type so we can create
                // an individual export file for each type
                const partitionedNetworks = partitionNetworkByType(protocol.codebook, session, format);

                return partitionedNetworks.map((partitionedNetwork) => {
                  const partitionedEntity = partitionedNetwork.partitionEntity;
                  if (!finishedSessions.includes(prefix)) {
                    this.emit('update', ProgressMessages.ExportSession(finishedSessions.length+1, sessionExportTotal))
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
                })
              });
            })
          }),
        );

        return Promise.allSettled(promisedExports)
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
            const { dialog } = window.require('electron').remote;

            dialog.showSaveDialog({
              filters: [{ name: 'zip', extensions: ['zip'] }],
              defaultPath: 'networkCanvasExport.zip',
            })
            .then(({ canceled, filePath }) => {
              if (canceled) { resolve(); }

              rename(zipLocation, filePath)
              .then(() => {
                const { shell } = window.require('electron');
                shell.showItemInFolder(filePath);
                resolve();
              })
              .catch(reject)
            })
          }

          if (isCordova()) {
            getFileNativePath(zipLocation)
            .then(nativePath => {
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
        promisedExports.forEach(promise => {
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

export default FileExportManager;
