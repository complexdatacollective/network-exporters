/* eslint-env jest */
import GraphMLFormatter from '../graphml/GraphMLFormatter';
import { entityPrimaryKeyProperty } from '../../utils/reservedAttributes';
import {
  extensions,
  getFileExtension,
} from '../../utils/general';
import {
  partitionNetworkByType,
} from '../network';
import getFormatterClass from '../../utils/getFormatterClass';

describe('formatter utilities', () => {
  describe('getFileExtension', () => {
    it('maps CSV types', () => {
      expect(getFileExtension(extensions.adjacencyMatrix)).toEqual('.csv');
      expect(getFileExtension(extensions.edgeList)).toEqual('.csv');
      expect(getFileExtension(extensions.attributeList)).toEqual('.csv');
      expect(getFileExtension(extensions.ego)).toEqual('.csv');
    });
  });

  describe('getFormatterClass', () => {
    it('maps graphml to its formatter', () => {
      expect(getFormatterClass(extensions.graphml)).toEqual(GraphMLFormatter);
    });

    it('maps each format to a class', () => {
      Object.keys(extensions).forEach((format) => {
        expect(getFormatterClass(format)).toBeDefined();
      });
    });
  });

  describe('partitionNetworkByType', () => {
    const alice = { [entityPrimaryKeyProperty]: 'a' };
    const bob = { [entityPrimaryKeyProperty]: 'b' };
    const carla = { [entityPrimaryKeyProperty]: 'c' };
    let nodes;
    let network;
    beforeEach(() => {
      nodes = [alice, bob, carla];
      network = {
        nodes,
        edges: [{ from: 'a', to: 'b', type: 'knows' }, { from: 'a', to: 'b', type: 'likes' }],
      };
    });

    it('partitions edges for matrix output', () => {
      const partitioned = partitionNetworkByType(network, extensions.adjacencyMatrix);
      expect(partitioned[0].edges).toEqual([network.edges[0]]);
      expect(partitioned[1].edges).toEqual([network.edges[1]]);
    });

    it('partitions edges for edge list output', () => {
      const partitioned = partitionNetworkByType(network, extensions.edgeList);
      expect(partitioned[0].edges).toEqual([network.edges[0]]);
      expect(partitioned[1].edges).toEqual([network.edges[1]]);
    });

    it('does not partition for other types', () => {
      expect(partitionNetworkByType(network, extensions.graphml)).toHaveLength(1);
      expect(partitionNetworkByType(network, extensions.attributeList)).toHaveLength(1);
    });

    it('decorates with an edgeType prop', () => {
      const partitioned = partitionNetworkByType(network, extensions.adjacencyMatrix);
      expect(partitioned[0].edgeType).toEqual('knows');
      expect(partitioned[1].edgeType).toEqual('likes');
    });

    it('maintains a reference to nodes (without copying or modifying)', () => {
      // This is important to keep memory use low on large networks
      const partitioned = partitionNetworkByType(network, extensions.adjacencyMatrix);
      expect(partitioned[0].nodes).toBe(nodes);
      expect(partitioned[1].nodes).toBe(nodes);
    });

    it('returns at least 1 network, even when no edges', () => {
      const partitioned = partitionNetworkByType({ nodes, edges: [] }, extensions.adjacencyMatrix);
      expect(partitioned).toHaveLength(1);
      expect(partitioned[0].nodes).toBe(nodes);
    });
  });
});
