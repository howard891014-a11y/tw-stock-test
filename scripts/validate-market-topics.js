'use strict';
const assert=require('node:assert/strict');
const tax=require('../lib/market-topic-taxonomy');
const freeze=tax.finalTaxonomyFreeze;

// Static classifier registry still keeps raw/legacy compatibility; final runtime universe is the audited 191.
const staticDefs=tax.listMarketDefinitions();
assert.equal(new Set(staticDefs.map(x=>x.id)).size,staticDefs.length,'static market topic ids must be unique');
assert.equal(tax.listMarketDefinitions({finalOnly:true}).length,191,'final runtime taxonomy must have 191 tags');
for(const id of ['cowos','copos','foplp','glass_substrate','pmic','semiconductor_equipment','mcu'])assert(freeze.definitionById(id),`final tag missing ${id}`);
for(const id of ['lead_material_recycling','nand','semiconductor_products_services','pi_film','smart_meter_energy_management','holographic_optical_material','thin_client','special_metal','electronic_components_manufacturing'])assert(!freeze.definitionById(id),`merged/removed final tag must be absent ${id}`);

// Unknown/future companies still use the evidence classifier and legacy aliases.
function ids(raw=[],name='測試公司',code='999999',context={}){return new Set(tax.marketTopicLinks(raw,name,code,context).map(x=>x.id));}
assert(ids([{id:'rigid_flex',importance:'core'}]).has('fpcb'));
assert(ids([{id:'specialty_process',importance:'core'}]).has('mature_foundry'));
assert(ids([{id:'micro_led',importance:'core'}]).has('mini_led'));
assert(ids([{id:'electronic_distribution_business',importance:'core'}]).has('ic_distribution'));
assert(ids([{id:'bt_substrate',importance:'core'}]).has('abf_substrate'));
assert(ids([{id:'copper_foil',importance:'core'}]).has('ccl'));
assert(ids([{id:'server_rack',importance:'core'}]).has('server_chassis'));
assert(ids([{id:'server_odm',importance:'core'}]).has('ai_server'));
for(const retired of ['gpu','chipset','wafer_manufacturing','consumer_ic','panel_market'])assert(!ids([{id:retired,importance:'core'}]).has(retired),`${retired} must remain retired from XY`);

// Known frozen companies ignore legacy seed noise and resolve exactly to audited Company_Map.
const silergy=tax.marketTopicLinks([{id:'consumer_ic',importance:'core'}],'矽力*-KY','6415',{});
assert(silergy.some(x=>x.id==='pmic'&&x.importance==='core'));
assert(!tax.marketTopicLinks([{id:'glass_substrate',importance:'core'}],'南電','8046',{}).some(x=>x.id==='glass_substrate'),'8046 must follow final audited map, not old seed overlay');
assert(tax.marketTopicLinks([],'台積電','2330',{}).some(x=>x.id==='copos'),'2330 must be in final CoPoS supply chain');

console.log('Market topic taxonomy validation PASS — static compatibility + audited final 191 Company_Map');
