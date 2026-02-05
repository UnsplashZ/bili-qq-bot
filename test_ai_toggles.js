const config = require('./src/config');

console.log('Testing AI toggle functions...\n');

// Test 1: Global AI enabled (default)
console.log('Test 1: Global AI enabled');
console.log('  aiEnabled:', config.aiEnabled);
console.log('  aiRagEnabled:', config.aiRagEnabled);
console.log('  isAiEnabledForGroup("test"):', config.isAiEnabledForGroup('test'));
console.log('  isRagEnabledForGroup("test"):', config.isRagEnabledForGroup('test'));

// Test 2: Global AI disabled
config.aiEnabled = false;
console.log('\nTest 2: Global AI disabled');
console.log('  isAiEnabledForGroup("test"):', config.isAiEnabledForGroup('test'));
console.log('  isRagEnabledForGroup("test"):', config.isRagEnabledForGroup('test'));

// Test 3: Global AI enabled, group override disabled
config.aiEnabled = true;
config.ensureGroupConfig('test');
config.groupConfigs['test'].aiEnabled = false;
console.log('\nTest 3: Global enabled, group disabled');
console.log('  isAiEnabledForGroup("test"):', config.isAiEnabledForGroup('test'));
console.log('  isRagEnabledForGroup("test"):', config.isRagEnabledForGroup('test'));

console.log('\n✅ All tests completed');
