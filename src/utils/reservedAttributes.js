// TODO: share with other places this is defined
export const exportIDProperty = '_id'; // auto incrementing ID number, only generated during export.
export const exportFromProperty = '_from'; // 'from' edge property using export ID number rather then UUID
export const exportToProperty = '_to'; // as above, but for 'to' property
export const entityPrimaryKeyProperty = '_uid';
export const egoProperty = '_egoId';
export const caseProperty = '_caseId';
export const sessionProperty = '_sessionId';
export const ncProtocolProperty = '_protocolUID';
export const ncProtocolName = '_protocolName';
export const remoteProtocolProperty = '_remoteProtocolID';
export const entityTypeProperty = '_type'; // NC sends as 'type' at the top level, but this will allow us to also look for a user attribute named type
export const sessionStartTimeProperty = '_sessionStart';
export const sessionFinishTimeProperty = '_sessionFinish';
export const sessionExportTimeProperty = '_sessionExported';

export const entityAttributesProperty = 'attributes';

export const reservedProperties = [
  exportIDProperty,
  exportFromProperty,
  exportToProperty,
  entityPrimaryKeyProperty,
  entityAttributesProperty,
  egoProperty,
  caseProperty,
  sessionProperty,
  ncProtocolProperty,
  ncProtocolName,
  remoteProtocolProperty,
  entityTypeProperty,
  sessionStartTimeProperty,
  sessionFinishTimeProperty,
  sessionExportTimeProperty,
];
