function nowIso() {
  return new Date().toISOString();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildMenuOverridesResponse(overridesInput) {
  const overrides = toArray(overridesInput);
  const fetchedAt = nowIso();
  return {
    ok: true,
    fetchedAt,
    count: overrides.length,
    overrides,
    menu: { overrides },
    data: { overrides },
    meta: {
      overrides: overrides.length,
    },
  };
}

function buildStoreResponse(storesInput) {
  const stores = toArray(storesInput);
  const fetchedAt = nowIso();
  return {
    ok: true,
    fetchedAt,
    count: stores.length,
    stores,
    menu: { stores },
    data: { stores },
    meta: {
      stores: stores.length,
    },
  };
}

function buildProfilesResponse(profilesInput, totalInput, limitInput) {
  const profiles = toArray(profilesInput);
  const total = Number.isInteger(totalInput) ? totalInput : profiles.length;
  const limit = Number.isInteger(limitInput) && limitInput > 0 ? limitInput : null;
  const fetchedAt = nowIso();

  const aggregates = profiles.reduce((acc, profile) => {
    const metrics = profile?.metrics || {};
    acc.weeklyOrders += Number(metrics.weeklyOrders || 0);
    acc.revenue7d += Number(metrics?.revenue?.weekCents || 0);
    acc.revenue28d += Number(metrics?.revenue?.monthCents || 0);
    acc.repeatSum += Number(metrics.repeatRate || 0);
    acc.profileCount += 1;
    acc.avgOrderValueCents += Number(metrics.averageOrderValueCents || 0);
    return acc;
  }, {
    weeklyOrders: 0,
    revenue7d: 0,
    revenue28d: 0,
    repeatSum: 0,
    profileCount: 0,
    avgOrderValueCents: 0,
  });

  const summary = {
    weeklyOrders: aggregates.weeklyOrders,
    revenue7dCents: aggregates.revenue7d,
    revenue28dCents: aggregates.revenue28d,
    averageRepeatRate: aggregates.profileCount ? aggregates.repeatSum / aggregates.profileCount : 0,
    averageOrderValueCents: aggregates.profileCount ? Math.round(aggregates.avgOrderValueCents / aggregates.profileCount) : 0,
  };

  return {
    ok: true,
    fetchedAt,
    profiles,
    count: profiles.length,
    total,
    limit,
    pagination: {
      total,
      limit,
      returned: profiles.length,
    },
    summary,
    data: { profiles },
    meta: {
      total,
      limit,
      returned: profiles.length,
    },
  };
}

function buildOrdersResponse(ordersInput, totalInput, limitInput) {
  const orders = toArray(ordersInput);
  const total = Number.isInteger(totalInput) ? totalInput : orders.length;
  const limit = Number.isInteger(limitInput) && limitInput > 0 ? limitInput : null;
  const fetchedAt = nowIso();

  const aggregates = orders.reduce((acc, order) => {
    const totals = order?.totals || {};
    const status = (order?.status || 'unknown').toLowerCase();
    acc.subtotalCents += Number(totals.subtotalCents || 0);
    acc.taxCents += Number(totals.taxCents || 0);
    acc.deliveryCents += Number(totals.deliveryCents || 0);
    acc.tipCents += Number(totals.tipCents || 0);
    acc.totalCents += Number(totals.totalCents || 0);
    acc.statusCounts[status] = (acc.statusCounts[status] || 0) + 1;
    acc.orderCount += 1;
    return acc;
  }, {
    subtotalCents: 0,
    taxCents: 0,
    deliveryCents: 0,
    tipCents: 0,
    totalCents: 0,
    orderCount: 0,
    statusCounts: {},
  });

  const summary = {
    subtotalCents: aggregates.subtotalCents,
    taxCents: aggregates.taxCents,
    deliveryCents: aggregates.deliveryCents,
    tipCents: aggregates.tipCents,
    totalCents: aggregates.totalCents,
    averageOrderValueCents: aggregates.orderCount ? Math.round(aggregates.totalCents / aggregates.orderCount) : 0,
    statusCounts: aggregates.statusCounts,
  };

  return {
    ok: true,
    fetchedAt,
    orders,
    count: orders.length,
    total,
    limit,
    pagination: {
      total,
      limit,
      returned: orders.length,
    },
    summary,
    data: { orders },
    meta: {
      total,
      limit,
      returned: orders.length,
    },
  };
}

module.exports = {
  buildMenuOverridesResponse,
  buildStoreResponse,
  buildProfilesResponse,
  buildOrdersResponse,
};
