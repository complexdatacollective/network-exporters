/* eslint-env jest */
const { SUPPORTED_FORMATS } = require('../consts/export-consts');
const { ExportError, ErrorMessages } = require('../consts/errors/ExportError');
const FileExportManager = require('../FileExportManager');
const MockFSInterface = require('../filesystem/testFs');

describe('FileExportManager', () => {
  let instance;

  beforeEach(() => {
    instance = new FileExportManager(MockFSInterface);
  });

  it('Returns supported formats', () => {
    expect(FileExportManager.getSupportedFormats()).toEqual(SUPPORTED_FORMATS);
  });

  describe('Prepare Export', () => {
    let result;

    it('Throws an error if parameters are missing', () => {
      // Missing sessions
      expect(
        () => instance.prepareExportJob(null, { 123: 243 }),
      ).toThrow(new ExportError(ErrorMessages.MissingParameters));

      // Missing protocols
      expect(
        () => instance.prepareExportJob([{}, {}], null),
      ).toThrow(new ExportError(ErrorMessages.MissingParameters));

      // Missing FS Interface
      expect(
        () => instance.prepareExportJob([{}, {}], { 123: 243 }, null),
      ).toThrow(new ExportError(ErrorMessages.MissingParameters));
    });

    it('Returns a run() and abort() method when parameters are provided', () => {
      result = instance.prepareExportJob([{}, {}], { 123: 243 });
      expect(typeof result.run).toEqual('function');
      expect(typeof result.abort).toEqual('function');
    });
  });

  describe('Run Export', () => {
    it('Returns a list of paths when export completes', async () => {
      const sessions = [{}, {}];
      const protocols = { 123: 243 };
      const result = await instance.prepareExportJob(sessions, protocols);
      const paths = await result.run();
      expect(paths).toEqual(['/path/to/file1', '/path/to/file2']);
    });

    // it('Emits progress events', () => {

    // });
  });

  describe('Abort Export', () => {
    it.todo('Lets a user export the export by calling the abort method');
  });

  describe('Configures export options', () => {
    it.todo('Sets temp path');

    it.todo('applies queue concurrency');

    it.todo('Processes unifyNetworks option');

    it.todo('Processes useScreenLayoutCoordinates option');

    it.todo('Processes screen layout size option');
  });
});
