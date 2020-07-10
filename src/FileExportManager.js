import { merge, isEmpty, groupBy, flattenDeep } from 'lodash';
import { EventEmitter } from 'eventemitter3';
import {
  caseProperty,
  sessionProperty,
  remoteProtocolProperty,
  sessionExportTimeProperty,
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
import { isCordova, isElectron } from './utils/Environment';
import archive from './utils/archive';
import sanitizeFilename from 'sanitize-filename';
import { RequestError, ErrorMessages} from './errors/RequestError';

/**
 * Interface for all data exports
 */
class FileExportManager {

  constructor(exportOptions = {}) {
    // Todo: Reject if export options arent valid
    // if (!formatsAreValid(exportFormats) || !exportFormats.length) {
    //   return Promise.reject(new RequestError(ErrorMessages.InvalidExportOptions));
    // }

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

    // Allow shorthand 'true' to accept default export options for a given type
    this.exportOptions = {
      ...merge(defaultExportOptions, exportOptions),
      ...(exportOptions.exportCSV === true ? { exportCSV: defaultCSVOptions } : {}),
    };

    this.events = new EventEmitter();

    setInterval(() => this.emit('pulse', 'hello!'), 1000);

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

  provideUpdate(statusText, progress) {
    this.emit('update', {
      statusText,
      progress,
    })
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
    this.emit('begin');

    // Reject if required parameters aren't provided
    if (
      (!sessions && !isEmpty(sessions))
      || (!protocols && !isEmpty(protocols))
    ) {
      return Promise.reject(new RequestError(ErrorMessages.MissingParameters));
    }

    let tmpDir;

    const cleanUp = () => {
      removeDirectory(tmpDir)
    };

    let promisedExports;

    // First, create a temporary working directory somewhere on the FS.
    const exportPromise = makeTempDir()
      .then((dir) => {
        if (!dir) {
          throw new Error('Temporary directory unavailable');
        }

        tmpDir = isCordova() ? dir.toInternalURL() : dir;
        return;
      })
      // Then, insert a reference to the ego ID in to all nodes and edges
      .then(() => {
        this.provideUpdate(
          'Formatting network data...',
          10,
        );

        return insertEgoIntoSessionNetworks(sessions);
      })
      // Then, resequence IDs for this export
      .then(sessionsWithEgo => resequenceIds(sessionsWithEgo))
      // Group sessions by protocol UUID
      .then(sessionsWithResequencedIDs => groupBy(sessionsWithResequencedIDs, `sessionVariables.${protocolProperty}`))
      // Then, process the union option
      .then(sessionsByProtocol => {
        if (!this.exportOptions.globalOptions.unifyNetworks) {
          return sessionsByProtocol;
        }

        this.provideUpdate(
          'Merging networks...',
          20,
        );

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
                    } ,
                }), { nodes: [], edges: [], ego: {}, sessionVariables: {} });
            return {
                ...sessions,
                [protocolUUID]: Array(protocolSessions),
            }
        }, {});
      })
      // Encode each network in each format specified
      .then((unifiedSessions) => {
        let sessionExportCount = 1;
        const sessionExportTotal = sessions.length;

        promisedExports = flattenDeep(
          // Export every network
          // => [n1, n2]
          Object.keys(unifiedSessions).map(protocolUUID => {
            // Reject if no protocol was provided for this session
            if (!protocols[protocolUUID]) {
              return Promise.reject(new RequestError(ErrorMessages.MissingParameters));
            };

            return unifiedSessions[protocolUUID].map(session => {
              this.provideUpdate(
                `Exporting session ${sessionExportCount} of ${sessionExportTotal}`,
                30 + ((80 - 30) * sessionExportCount / sessionExportTotal),
              );

              sessionExportCount += 1;

              // todo: move out of this loop to network utils
              const verifySessionVariables = (sessionVariables) => {
                if (
                  !sessionVariables[caseProperty] ||
                  !sessionVariables[sessionProperty] ||
                  !sessionVariables[remoteProtocolProperty] ||
                  !sessionVariables[sessionExportTimeProperty]
                ) {
                  return Promise.reject(new RequestError(ErrorMessages.MissingParameters));
                }
              }

              // Reject if sessions don't have required sessionVariables
              // Should match https://github.com/codaco/graphml-schemas/blob/master/xmlns/1.0/graphml%2Bnetcanvas.xsd
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

              // Translate our new configuration object back into the old syntax
              // TODO: update this to use the new configuration object directly.
              const exportFormats = [
                ...(this.exportOptions.exportGraphML ? ['graphml'] : []),
                ...(this.exportOptions.exportCSV ? ['ego'] : []),
                ...(this.exportOptions.exportCSV.adjacencyMatrix ? ['adjacencyMatrix'] : []),
                ...(this.exportOptions.exportCSV.attributeList ? ['attributeList'] : []),
                ...(this.exportOptions.exportCSV.edgeList ? ['edgeList'] : []),
              ];
              // ...in every file format requested
              // => [[n1.matrix.csv, n1.attrs.csv], [n2.matrix.csv, n2.attrs.csv]]
              return exportFormats.map(format =>
                // partitioning network based on node and edge type so we can create
                // an individual export file for each type

                partitionNetworkByType(protocol.codebook, session, format).map((partitionedNetwork) => {
                  const partitionedEntity = partitionedNetwork.partitionEntity;
                  console.log('partition temp', tmpDir);
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
                })
              );
            })
          }),
        );

        return Promise.all(promisedExports);
      })
      // Then, Zip the result.
      .then((exportedPaths) => {
        if (exportedPaths.length === 0) {
          throw new RequestError(ErrorMessages.NothingToExport);
        }

        this.provideUpdate(
          'Zipping files...',
          80,
        );

        return archive(exportedPaths, tmpDir);
      })
      .then((zipLocation) => {
        this.provideUpdate(
          'Saving...',
          100,
        );
        return new Promise((resolve, reject) => {
          console.log('zip tmp dir', tmpDir);
          if (isElectron()) {
            // Open saveas dialog
            const { dialog } = window.require('electron').remote;

            dialog.showSaveDialog({
              filters: [{ name: 'zip', extensions: ['zip'] }],
              defaultPath: 'networkCanvasExport.zip',
            })
            .then(({
              canceled,
              filePath
            }) => {
              if (canceled) {
                console.log('cancelled dialog');
                resolve();
              }
              // we have a filepath. copy from temp location to this location.
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
            // Use social sharing plugin to copy.
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
      .catch((err) => {
        cleanUp();
        throw err;
      })
      .then(() => {
        this.emit('finished');
        cleanUp();
      });

    exportPromise.abort = () => {
      if (promisedExports) {
        promisedExports.forEach(promise => promise.abort());
      }
      cleanUp();
    };

    return exportPromise;
  }
}

export default FileExportManager;
