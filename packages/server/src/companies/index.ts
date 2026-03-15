export { ensureCompanyTables, ensureCompanyFk } from './schema.ts';
export {
  addAlias,
  createCompany,
  createOwnershipEvent,
  extractOwnershipEvents,
  getAttributionStats,
  getCompanyByAlias,
  getCompanyById,
  getCompanyDetail,
  getCompanyFilings,
  getOwnershipEventsForCompany,
  listCompanies,
  removeAlias,
  searchCompanies,
  updateCompany,
} from './repository.ts';
export {
  attributeFiling,
  runBatchAttribution,
  seedCompanies,
} from './attribution.ts';
export { COMPANY_SEED_DATA } from './seed-data.ts';
export type {
  AliasType,
  AttributionStats,
  Company,
  CompanyAlias,
  CompanyDetail,
  CompanyListItem,
  CompanySeedEntry,
  OwnershipEvent,
  OwnershipEventStatus,
  OwnershipEventType,
} from './types.ts';
