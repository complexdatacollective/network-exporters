/* eslint-env jest */

const { Writable } = require('stream');
const GraphMLFormatter = require('../GraphMLFormatter');

const makeWriteableStream = () => {
  const chunks = [];

  const writable = new Writable({
    write(chunk, encoding, next) {
      chunks.push(chunk.toString());
      next(null);
    },
  });

  writable.asString = async () => new Promise((resolve, reject) => {
    writable.on('finish', () => { resolve(chunks.join('')); });
    writable.on('error', (err) => { reject(err); });
  });

  return writable;
};

describe('GraphMLFormatter writeToStream', () => {
  let network;
  let codebook;
  let writable;

  beforeEach(() => {
    writable = makeWriteableStream();
    network = { nodes: [], edges: [] };
    codebook = { node: {} };
  });

  it('returns an abort controller', () => {
    const formatter = new GraphMLFormatter(network, false, false, codebook);
    const controller = formatter.writeToStream(writable);
    expect(controller.abort).toBeInstanceOf(Function);
  });

  it('produces XML', async () => {
    const formatter = new GraphMLFormatter(network, false, false, codebook);
    formatter.writeToStream(writable);
    const xml = await writable.asString();
    expect(xml).toMatch('<graphml');
  });
});
