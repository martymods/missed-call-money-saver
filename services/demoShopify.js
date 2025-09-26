const { DEMO_DEFAULTS } = require('../lib/bootstrapDemo');

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

const demoData = {
  locations: [
    {
      id: 'LOC-100',
      name: 'Delco Fulfillment East',
      active: true,
      address1: '120 Market Street',
      address2: '',
      city: 'Philadelphia',
      province: 'PA',
      zip: '19106',
      country: 'USA',
      phone: '+1-610-555-0114',
      legacy: false,
      createdAt: '2023-03-01T10:15:00.000Z',
      updatedAt: '2024-09-15T14:20:00.000Z',
    },
    {
      id: 'LOC-210',
      name: 'SoCal Climate Hub',
      active: true,
      address1: '455 Harbor Way',
      address2: '',
      city: 'Los Angeles',
      province: 'CA',
      zip: '90021',
      country: 'USA',
      phone: '+1-213-555-0145',
      legacy: false,
      createdAt: '2023-07-10T17:45:00.000Z',
      updatedAt: '2024-09-12T09:05:00.000Z',
    },
  ],
  collections: [
    {
      id: 'COLL-precision-picking',
      title: 'Precision Picking Kits',
      handle: 'precision-picking-kits',
      updatedAt: '2024-09-18T19:32:00.000Z',
      productsCount: 8,
      type: 'smart',
      sortOrder: 'best-selling',
    },
    {
      id: 'COLL-cold-chain',
      title: 'Cold Chain Essentials',
      handle: 'cold-chain-essentials',
      updatedAt: '2024-08-06T13:11:00.000Z',
      productsCount: 5,
      type: 'custom',
      sortOrder: 'manual',
    },
  ],
  inventory: [
    {
      inventoryItemId: 'INV-401',
      locationId: 'LOC-100',
      locationName: 'Delco Fulfillment East',
      available: 148,
      updatedAt: '2024-09-20T22:05:00.000Z',
      sku: 'PICK-MOD-XL',
      productTitle: 'Pick Module XL',
      variantTitle: 'Standard harness',
      productType: 'Automation',
      price: 9800,
      barcode: 'PMXL-2024',
      reorderPoint: 45,
    },
    {
      inventoryItemId: 'INV-518',
      locationId: 'LOC-210',
      locationName: 'SoCal Climate Hub',
      available: 62,
      updatedAt: '2024-09-21T01:35:00.000Z',
      sku: 'COLD-PACK-5',
      productTitle: 'Cold Chain Gel Packs',
      variantTitle: '5lb',
      productType: 'Consumable',
      price: 19.5,
      barcode: 'CCGP-5LB',
      reorderPoint: 24,
    },
    {
      inventoryItemId: 'INV-610',
      locationId: 'LOC-100',
      locationName: 'Delco Fulfillment East',
      available: 24,
      updatedAt: '2024-09-17T11:20:00.000Z',
      sku: 'VISION-ROBOT',
      productTitle: 'Vision Sorting Robot',
      variantTitle: 'Ranger Mk II',
      productType: 'Automation',
      price: 22400,
      barcode: 'VSR-MK2',
      reorderPoint: 6,
    },
  ],
  purchaseOrders: [
    {
      id: 'PO-7305',
      name: 'PO-7305',
      status: 'open',
      vendor: 'Keystone Robotics',
      expectedAt: '2024-10-05T18:00:00.000Z',
      createdAt: '2024-09-14T12:00:00.000Z',
      closedAt: null,
      lineCount: 4,
      totalQuantity: 96,
    },
  ],
  transfers: [
    {
      id: 'TR-902',
      reference: 'TR-902',
      status: 'in_transit',
      createdAt: '2024-09-19T16:30:00.000Z',
      updatedAt: '2024-09-20T09:00:00.000Z',
      shippedAt: '2024-09-19T18:45:00.000Z',
      expectedArrival: '2024-09-22T20:00:00.000Z',
      receivedAt: null,
      source: 'Delco Fulfillment East',
      destination: 'SoCal Climate Hub',
      lineCount: 12,
    },
  ],
  giftCards: [
    {
      id: 'GC-1180',
      lastCharacters: '4X2M',
      balance: 250,
      currency: 'USD',
      createdAt: '2024-06-05T15:30:00.000Z',
      expiresOn: '2025-06-05T00:00:00.000Z',
      disabledAt: null,
      customerEmail: 'opslead@clientco.com',
      note: 'Rewarded for flawless peak season',
      templateSuffix: 'warehouse-command',
    },
  ],
};

function getDemoShopifySync(){
  const snapshot = clone(demoData);
  const fetchedAt = new Date().toISOString();
  const meta = {
    warnings: ['Demo Shopify workspace. Data is simulated for Warehouse HQ.'],
    counts: {
      locations: snapshot.locations.length,
      collections: snapshot.collections.length,
      inventory: snapshot.inventory.length,
      purchaseOrders: snapshot.purchaseOrders.length,
      transfers: snapshot.transfers.length,
      giftCards: snapshot.giftCards.length,
    },
  };
  return {
    ok: true,
    shop: DEMO_DEFAULTS.shopDomain,
    fetchedAt,
    data: snapshot,
    meta,
  };
}

module.exports = {
  getDemoShopifySync,
};
