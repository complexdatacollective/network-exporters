/* eslint-env jest */

import { DOMParser } from 'xmldom';
import { mockExportOptions } from '../../../../config/mockObjects';
import graphMLGenerator from '../createGraphML';
import { caseProperty, sessionExportTimeProperty, sessionFinishTimeProperty, sessionStartTimeProperty, protocolName } from '../../../utils/reservedAttributes';

describe('buildGraphML', () => {
  const buildXML = (...args) => {
    let xmlString = '';
    for (const chunk of graphMLGenerator(...args)) { // eslint-disable-line no-restricted-syntax, no-unused-vars, max-len
      xmlString += chunk;
    }
    return (new DOMParser()).parseFromString(xmlString);
  };
  const edgeType = 'peer';
  const nodeType = 'person';
  let network;
  let codebook;
  let xml;

  beforeEach(() => {
    network = {
      nodes: [
        { _uid: '1', type: 'mock-node-type', attributes: { 'mock-uuid-1': 'Dee', 'mock-uuid-2': 40, 'mock-uuid-3': { x: 0, y: 0 } } },
        { _uid: '2', type: 'mock-node-type', attributes: { 'mock-uuid-1': 'Carl', 'mock-uuid-2': 50, 'mock-uuid-3': { x: 0, y: 0 } } },
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
    codebook = {
      node: {
        'mock-node-type': {
          name: nodeType,
          variables: {
            'mock-uuid-1': { name: 'firstName', type: 'string' },
            'mock-uuid-2': { name: 'age', type: 'number' },
            'mock-uuid-3': { name: 'layout', type: 'layout' },
          },
        },
      },
      edge: {
        'mock-edge-type': {
          name: edgeType,
        },
      },
    };
    xml = buildXML(network, codebook, mockExportOptions);
  });

  it('produces a graphml document', () => {
    expect(xml.getElementsByTagName('graphml')).toHaveLength(1);
  });

  it('defaults to undirected edges', () => {
    expect(xml.getElementsByTagName('graph')[0].getAttribute('edgedefault')).toEqual('undirected');
  });

  it('adds nodes', () => {
    expect(xml.getElementsByTagName('node')).toHaveLength(2);
  });

  it('adds node type', () => {
    const node = xml.getElementsByTagName('node')[0];
    expect(node.getElementsByTagName('data')[1].textContent).toEqual('person');
  });

  it('adds edge type', () => {
    const edge = xml.getElementsByTagName('edge')[0];
    expect(edge.getElementsByTagName('data')[1].textContent).toEqual('peer');
  });

  it('adds edges', () => {
    expect(xml.getElementsByTagName('edge')).toHaveLength(1);
  });

  it('infers int types', () => { // This indicates that transposition worked for nodes
    expect(xml.getElementById('mock-uuid-2').getAttribute('attr.type')).toEqual('int');
  });

  it('converts layout types', () => {
    expect(xml.getElementById('mock-uuid-3_X').getAttribute('attr.type')).toEqual('double');
    expect(xml.getElementById('mock-uuid-3_Y').getAttribute('attr.type')).toEqual('double');
  });

  it('exports edge labels', () => { // This indicates that [non-]transposition worked for edges
    const edge = xml.getElementsByTagName('edge')[0];
    expect(edge.getElementsByTagName('data')[1].textContent).toEqual(edgeType);
  });

  describe('with directed edge option', () => {
    beforeEach(() => {
      xml = buildXML(network, codebook, {
        ...mockExportOptions,
        globalOptions: {
          useDirectedEdges: true,
        },
      });
    });

    it('specifies directed edges', () => {
      expect(xml.getElementsByTagName('graph')[0].getAttribute('edgedefault')).toEqual('directed');
    });
  });
});
