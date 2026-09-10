import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateFlipProfit,
  calculateMarketplaceProfit,
  breakEvenSellPrice,
  maxBuyPriceForTarget,
} from '../lib/calculations';

test('marketplace separates buy and sell order fees', () => {
  const instant = calculateMarketplaceProfit(100, 200, 10, true, false, false);
  assert.deepEqual(
    { setupFeeBuy: instant.setupFeeBuy, setupFeeSell: instant.setupFeeSell, salesTax: instant.salesTax, netProfit: instant.netProfit },
    { setupFeeBuy: 0, setupFeeSell: 0, salesTax: 80, netProfit: 920 }
  );
  const buyOrderOnly = calculateMarketplaceProfit(100, 200, 10, true, true, false);
  assert.equal(buyOrderOnly.setupFeeBuy, 25);
  assert.equal(buyOrderOnly.setupFeeSell, 0);
  assert.equal(buyOrderOnly.netProfit, 895);
  const sellOrderOnly = calculateMarketplaceProfit(100, 200, 10, true, false, true);
  assert.equal(sellOrderOnly.setupFeeBuy, 0);
  assert.equal(sellOrderOnly.setupFeeSell, 50);
  assert.equal(sellOrderOnly.netProfit, 870);
});

test('marketplace rounds each fee once on the full order amount', () => {
  const result = calculateMarketplaceProfit(101, 101, 10, true, true, true);
  assert.equal(result.setupFeeBuy, 26);
  assert.equal(result.setupFeeSell, 26);
  assert.equal(result.salesTax, 41);
});

test('flipping ROI uses upfront capital rather than sale-time fees', () => {
  const result = calculateFlipProfit(100, 200, 10, true, true, true);
  assert.equal(result.upfrontInvestment, 1025);
  assert.equal(result.totalFees, 155);
  assert.equal(result.totalProfit, 845);
  assert.equal(result.roi, (845 / 1025) * 100);
});

test('crafting remains outside the flip calculation', () => {
  const result = calculateFlipProfit(100, 200, 10, true, false, false);
  assert.equal('crafting' in result, false);
  assert.equal(result.totalFees, 80);
});

test('break-even and target-profit prices respect selected strategy fees', () => {
  const breakEven = breakEvenSellPrice(100, 10, true, 'order-order');
  const maxBuy = maxBuyPriceForTarget(200, 10, true, 'order-order', 50);
  assert.ok(calculateMarketplaceProfit(100, breakEven, 10, true, true, true).netProfit >= 0);
  assert.ok(calculateMarketplaceProfit(maxBuy, 200, 10, true, true, true).profitPerItem >= 50);
  assert.ok(calculateMarketplaceProfit(maxBuy + 1, 200, 10, true, true, true).profitPerItem < 50);
});
