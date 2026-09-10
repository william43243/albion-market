// Albion Online Tax & Fee Calculator - Core Formulas
// Sources: wiki.albiononline.com/wiki/Marketplace, wiki.albiononline.com/wiki/Margin

/**
 * Defensive input sanitizer: coerces any value into a finite number >= 0.
 * Guards against NaN / Infinity / negative inputs that would otherwise
 * propagate into the UI as "NaN" or "-∞".
 */
function sanitizeAmount(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** Sanitizes a quantity into a finite, non-negative integer. */
function sanitizeQuantity(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export interface MarketplaceResult {
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  setupFeeBuy: number;
  setupFeeSell: number;
  salesTax: number;
  totalFees: number;
  netProfit: number;
  profitPerItem: number;
  feePercentage: number;
  marginPercentage: number;
}

export type MarketplaceStrategy = 'instant-instant' | 'order-instant' | 'instant-order' | 'order-order';

export function strategyFlags(strategy: MarketplaceStrategy): { useBuyOrder: boolean; useSellOrder: boolean } {
  return {
    useBuyOrder: strategy === 'order-instant' || strategy === 'order-order',
    useSellOrder: strategy === 'instant-order' || strategy === 'order-order',
  };
}

/** Lowest sale price for a non-negative result, preserving whole-silver fees. */
export function breakEvenSellPrice(buyPrice: number, quantity: number, isPremium: boolean, strategy: MarketplaceStrategy, targetProfitPerItem = 0): number {
  const flags = strategyFlags(strategy);
  const qty = Math.max(1, Math.floor(quantity));
  const target = Math.max(0, targetProfitPerItem) * qty;
  let low = Math.max(0, buyPrice);
  let high = Math.max(low + 1, low * 2 + target + 100);
  while (calculateMarketplaceProfit(buyPrice, high, qty, isPremium, flags.useBuyOrder, flags.useSellOrder).netProfit < target) high *= 2;
  for (let i = 0; i < 64; i += 1) {
    const mid = Math.floor((low + high) / 2);
    if (calculateMarketplaceProfit(buyPrice, mid, qty, isPremium, flags.useBuyOrder, flags.useSellOrder).netProfit >= target) high = mid;
    else low = mid + 1;
  }
  return high;
}

/** Highest purchase price for a requested per-item profit at a fixed sale price. */
export function maxBuyPriceForTarget(sellPrice: number, quantity: number, isPremium: boolean, strategy: MarketplaceStrategy, targetProfitPerItem = 0): number {
  const flags = strategyFlags(strategy);
  const qty = Math.max(1, Math.floor(quantity));
  const target = Math.max(0, targetProfitPerItem) * qty;
  let low = 0; let high = Math.max(1, sellPrice);
  while (calculateMarketplaceProfit(high, sellPrice, qty, isPremium, flags.useBuyOrder, flags.useSellOrder).netProfit >= target) high *= 2;
  for (let i = 0; i < 64; i += 1) {
    const mid = Math.floor((low + high) / 2);
    if (calculateMarketplaceProfit(mid, sellPrice, qty, isPremium, flags.useBuyOrder, flags.useSellOrder).netProfit >= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

export interface CraftingResult {
  itemValue: number;
  stationTax: number;
  quantity: number;
  nutritionPerItem: number;
  totalNutrition: number;
  feePerItem: number;
  totalFee: number;
}

export interface FlippingResult {
  marketplace: MarketplaceResult;
  crafting: CraftingResult;
  totalProfit: number;
  totalFees: number;
  upfrontInvestment: number;
  roi: number;
}

/**
 * Marketplace profit calculation.
 * A buy order and a sell order are independent. Each fee is rounded once on
 * the complete order amount, never once per item.
 */
export function calculateMarketplaceProfit(
  buyPrice: number,
  sellPrice: number,
  quantity: number,
  isPremium: boolean,
  useBuyOrder: boolean,
  useSellOrder: boolean
): MarketplaceResult {
  buyPrice = sanitizeAmount(buyPrice);
  sellPrice = sanitizeAmount(sellPrice);
  quantity = sanitizeQuantity(quantity);

  const taxRate = isPremium ? 0.04 : 0.08;
  const totalRevenue = sellPrice * quantity;
  const totalCost = buyPrice * quantity;
  const setupFeeBuy = useBuyOrder ? Math.ceil(totalCost * 0.025) : 0;
  const setupFeeSell = useSellOrder ? Math.ceil(totalRevenue * 0.025) : 0;
  const salesTax = Math.ceil(totalRevenue * taxRate);
  const totalFees = setupFeeBuy + setupFeeSell + salesTax;
  const netProfit = totalRevenue - setupFeeSell - salesTax - totalCost - setupFeeBuy;
  const profitPerItem = quantity > 0 ? netProfit / quantity : 0;
  const feePercentage = totalRevenue > 0 ? (totalFees / totalRevenue) * 100 : 0;
  const marginPercentage = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;

  return {
    buyPrice,
    sellPrice,
    quantity,
    setupFeeBuy,
    setupFeeSell,
    salesTax,
    totalFees,
    netProfit,
    profitPerItem,
    feePercentage,
    marginPercentage,
  };
}

/**
 * Crafting / Refining Station Fee calculation.
 * Premium does not change this station fee.
 */
export function calculateCraftingFee(
  itemValue: number,
  stationTax: number,
  quantity: number
): CraftingResult {
  itemValue = sanitizeAmount(itemValue);
  stationTax = sanitizeAmount(stationTax);
  quantity = sanitizeQuantity(quantity);

  const nutritionPerItem = itemValue * 0.1125;
  const feePerItem = (itemValue * 0.1125 * stationTax) / 100;
  const totalNutrition = nutritionPerItem * quantity;
  const totalFee = Math.ceil(feePerItem * quantity);

  return {
    itemValue,
    stationTax,
    quantity,
    nutritionPerItem,
    totalNutrition,
    feePerItem,
    totalFee,
  };
}

/**
 * Flipping = Buy materials + Craft + Sell finished product.
 * ROI intentionally uses only capital committed before the sale: material cost,
 * buy-order fee when selected, and station fee.
 */
export function calculateFlippingProfit(
  materialBuyPrice: number,
  productSellPrice: number,
  craftingItemValue: number,
  stationTax: number,
  quantity: number,
  isPremium: boolean,
  useBuyOrder: boolean,
  useSellOrder: boolean
): FlippingResult {
  const marketplace = calculateMarketplaceProfit(
    materialBuyPrice,
    productSellPrice,
    quantity,
    isPremium,
    useBuyOrder,
    useSellOrder
  );
  const crafting = calculateCraftingFee(craftingItemValue, stationTax, quantity);
  const totalProfit = marketplace.netProfit - crafting.totalFee;
  const totalFees = marketplace.totalFees + crafting.totalFee;
  const upfrontInvestment = marketplace.buyPrice * marketplace.quantity
    + marketplace.setupFeeBuy
    + crafting.totalFee;
  const roi = upfrontInvestment > 0 ? (totalProfit / upfrontInvestment) * 100 : 0;

  return {
    marketplace,
    crafting,
    totalProfit,
    totalFees,
    upfrontInvestment,
    roi,
  };
}
