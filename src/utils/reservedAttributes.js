// Model properties
const entityPrimaryKeyProperty = '_uid';
const entityAttributesProperty = 'attributes';
const edgeSourceProperty = 'from';
const edgeTargetProperty = 'to';

// Session variable properties
const caseProperty = 'caseId';
const sessionProperty = 'sessionId';
const protocolProperty = 'protocolUID';
const protocolName = 'protocolName';
const remoteProtocolProperty = 'remoteProtocolID';
const sessionStartTimeProperty = 'sessionStart';
const sessionFinishTimeProperty = 'sessionFinish';
const sessionExportTimeProperty = 'sessionExported';

// Export properties
const exportIDProperty = 'id'; // property for auto incrementing ID number
const egoProperty = 'networkCanvasEgoUUID';
const ncTypeProperty = 'networkCanvasType';
const ncProtocolNameProperty = 'networkCanvasProtocolName';
const ncCaseProperty = 'networkCanvasCaseID';
const ncSessionProperty = 'networkCanvasSessionID';
const ncUUIDProperty = 'networkCanvasUUID';
const ncSourceUUID = 'networkCanvasSourceUUID';
const ncTargetUUID = 'networkCanvasTargetUUID';

module.exports = {
  caseProperty,
  edgeSourceProperty,
  edgeTargetProperty,
  egoProperty,
  entityAttributesProperty,
  entityPrimaryKeyProperty,
  exportIDProperty, // property for auto incrementing ID number
  ncCaseProperty,
  ncProtocolNameProperty,
  ncSessionProperty,
  ncSourceUUID,
  ncTargetUUID,
  ncTypeProperty,
  ncUUIDProperty,
  protocolName,
  protocolProperty,
  remoteProtocolProperty,
  sessionExportTimeProperty,
  sessionFinishTimeProperty,
  sessionProperty,
  sessionStartTimeProperty,
};
