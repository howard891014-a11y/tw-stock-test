'use strict';
const assert=require('node:assert/strict');
const tax=require('../lib/market-topic-taxonomy');
const {STORAGE_POLICY}=require('../lib/storage-policy');
assert.equal(tax.version,'2.3.0-final191');
assert.equal(STORAGE_POLICY.compact.topicResearch,500);
assert.equal(STORAGE_POLICY.compact.wResearch,500);
assert.equal(STORAGE_POLICY.raw.price,120);
assert.equal(STORAGE_POLICY.raw.institutional,120);
for(const [a,b] of Object.entries({
  ssd_controller:'storage_controller_ic',hdd_controller_ic:'storage_controller_ic',optical_storage_controller_ic:'storage_controller_ic',digital_media_streaming:'media',furniture:'home_living',
  lead_material_recycling:'environmental_recycling',nand:'memory_ic',semiconductor_products_services:'wafer',pi_film:'functional_electronic_material',smart_meter_energy_management:'renewable_energy_equipment',holographic_optical_material:'functional_material',special_metal:'steel'
}))assert.equal(tax.FINAL_TOPIC_ALIASES[a],b);
for(const id of ['ceramic_substrate','ssd','cable_assembly','image_sensor_module','keypad_mechanical_component','motor_driver_ic','security_service'])assert.equal(tax.FINAL_TOPIC_ALIASES[id],undefined,`${id} must stay semantically distinct`);
assert.equal(tax.FINAL_TOPIC_ALIASES.biomedical_health,'medical_device');
const fs=require('node:fs');const xy=fs.readFileSync(require.resolve('../lib/fundflow-xy'),'utf8');
assert(xy.includes('market_business_xy2_research_daily'));assert(xy.includes('RESEARCH_HISTORY_RETENTION_DAYS = STORAGE_POLICY.compact.topicResearch'));assert(xy.includes('persistCompactResearchRows'));
console.log('v2.6.6.14 final taxonomy freeze + low-egress 500D compact research validation PASS');
