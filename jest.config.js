'use strict';

module.exports = {
  // Only look for tests under tests/unit/ — keeps http files and seed scripts out of the runner.
  testMatch: ['**/tests/unit/**/*.test.js'],
  testEnvironment: 'node',
  // CAP uses CommonJS; no transform needed.
  transform: {},
  // One suite at a time avoids port conflicts when multiple cds.test() servers start concurrently.
  maxWorkers: 1,
  // Print each test name so CI logs are readable without --verbose flag.
  verbose: true,
  // cds.test() leaves open handles (server socket) after the suite finishes.
  // forceExit terminates the process once all tests complete instead of waiting.
  forceExit: true,
};
