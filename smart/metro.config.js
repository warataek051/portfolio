const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.symbolicator = {
  customizeFrame: (frame) => {
    if (frame?.file && frame.file.includes('<anonymous>')) {
      return {
        ...frame,
        file: null,
        collapse: true,
      };
    }
    return frame;
  },
};

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  mqtt: path.resolve(__dirname, 'node_modules/mqtt/dist/mqtt.min.js'),
};

module.exports = config;
