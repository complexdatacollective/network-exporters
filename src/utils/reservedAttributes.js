// TODO: share with other places this is defined
export const exportIDProperty = '_id';
export const entityPrimaryKeyProperty = '_uid';
export const egoProperty = '_egoID';
export const caseProperty = '_caseID';
export const sessionProperty = '_sessionID';
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
