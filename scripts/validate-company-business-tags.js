const tags = require("../lib/business-tags");
const db = require("../lib/company-business-tags");

const errors = [];
const seenSymbols = new Set();
const importance = new Set(db.importanceLevels);

for (const company of db.companies) {
  if (!/^\d{4,6}$/.test(company.symbol)) {
    errors.push(`${company.symbol || "(empty)"}: invalid symbol`);
  }
  if (seenSymbols.has(company.symbol)) {
    errors.push(`${company.symbol}: duplicate company`);
  }
  seenSymbols.add(company.symbol);

  if (!company.name) errors.push(`${company.symbol}: missing name`);
  if (!tags.getTag(company.sectorTag)) {
    errors.push(`${company.symbol} ${company.name}: unknown sectorTag ${company.sectorTag}`);
  }

  const seenCompanyTags = new Set();
  if (!company.tags.length) errors.push(`${company.symbol} ${company.name}: no business tags`);
  for (const link of company.tags) {
    const item = tags.getTag(link.id);
    if (!item) {
      errors.push(`${company.symbol} ${company.name}: unknown tag ${link.id}`);
      continue;
    }
    if (!item.voteEligible) {
      errors.push(`${company.symbol} ${company.name}: business tag ${link.id} is not voteEligible`);
    }
    if (!importance.has(link.importance)) {
      errors.push(`${company.symbol} ${company.name}: invalid importance ${link.importance}`);
    }
    if (seenCompanyTags.has(link.id)) {
      errors.push(`${company.symbol} ${company.name}: duplicate tag ${link.id}`);
    }
    seenCompanyTags.add(link.id);
  }
}

const summary = db.getCoverageSummary();
if (errors.length) {
  console.error(`Company business tags validation failed (${errors.length})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Company business tags OK: ${summary.companyCount} companies / ${summary.relationCount} relations / ${summary.representedTagCount} represented vote tags`
);
