/* eslint-env jest */

import { DOMParser } from 'xmldom';
import { mockExportOptions, mockNetwork, mockCodebook, processMockNetworks, mockNetwork2 } from '../../../../config/mockObjects';
import graphMLGenerator from '../createGraphML';

describe('buildGraphML', () => {
  const buildXML = (...args) => {
    let xmlString = '';
    for (const chunk of graphMLGenerator(...args)) { // eslint-disable-line no-restricted-syntax, no-unused-vars, max-len
      xmlString += chunk;
    }
    return (new DOMParser()).parseFromString(xmlString);
  };
  const edgeType = mockCodebook.edge["mock-edge-type"].name;
  const nodeType = mockCodebook.node["mock-node-type"].name;
  let network;
  let codebook;
  let exportOptions;
  let xml;

  beforeEach(() => {
    network = mockNetwork;
    codebook = mockCodebook;
    exportOptions = {
      ...mockExportOptions,
      exportGraphML: true,
    }

    const processedNetworks = processMockNetworks([mockNetwork, mockNetwork2], false);
    const protocolNetwork = processedNetworks['protocol-uid-1'][0];

    xml = buildXML(protocolNetwork, codebook, exportOptions);
  });

  it('produces a graphml document', () => {
    expect(xml.getElementsByTagName('graphml')).toHaveLength(1);
  });

  it('creates a single graph element when not merging', () => {
    expect(xml.getElementsByTagName('graph')).toHaveLength(1);
  });

  it('defaults to undirected edges', () => {
    expect(xml.getElementsByTagName('graph')[0].getAttribute('edgedefault')).toEqual('undirected');
  });

  it('adds nodes', () => {
    expect(xml.getElementsByTagName('node')).toHaveLength(2);
  });

  it('adds node type', () => {
    const node = xml.getElementsByTagName('node')[0];
    expect(node.getElementsByTagName('data')[1].textContent).toEqual(nodeType);
  });

  it('adds edge type', () => {
    const edge = xml.getElementsByTagName('edge')[0];
    expect(edge.getElementsByTagName('data')[1].textContent).toEqual(edgeType);
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
      const processedNetworks = processMockNetworks([mockNetwork, mockNetwork2], false);
      const protocolNetwork = processedNetworks['protocol-uid-1'][0];

      xml = buildXML(protocolNetwork, codebook, {
        ...exportOptions,
        globalOptions: {
          useDirectedEdges: true,
        },
      });
    });

    it('specifies directed edges', () => {
      expect(xml.getElementsByTagName('graph')[0].getAttribute('edgedefault')).toEqual('directed');
    });
  });

  describe('with merged networks', () => {
    beforeEach(() => {
      const processedNetworks = processMockNetworks([mockNetwork, mockNetwork2], true);
      const protocolNetwork = processedNetworks['protocol-uid-1'][0];

      xml = buildXML(protocolNetwork, codebook, {
        ...exportOptions,
        globalOptions: {
          unifyNetworks: true,
        },
      });
    });

    it('creates multiple graph elements', () => {
      expect(xml.getElementsByTagName('graph')).toHaveLength(2);
    });
  });
});
