module.exports = function rawLoader(source) {
  return `module.exports = ${JSON.stringify(source)};`;
};
