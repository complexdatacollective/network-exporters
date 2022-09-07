# networkQuery [![Build Status](https://travis-ci.org/codaco/network-exporters.svg?branch=master)](https://travis-ci.org/codaco/network-exporters)
Utility for exporting a network

## Notes

- Include typing: [see here]<https://www.typescriptlang.org/docs/handbook/declaration-files/templates/module-class-d-ts.html>
- Move filesystem stuff to a separate package. Perhaps a monorepo?
- removed tempDataPath and userDataPath, and appPath so we can drop Electron dependency. These can be provided by consumer.
- need to create an abstracted filesystem interface that can be passed to this module, with separate cordova and electron instances.
- remove archive functionality - defer to the consume to decide what to do with encoded files. We will now return a list of paths
