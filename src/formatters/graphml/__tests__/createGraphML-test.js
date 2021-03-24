/* eslint-env jest */

import { DOMParser } from 'xmldom';
import {
  mockExportOptions, mockNetwork, mockCodebook, processMockNetworks, mockNetwork2,
} from '../../../../config/mockObjects';
import graphMLGenerator from '../createGraphML';

const getChildElements = (parentEl, elements) => Array.from(elements)
  .filter((el) => el.parentNode === parentEl);

const buildXML = (...args) => {
  let xmlString = '';
  for (const chunk of graphMLGenerator(...args)) { // eslint-disable-line no-restricted-syntax, no-unused-vars, max-len
    xmlString += chunk;
  }
  return (new DOMParser()).parseFromString(xmlString);
};

describe('buildGraphML', () => {
  const edgeType = mockCodebook.edge['mock-edge-type'].name;
  const nodeType = mockCodebook.node['mock-node-type'].name;
  const codebook = mockCodebook;
  let exportOptions;
  let xml;

  beforeEach(() => {
    exportOptions = {
      ...mockExportOptions,
      exportGraphML: true,
    };

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
    expect(xml.getElementsByTagName('node')).toHaveLength(3);
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

  describe('ego', () => {
    it('adds ego data', () => {
      const graphData = getChildElements(
        xml.getElementsByTagName('graph')[0],
        xml.getElementsByTagName('data'),
      )
        .reduce((acc, node) => ({
          ...acc,
          [node.getAttribute('key')]: node.textContent,
        }), {});

      expect(graphData).toMatchObject({
        networkCanvasUUID: 'ego-id-1',
        'mock-uuid-1': 'Dee',
        'mock-uuid-2': '40',
        'mock-uuid-3': 'false',
      });
    });

    it('omits networkCanvasUUID data element when network.codebook.ego is empty', () => {
      const processedNetworks = processMockNetworks([mockNetwork, mockNetwork2], false);
      const protocolNetwork = processedNetworks['protocol-uid-1'][0];
      const { ego, ...egolessCodebook } = codebook;
      const egolessNetwork = { ...protocolNetwork, ego: {} };
      const noEgoXML = buildXML(egolessNetwork, egolessCodebook, exportOptions);
      const graphData = getChildElements(
        noEgoXML.getElementsByTagName('graph')[0],
        noEgoXML.getElementsByTagName('data'),
      )
        .reduce((acc, node) => ({
          ...acc,
          [node.getAttribute('key')]: node.textContent,
        }), {});
      expect(graphData).not.toHaveProperty('networkCanvasUUID');
    });
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

  it('includes 0 and false values', () => {
    const node = xml.getElementsByTagName('node')[1];
    expect(node.getElementsByTagName('data')[4].textContent).toEqual('0'); // node var
    expect(xml.getElementsByTagName('data')[3].textContent).toEqual('false'); // ego var
  });

  it('excludes null values', () => {
    const nodeSansNull = xml.getElementsByTagName('node')[0];
    const anotherSansNull = xml.getElementsByTagName('node')[1];
    const nodeWithNull = xml.getElementsByTagName('node')[2];
    expect(nodeSansNull.getElementsByTagName('data').length).toEqual(9);
    expect(anotherSansNull.getElementsByTagName('data').length).toEqual(9);
    expect(nodeWithNull.getElementsByTagName('data').length).toEqual(5);
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
