import { caseProperty, sessionStartTimeProperty, sessionFinishTimeProperty, sessionExportTimeProperty, protocolName, entityPrimaryKeyProperty, entityAttributesProperty } from '../src/utils/reservedAttributes';

export const mockCodebook = {
  node: {
    'mock-node-type': {
      name: 'person',
      variables: {
        'mock-uuid-1': { name: 'firstName', type: 'string' },
        'mock-uuid-2': { name: 'age', type: 'number' },
        'mock-uuid-3': { name: 'layout', type: 'layout' },
      },
    },
  },
  edge: {
    'mock-edge-type': {
      name: 'peer',
    },
  },
};

export const mockExportOptions = {
  exportGraphML: true,
  exportCSV: true,
  globalOptions: {
    unifyNetworks: false,
    useDirectedEdges: false,
    useScreenLayoutCoordinates: true,
    screenLayoutHeight: 1080,
    screenLayoutWidth: 1920,
  },
};

export const mockNetwork = {
  nodes: [
    { [entityPrimaryKeyProperty]: '1', type: 'mock-node-type', [entityAttributesProperty]: { 'mock-uuid-1': 'Dee', 'mock-uuid-2': 40, 'mock-uuid-3': { x: 0, y: 0 } } },
    { [entityPrimaryKeyProperty]: '2', type: 'mock-node-type', [entityAttributesProperty]: { 'mock-uuid-1': 'Carl', 'mock-uuid-2': 50, 'mock-uuid-3': { x: 0, y: 0 } } },
  ],
  edges: [
    { from: '1', to: '2', type: 'mock-edge-type' },
  ],
  sessionVariables: {
    [caseProperty]: 123,
    [protocolName]: 'protocol name',
    [sessionStartTimeProperty]: 100,
    [sessionFinishTimeProperty]: 200,
    [sessionExportTimeProperty]: 300,
  },
};
