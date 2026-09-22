const registry = require("../lib/business-tags");

const errors = [];
const ids = new Set();
const names = new Map();

for (const tag of registry.tags) {
  if (!tag.id || !/^[a-z0-9_]+$/.test(tag.id)) errors.push(`invalid id: ${tag.id}`);
  if (ids.has(tag.id)) errors.push(`duplicate id: ${tag.id}`);
  ids.add(tag.id);

  if (tag.parent && !registry.getTag(tag.parent)) errors.push(`missing parent: ${tag.id} -> ${tag.parent}`);

  for (const raw of [tag.name, ...tag.aliases]) {
    const key = registry.normalizeKey(raw);
    if (!key) errors.push(`empty name/alias: ${tag.id}`);
    const prev = names.get(key);
    if (prev && prev !== tag.id) errors.push(`alias collision: "${raw}" => ${prev}, ${tag.id}`);
    else names.set(key, tag.id);
  }
}

const voteCount = registry.listVoteEligible().length;
const fineVoteCount = registry.listVoteEligible().filter((x) => x.resolution === "fine").length;
const coarseVoteCount = voteCount - fineVoteCount;

if (errors.length) {
  console.error("Business Tag Engine validation failed:");
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log(`Business Tag Engine ${registry.version}: OK`);
console.log(`tags=${registry.tags.length}`);
console.log(`voteEligible=${voteCount} (fine=${fineVoteCount}, coarse=${coarseVoteCount})`);
