'use strict';
// Production read-contract regression after v2.6.7.5 displayed 0/0 for a valid 203-category snapshot.
// Snapshot engine schema metadata was independently read from Neon on 2026-10-12; Company_Map is a live versioned contract.
// The taxonomy freeze is independently identified by companyMapVersion, not by renaming engine identifiers.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const xy=require('../lib/fundflow-xy');
const freeze=require('../lib/final-taxonomy-freeze');
const pkg=require('../package.json');
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
const core=fs.readFileSync(require.resolve('../lib/fundflow-xy'),'utf8');
const known={
  engine:'xy-8.4.4-clean-feature2-path311-taxonomy26',
  daily:'daily-7.1.3-taxonomy26',
  snapshot:'snapshot-7.0.4-focuspack-path31-taxonomy26-browser203',
  companyMap:freeze.VERSION,
  feature:'feature-2.0.0-x20raw20-y5-activation02',
  path:'path-3.1.1-family-cache-refresh'
};
assert.match(pkg.version,/^2\.6\.(?:7\.\d+|8\.\d+)$/);
assert.equal(xy.ENGINE_VERSION,known.engine);
assert.equal(xy.DAILY_BUILD_VERSION,known.daily);
assert.equal(xy.SNAPSHOT_SCHEMA_VERSION,known.snapshot);
assert.equal(xy.COMPANY_MAP_VERSION,known.companyMap);
assert.equal(xy.FEATURE_VERSION,known.feature);
assert.equal(xy.PATH_MODEL_VERSION,known.path);
assert.equal(freeze.STATS.taxonomyCount,203);
assert.equal(freeze.STATS.membershipEdges,3442);
assert(core.includes("AND company_map_version=$7"),'Snapshot loading must enforce the new frozen Company_Map identity');
assert(core.includes("String(payload.dailyBuildVersion||'')===currentDailyBuildVersion()"),'Daily build version remains part of payload validation');
assert(app.includes(`const FUND_FLOW_CLIENT_REV="${pkg.version}"`));
assert(app.includes('/api/dw4?view=audit'));
console.log('PASS v2.6.7.6 — snapshot read contract follows versioned Company_Map; 203 taxonomy remains frozen');
