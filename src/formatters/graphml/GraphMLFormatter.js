import { Readable } from 'stream';
import { graphMLGenerator } from './createGraphML';

class GraphMLFormatter {
  constructor(data, codebook, exportOptions) {
    this.network = data;
    this.codebook = codebook;
    this.useDirectedEdges = exportOptions.globalOptions.useDirectedEdges;
  }

  streamToString = (stream) => {
    const chunks = [];
    return new Promise((resolve, reject) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  }

  writeToString() {
    const generator = graphMLGenerator(
      this.network,
      this.codebook,
      this.useDirectedEdges,
    );
    const inStream = new Readable({
      read(/* size */) {
        const { done, value } = generator.next();
        if (done) {
          this.push(null);
        } else {
          this.push(value);
        }
      },
    });

    return this.streamToString(inStream);
  }

  writeToStream(outStream) {
    const generator = graphMLGenerator(
      this.network,
      this.codebook,
      this.useDirectedEdges,
    );
    const inStream = new Readable({
      read(/* size */) {
        const { done, value } = generator.next();
        if (done) {
          this.push(null);
        } else {
          this.push(value);
        }
      },
    });

    // TODO: handle teardown. Use pipeline() API in Node 10?
    inStream.pipe(outStream);

    return {
      abort: () => { inStream.destroy(); },
    };
  }
}

export default GraphMLFormatter;
